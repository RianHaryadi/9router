/**
 * injectionFirewall.js — inbound tool-result injection scanner.
 *
 * Problem: agents reading web content or files can get prompt-injected via
 * tool_result content. Existing guardrails filter outbound; this scans INBOUND
 * tool outputs before they reach the LLM.
 *
 * Severity thresholds:
 *   - 'critical' → block (replace with '[BLOCKED: injection detected]')
 *   - 'high'     → strip (replace with sanitized version)
 *   - 'medium'   → warn (add warning marker, pass content)
 *   - 'low'      → pass with note (no action, log only)
 *
 * Built-in patterns (configurable via opts.patterns):
 *   a) Instruction override: /ignore\s+(all\s+|previous\s+|above\s+|...)*instructions/i
 *   b) Exfiltration: /send (this|the|my) (password|key|token|secret|env|\.env)/i
 *   c) URL exfil: /https?:\/\/[^\s]+\?(token|key|secret|password)=/i
 *   d) Shell injection: /\$\(|`[^`]*\$\{|;\s*(rm|curl|wget|nc)\s/i
 *   e) Role impersonation: /\[SYSTEM\]|<\|im_start\|>system/i
 *   f) Hidden base64: /[A-Za-z0-9+\/]{80,}={0,2}/ (long base64 blocks)
 *
 * Pure + fail-open. Never throws. Never blocks a request on internal errors.
 */

/**
 * @typedef {Object} Threat
 * @property {string} pattern - pattern name or regex source
 * @property {'critical'|'high'|'medium'|'low'} severity
 * @property {number} location - character index where match was found
 */

/**
 * @typedef {Object} ScanResult
 * @property {boolean} safe - true if no threats found
 * @property {Threat[]} threats - array of detected threats
 * @property {string} sanitized - cleaned content (if action='strip')
 * @property {'pass'|'warn'|'strip'|'block'} action - recommended action
 */

/**
 * @typedef {Object} ScannerInstance
 * @property {(content: string, opts?: object) => ScanResult} scan
 * @property {() => { scanned: number, blocked: number, stripped: number, warned: number }} stats
 * @property {(nameOrSpec: string|{name: string, pattern?: RegExp, regex?: RegExp, severity: string}, pattern?: RegExp, severity?: string) => void} addPattern
 * @property {(name: string) => boolean} removePattern
 */

/** Default built-in patterns. */
const DEFAULT_PATTERNS = [
  {
    name: "instruction-override",
    pattern: /ignore\s+(?:all\s+|previous\s+|above\s+|prior\s+|earlier\s+|any\s+)*instructions/i,
    severity: "critical",
  },
  {
    name: "exfiltration",
    pattern: /send (this|the|my) (password|key|token|secret|env|\.env)/i,
    severity: "critical",
  },
  {
    name: "url-exfil",
    pattern: /https?:\/\/[^\s]+\?(token|key|secret|password)=/i,
    severity: "high",
  },
  {
    name: "shell-injection",
    pattern: /\$\(|`[^`]*\$\{|;\s*(rm|curl|wget|nc)\s/i,
    severity: "high",
  },
  {
    name: "role-impersonation",
    pattern: /\[SYSTEM\]|<\|im_start\|>system/i,
    severity: "medium",
  },
  {
    name: "hidden-base64",
    pattern: /[A-Za-z0-9+\/]{80,}={0,2}/,
    severity: "low",
  },
];

/**
 * Create an injection scanner instance.
 * @param {object} [opts]
 * @param {Array<{name: string, pattern: RegExp, severity: string}>} [opts.patterns]
 *   Custom patterns to add/override. Each must have { name, pattern, severity }.
 * @returns {ScannerInstance}
 */
export function createInjectionScanner(opts = {}) {
  const patterns = new Map();
  const stats = { scanned: 0, blocked: 0, stripped: 0, warned: 0 };

  // Load defaults
  for (const p of DEFAULT_PATTERNS) {
    patterns.set(p.name, { ...p });
  }

  // Load custom patterns (override if same name)
  if (Array.isArray(opts.patterns)) {
    for (const p of opts.patterns) {
      if (p && typeof p.name === "string" && p.pattern instanceof RegExp && typeof p.severity === "string") {
        patterns.set(p.name, { name: p.name, pattern: p.pattern, severity: p.severity });
      }
    }
  }

  /**
   * Scan content for injection threats.
   * @param {string} content - text to scan
   * @param {object} [scanOpts]
   * @param {boolean} [scanOpts.sanitize=false] - if true, strip matched patterns from content
   * @returns {ScanResult}
   */
  function scan(content, scanOpts = {}) {
    try {
      stats.scanned++;
      if (typeof content !== "string" || content.length === 0) {
        return { safe: true, threats: [], sanitized: content || "", action: "pass" };
      }

      const threats = [];
      let sanitized = content;

      for (const [, p] of patterns) {
        const match = p.pattern.exec(content);
        if (match) {
          threats.push({
            pattern: p.name,
            severity: p.severity,
            location: match.index,
          });

          // If sanitizing, remove the matched portion
          if (scanOpts.sanitize) {
            sanitized = sanitized.replace(p.pattern, "[REDACTED]");
          }
        }
      }

      // Determine action by highest severity
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      let maxSeverity = "low";
      for (const t of threats) {
        if (severityOrder[t.severity] > severityOrder[maxSeverity]) {
          maxSeverity = t.severity;
        }
      }

      let action;
      if (maxSeverity === "critical") {
        action = "block";
        stats.blocked++;
      } else if (maxSeverity === "high") {
        action = "strip";
        stats.stripped++;
        // Ensure sanitized is computed even if not explicitly requested
        if (!scanOpts.sanitize) {
          sanitized = content;
          for (const p of patterns.values()) {
            if (p.severity === "high" || p.severity === "critical") {
              sanitized = sanitized.replace(p.pattern, "[REDACTED]");
            }
          }
        }
      } else if (maxSeverity === "medium") {
        action = "warn";
        stats.warned++;
      } else {
        action = "pass";
      }

      return {
        safe: threats.length === 0,
        threats,
        sanitized: action === "strip" ? sanitized : content,
        action,
      };
    } catch {
      // Fail-open: treat as safe
      return { safe: true, threats: [], sanitized: content || "", action: "pass" };
    }
  }

  /**
   * Add or override a pattern. Accepts either positional args or a single
   * spec object — mirroring the constructor's `opts.patterns` entries
   * ({ name, pattern, severity }; `regex` is accepted as an alias for `pattern`).
   * @param {string|{name: string, pattern?: RegExp, regex?: RegExp, severity: string}} nameOrSpec
   *   pattern identifier, or a spec object
   * @param {RegExp} [pattern] - regex to match (when not passed as an object)
   * @param {'critical'|'high'|'medium'|'low'} [severity]
   */
  function addPattern(nameOrSpec, pattern, severity) {
    try {
      let name, resolvedPattern, resolvedSeverity;
      if (nameOrSpec && typeof nameOrSpec === "object") {
        name = nameOrSpec.name;
        resolvedPattern = nameOrSpec.pattern ?? nameOrSpec.regex;
        resolvedSeverity = nameOrSpec.severity;
      } else {
        name = nameOrSpec;
        resolvedPattern = pattern;
        resolvedSeverity = severity;
      }
      if (typeof name !== "string" || !(resolvedPattern instanceof RegExp) || typeof resolvedSeverity !== "string") {
        return;
      }
      patterns.set(name, { name, pattern: resolvedPattern, severity: resolvedSeverity });
    } catch {
      // fail-open: ignore invalid patterns
    }
  }

  /**
   * Remove a pattern by name.
   * @param {string} name
   * @returns {boolean} true if removed
   */
  function removePattern(name) {
    try {
      return patterns.delete(name);
    } catch {
      return false;
    }
  }

  /**
   * Get scanner statistics.
   * @returns {{ scanned: number, blocked: number, stripped: number, warned: number }}
   */
  function getStats() {
    return { ...stats };
  }

  return { scan, stats: getStats, addPattern, removePattern };
}

/**
 * Scan all tool results in a message body and apply actions.
 * Walks body.messages, finds role='tool' or type='function_call_output' or
 * content blocks with type='tool_result', scans each, and modifies in place.
 *
 * @param {object} body - request body with messages array
 * @param {ScannerInstance} scanner - scanner from createInjectionScanner()
 * @returns {{ body: object, results: Array<{ index: number, action: string, threats: Threat[] }> }}
 */
export function scanToolResults(body, scanner) {
  const results = [];
  try {
    if (!body || typeof body !== "object" || !scanner || typeof scanner.scan !== "function") {
      return { body, results };
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || typeof msg !== "object") continue;

      // OpenAI: role='tool' with string content
      if (msg.role === "tool" && typeof msg.content === "string") {
        const scanResult = scanner.scan(msg.content, { sanitize: true });
        if (scanResult.action === "block") {
          msg.content = "[BLOCKED: injection detected]";
          results.push({ index: i, action: "block", threats: scanResult.threats });
        } else if (scanResult.action === "strip") {
          msg.content = scanResult.sanitized;
          results.push({ index: i, action: "strip", threats: scanResult.threats });
        } else if (scanResult.action === "warn") {
          // Add warning marker but keep content
          msg.content = `[WARNING: potential injection detected]\n${msg.content}`;
          results.push({ index: i, action: "warn", threats: scanResult.threats });
        } else if (!scanResult.safe) {
          results.push({ index: i, action: "pass", threats: scanResult.threats });
        }
        continue;
      }

      // OpenAI Responses: type='function_call_output'
      if (msg.type === "function_call_output") {
        if (typeof msg.output === "string") {
          const scanResult = scanner.scan(msg.output, { sanitize: true });
          if (scanResult.action === "block") {
            msg.output = "[BLOCKED: injection detected]";
            results.push({ index: i, action: "block", threats: scanResult.threats });
          } else if (scanResult.action === "strip") {
            msg.output = scanResult.sanitized;
            results.push({ index: i, action: "strip", threats: scanResult.threats });
          } else if (scanResult.action === "warn") {
            msg.output = `[WARNING: potential injection detected]\n${msg.output}`;
            results.push({ index: i, action: "warn", threats: scanResult.threats });
          } else if (!scanResult.safe) {
            results.push({ index: i, action: "pass", threats: scanResult.threats });
          }
        } else if (Array.isArray(msg.output)) {
          // output may be an array of content blocks
          for (const block of msg.output) {
            if (block && typeof block === "object" && typeof block.text === "string") {
              const scanResult = scanner.scan(block.text, { sanitize: true });
              if (scanResult.action === "block") {
                block.text = "[BLOCKED: injection detected]";
                results.push({ index: i, action: "block", threats: scanResult.threats });
              } else if (scanResult.action === "strip") {
                block.text = scanResult.sanitized;
                results.push({ index: i, action: "strip", threats: scanResult.threats });
              } else if (scanResult.action === "warn") {
                block.text = `[WARNING: potential injection detected]\n${block.text}`;
                results.push({ index: i, action: "warn", threats: scanResult.threats });
              } else if (!scanResult.safe) {
                results.push({ index: i, action: "pass", threats: scanResult.threats });
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
            // tool_result.content can be string or array of text blocks
            if (typeof block.content === "string") {
              const scanResult = scanner.scan(block.content, { sanitize: true });
              if (scanResult.action === "block") {
                block.content = "[BLOCKED: injection detected]";
                results.push({ index: i, action: "block", threats: scanResult.threats });
              } else if (scanResult.action === "strip") {
                block.content = scanResult.sanitized;
                results.push({ index: i, action: "strip", threats: scanResult.threats });
              } else if (scanResult.action === "warn") {
                block.content = `[WARNING: potential injection detected]\n${block.content}`;
                results.push({ index: i, action: "warn", threats: scanResult.threats });
              } else if (!scanResult.safe) {
                results.push({ index: i, action: "pass", threats: scanResult.threats });
              }
            } else if (Array.isArray(block.content)) {
              for (const textBlock of block.content) {
                if (textBlock && typeof textBlock === "object" && typeof textBlock.text === "string") {
                  const scanResult = scanner.scan(textBlock.text, { sanitize: true });
                  if (scanResult.action === "block") {
                    textBlock.text = "[BLOCKED: injection detected]";
                    results.push({ index: i, action: "block", threats: scanResult.threats });
                  } else if (scanResult.action === "strip") {
                    textBlock.text = scanResult.sanitized;
                    results.push({ index: i, action: "strip", threats: scanResult.threats });
                  } else if (scanResult.action === "warn") {
                    textBlock.text = `[WARNING: potential injection detected]\n${textBlock.text}`;
                    results.push({ index: i, action: "warn", threats: scanResult.threats });
                  } else if (!scanResult.safe) {
                    results.push({ index: i, action: "pass", threats: scanResult.threats });
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // fail-open: return what we have
  }
  return { body, results };
}
