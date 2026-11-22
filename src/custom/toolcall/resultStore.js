/**
 * resultStore.js — tool-result store with retrieval handle.
 *
 * Problem: large tool outputs (logs, diffs, file contents) bloat context.
 * Store them, send summary + handle to LLM. LLM can retrieve full content
 * via injected tool.
 *
 * Contract:
 *   - store(content, metadata) → { handle, summary, stored }
 *   - retrieve(handle) → { content, metadata, found }
 *   - summarize(content, opts) → string
 *   - injectRetrieveTool(tools) → tools array with retrieve tool appended
 *   - stats() → { stored, retrieved, evicted, size }
 *
 * LRU eviction via Map (insertion order = recency; re-insert on access).
 * TTL expiry is lazy (checked on retrieve).
 *
 * Pure ESM, zero external deps (node:crypto for randomUUID).
 * Fail-open: never throws, never breaks a request.
 */

import { randomUUID } from "node:crypto";

/**
 * @typedef {Object} StoreEntry
 * @property {string} content - full tool output
 * @property {object} metadata - arbitrary metadata (tool name, timestamp, etc.)
 * @property {number} createdAt - timestamp (ms)
 * @property {number} expiresAt - timestamp (ms)
 * @property {number} lastAccess - monotonic sequence for LRU
 */

/**
 * @typedef {Object} StoreInstance
 * @property {(content: string, metadata?: object) => { handle: string, summary: string, stored: boolean }} store
 * @property {(handle: string) => { content: string, metadata: object, found: boolean }} retrieve
 * @property {(content: string, opts?: { summaryChars?: number }) => string} summarize
 * @property {(tools: any[]) => any[]} injectRetrieveTool
 * @property {() => { stored: number, retrieved: number, evicted: number, size: number }} stats
 * @property {{ maxEntries: number, ttlMs: number, maxInlineChars: number, summaryChars: number }} config
 *   the resolved configuration (so helpers like applyToolResultStore honour it)
 */

/**
 * Create a tool-result store instance.
 * @param {object} [opts]
 * @param {number} [opts.maxEntries=512] - LRU capacity
 * @param {number} [opts.ttlMs=3600000] - TTL for entries (1 hour default)
 * @param {number} [opts.maxInlineChars=2000] - threshold: content > this is stored
 * @param {number} [opts.summaryChars=500] - length of summary preview
 * @param {() => number} [opts.now] - injectable clock for tests
 * @returns {StoreInstance}
 */
export function createToolResultStore({
  maxEntries = 512,
  ttlMs = 3600000,
  maxInlineChars = 2000,
  summaryChars = 500,
  now = () => Date.now(),
} = {}) {
  const map = new Map(); // handle -> StoreEntry
  let seq = 0;
  const word = () => ++seq;

  const counters = { stored: 0, retrieved: 0, evicted: 0 };

  /**
   * Summarize content, guaranteeing the total summary never exceeds
   * `summaryChars` (preview + truncation marker fit inside the budget).
   * @param {string} content
   * @param {object} [summarizeOpts]
   * @param {number} [summarizeOpts.summaryChars]
   * @returns {string}
   */
  function summarize(content, summarizeOpts = {}) {
    try {
      if (typeof content !== "string") return "";
      const len = summarizeOpts.summaryChars ?? summaryChars;
      if (content.length <= len) return content;
      const suffix = "... [truncated, use retrieve tool]";
      const preview = Math.max(0, len - suffix.length);
      return content.slice(0, preview) + suffix;
    } catch {
      return "";
    }
  }

  /**
   * Store content and return handle + summary.
   * @param {string} content
   * @param {object} [metadata]
   * @returns {{ handle: string, summary: string, stored: boolean }}
   */
  function store(content, metadata = {}) {
    try {
      if (typeof content !== "string") {
        return { handle: "", summary: "", stored: false };
      }

      // If content is small enough, don't store — return inline
      if (content.length <= maxInlineChars) {
        return { handle: "", summary: content, stored: false };
      }

      // Generate handle
      const handle = `tr-${randomUUID().slice(0, 8)}`;
      const ts = now();
      const entry = {
        content,
        metadata: metadata || {},
        createdAt: ts,
        expiresAt: ts + ttlMs,
        lastAccess: word(),
      };

      // Evict if at capacity
      while (map.size >= maxEntries) {
        evictLRU();
      }

      map.set(handle, entry);
      counters.stored++;

      return {
        handle,
        // Cap the inline preview at the inline budget: a summary that is
        // longer than maxInlineChars would defeat the point of storing.
        summary: summarize(content, { summaryChars: Math.min(summaryChars, maxInlineChars) }),
        stored: true,
      };
    } catch {
      // Fail-open: return content as-is
      return { handle: "", summary: typeof content === "string" ? content : "", stored: false };
    }
  }

  /**
   * Retrieve content by handle.
   * @param {string} handle
   * @returns {{ content: string, metadata: object, found: boolean }}
   */
  function retrieve(handle) {
    try {
      if (typeof handle !== "string" || !handle) {
        return { content: "", metadata: {}, found: false };
      }

      const entry = map.get(handle);
      if (!entry) {
        return { content: "", metadata: {}, found: false };
      }

      // Check TTL
      if (now() >= entry.expiresAt) {
        map.delete(handle);
        counters.evicted++;
        return { content: "", metadata: {}, found: false };
      }

      // Bump LRU
      entry.lastAccess = word();
      counters.retrieved++;

      return {
        content: entry.content,
        metadata: entry.metadata,
        found: true,
      };
    } catch {
      return { content: "", metadata: {}, found: false };
    }
  }

  /**
   * Inject the retrieve_tool_result tool definition into a tools array.
   * @param {any[]} tools
   * @returns {any[]}
   */
  function injectRetrieveTool(tools) {
    try {
      if (!Array.isArray(tools)) return [];

      // Check if already present
      for (const tool of tools) {
        if (tool?.function?.name === "retrieve_tool_result") {
          return tools;
        }
      }

      // Append retrieve tool definition
      const retrieveTool = {
        type: "function",
        function: {
          name: "retrieve_tool_result",
          description: "Retrieve full content of a previously truncated tool output by handle",
          parameters: {
            type: "object",
            properties: {
              handle: {
                type: "string",
                description: "The handle returned in the truncated tool output",
              },
            },
            required: ["handle"],
          },
        },
      };

      return [...tools, retrieveTool];
    } catch {
      return Array.isArray(tools) ? tools : [];
    }
  }

  /**
   * Get store statistics.
   * @returns {{ stored: number, retrieved: number, evicted: number, size: number }}
   */
  function getStats() {
    return {
      stored: counters.stored,
      retrieved: counters.retrieved,
      evicted: counters.evicted,
      size: map.size,
    };
  }

  /** Evict least-recently-used entry. */
  function evictLRU() {
    let oldestHandle = null;
    let oldestAt = Infinity;
    for (const [handle, entry] of map) {
      if (entry.lastAccess < oldestAt) {
        oldestAt = entry.lastAccess;
        oldestHandle = handle;
      }
    }
    if (oldestHandle) {
      map.delete(oldestHandle);
      counters.evicted++;
    }
  }

  return {
    store,
    retrieve,
    summarize,
    injectRetrieveTool,
    stats: getStats,
    config: { maxEntries, ttlMs, maxInlineChars, summaryChars },
  };
}

/**
 * Apply tool-result store to a message body: find large tool results,
 * replace with summary + handle, inject retrieve tool if needed.
 *
 * @param {object} body - request body with messages array
 * @param {StoreInstance} storeInstance - store from createToolResultStore()
 * @param {object} [opts]
 * @param {number} [opts.maxInlineChars] - threshold for storing; defaults to
 *   the store instance's own configured maxInlineChars (then 2000)
 * @returns {{ body: object, decisions: Array<{ index: number, handle: string, stored: boolean }> }}
 */
export function applyToolResultStore(body, storeInstance, opts = {}) {
  const decisions = [];
  try {
    if (!body || typeof body !== "object" || !storeInstance || typeof storeInstance.store !== "function") {
      return { body, decisions };
    }

    const maxInlineChars = opts.maxInlineChars
      ?? storeInstance.config?.maxInlineChars
      ?? 2000;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    let needsRetrieveTool = false;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || typeof msg !== "object") continue;

      // OpenAI: role='tool' with string content
      if (msg.role === "tool" && typeof msg.content === "string") {
        if (msg.content.length > maxInlineChars) {
          const result = storeInstance.store(msg.content, { toolName: msg.name || null, index: i });
          if (result.stored) {
            msg.content = result.summary;
            decisions.push({ index: i, handle: result.handle, stored: true });
            needsRetrieveTool = true;
          }
        }
        continue;
      }

      // OpenAI Responses: type='function_call_output'
      if (msg.type === "function_call_output") {
        if (typeof msg.output === "string" && msg.output.length > maxInlineChars) {
          const result = storeInstance.store(msg.output, { type: "function_call_output", index: i });
          if (result.stored) {
            msg.output = result.summary;
            decisions.push({ index: i, handle: result.handle, stored: true });
            needsRetrieveTool = true;
          }
        } else if (Array.isArray(msg.output)) {
          for (const block of msg.output) {
            if (block && typeof block === "object" && typeof block.text === "string") {
              if (block.text.length > maxInlineChars) {
                const result = storeInstance.store(block.text, { type: "function_call_output", index: i });
                if (result.stored) {
                  block.text = result.summary;
                  decisions.push({ index: i, handle: result.handle, stored: true });
                  needsRetrieveTool = true;
                }
              }
            }
          }
        }
        continue;
      }

      // Claude: content blocks with type='tool_result'
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && block.type === "tool_result") {
            if (typeof block.content === "string" && block.content.length > maxInlineChars) {
              const result = storeInstance.store(block.content, { type: "tool_result", index: i });
              if (result.stored) {
                block.content = result.summary;
                decisions.push({ index: i, handle: result.handle, stored: true });
                needsRetrieveTool = true;
              }
            } else if (Array.isArray(block.content)) {
              for (const textBlock of block.content) {
                if (textBlock && typeof textBlock === "object" && typeof textBlock.text === "string") {
                  if (textBlock.text.length > maxInlineChars) {
                    const result = storeInstance.store(textBlock.text, { type: "tool_result", index: i });
                    if (result.stored) {
                      textBlock.text = result.summary;
                      decisions.push({ index: i, handle: result.handle, stored: true });
                      needsRetrieveTool = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Inject retrieve tool if any content was stored
    if (needsRetrieveTool) {
      if (!Array.isArray(body.tools)) {
        body.tools = [];
      }
      body.tools = storeInstance.injectRetrieveTool(body.tools);
    }
  } catch {
    // fail-open: return what we have
  }
  return { body, decisions };
}
