/**
 * cascade.js — cascade routing with output verification.
 *
 * Problem: complexity routing can misclassify. Try cheap model first, verify output,
 * escalate to strong model if verification fails.
 *
 * Verification checks:
 *   a) JSON validity: if response_format is json, try parsing
 *   b) Tool call validity: if tool_calls present, check each has valid function.name + parseable arguments
 *   c) Code syntax: if response contains code blocks, check balanced braces/brackets
 *   d) Empty/too-short response: < 10 chars → fail
 *   e) Error patterns: response contains 'error', 'failed', 'cannot', 'unable' in first 200 chars → flag
 *
 * Factory pattern for stateful stats tracking. Pure + fail-open. Never throws.
 */

/**
 * Create a cascade verifier with stats tracking.
 * @param {object} [opts]
 * @param {() => number} [opts.now] - injectable clock for tests
 * @returns {{
 *   verify: (response: object, opts?: object) => { passed: boolean, failures: string[], shouldEscalate: boolean },
 *   canCascade: (body: object, opts?: object) => boolean,
 *   stats: () => { verified: number, passed: number, failed: number, escalated: number },
 * }}
 */
export function createCascadeVerifier({ now = () => Date.now() } = {}) {
  let verified = 0;
  let passed = 0;
  let failed = 0;
  let escalated = 0;

  /**
   * Resolve the message-shaped object of a response.
   * Accepts a full chat-completion response ({ choices: [...] }) as well as a
   * flat message-shaped object ({ content }, { tool_calls }, { message: {...} }).
   * @param {object} response
   * @returns {object|null}
   */
  function getResponseMessage(response) {
    if (!response || typeof response !== "object") return null;

    const choices = Array.isArray(response.choices) ? response.choices : [];
    if (choices.length > 0) {
      const first = choices[0];
      return first?.message || first;
    }
    if (response.message && typeof response.message === "object") return response.message;
    return response;
  }

  /**
   * Extract text content from a response.
   * @param {object} response - chat completion response (or flat message)
   * @returns {string}
   */
  function extractResponseText(response) {
    const message = getResponseMessage(response);
    if (!message) return "";

    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((p) => (typeof p?.text === "string" ? p.text : ""))
        .join("");
    }
    return "";
  }

  /**
   * Check if response contains valid JSON when a JSON response format is requested.
   * @param {object} response
   * @param {object} opts - verify opts: { body, responseFormat }
   * @returns {string|null} failure reason or null
   */
  function checkJsonValidity(response, opts = {}) {
    const format = opts.responseFormat ?? opts.body?.response_format;
    if (!format) return null;

    const isJson = typeof format === "string"
      ? (format === "json" || format === "json_object" || format === "json_schema")
      : (format === "json_object" || format?.type === "json_object" || !!format?.json_schema);
    if (!isJson) return null;

    const text = extractResponseText(response);
    if (!text.trim()) return "json-empty";

    try {
      JSON.parse(text);
      return null;
    } catch {
      return "json-parse-error";
    }
  }

  /**
   * Check if tool_calls are valid.
   * @param {object} response
   * @returns {string|null} failure reason or null
   */
  function checkToolCalls(response) {
    const message = getResponseMessage(response);
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length === 0) return null;

    for (const tc of toolCalls) {
      if (!tc?.function || typeof tc.function.name !== "string" || !tc.function.name) {
        return "tool-call-missing-name";
      }
      if (typeof tc.function.arguments !== "string") {
        return "tool-call-missing-arguments";
      }
      try {
        JSON.parse(tc.function.arguments);
      } catch {
        return "tool-call-invalid-arguments";
      }
    }

    return null;
  }

  /**
   * Check if code blocks have balanced braces/brackets.
   * @param {string} text
   * @returns {string|null} failure reason or null
   */
  function checkCodeSyntax(text) {
    // Extract code blocks
    const codeBlockRegex = /```[\s\S]*?```/g;
    const blocks = text.match(codeBlockRegex);
    if (!blocks || blocks.length === 0) return null;

    for (const block of blocks) {
      // Remove the ``` markers
      const code = block.replace(/```\w*\n?/, "").replace(/```$/, "");

      // Count braces and brackets
      let braceDepth = 0;
      let bracketDepth = 0;
      let inString = false;
      let stringChar = null;

      for (let i = 0; i < code.length; i++) {
        const ch = code[i];

        if (inString) {
          if (ch === "\\") { i++; continue; } // skip escaped chars
          if (ch === stringChar) inString = false;
          continue;
        }

        if (ch === '"' || ch === "'" || ch === "`") {
          inString = true;
          stringChar = ch;
          continue;
        }

        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        else if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;

        // Early exit if unbalanced
        if (braceDepth < 0 || bracketDepth < 0) {
          return "code-unbalanced-delimiters";
        }
      }

      if (braceDepth !== 0 || bracketDepth !== 0) {
        return "code-unbalanced-delimiters";
      }
    }

    return null;
  }

  /**
   * Check if response is empty or too short.
   * @param {string} text
   * @returns {string|null} failure reason or null
   */
  function checkEmptyResponse(text) {
    if (!text || text.trim().length < 10) {
      return "response-too-short";
    }
    return null;
  }

  /**
   * Check for error patterns in the first 200 chars.
   * @param {string} text
   * @returns {string|null} failure reason or null
   */
  function checkErrorPatterns(text) {
    const prefix = text.slice(0, 200).toLowerCase();
    const errorPatterns = ["error", "failed", "cannot", "unable"];

    for (const pattern of errorPatterns) {
      if (prefix.includes(pattern)) {
        return `error-pattern:${pattern}`;
      }
    }
    return null;
  }

  /**
   * Verify a response from a model.
   * @param {object} response - chat completion response (or flat message { content } / { tool_calls })
   * @param {object} [opts]
   * @param {object} [opts.body] - original request body (for response_format check)
   * @param {string|object} [opts.responseFormat] - response format shortcut (e.g. 'json')
   * @returns {{ passed: boolean, failures: string[], shouldEscalate: boolean }}
   */
  function verify(response, opts = {}) {
    try {
      verified++;

      // Fail-open: nothing to verify (invalid input) → pass through instead of
      // spuriously escalating every request.
      if (!response || typeof response !== "object") {
        return { passed: true, failures: [], shouldEscalate: false };
      }

      const failures = [];

      const text = extractResponseText(response);
      const message = getResponseMessage(response);
      const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;

      // a) JSON validity
      const jsonFail = checkJsonValidity(response, opts);
      if (jsonFail) failures.push(jsonFail);

      // b) Tool call validity
      const tcFail = checkToolCalls(response);
      if (tcFail) failures.push(tcFail);

      // c) Code syntax
      const codeFail = checkCodeSyntax(text);
      if (codeFail) failures.push(codeFail);

      // d) Empty/too-short — tool-call responses legitimately carry no text
      if (!hasToolCalls) {
        const emptyFail = checkEmptyResponse(text);
        if (emptyFail) failures.push(emptyFail);
      }

      // e) Error patterns
      const errorFail = checkErrorPatterns(text);
      if (errorFail) failures.push(errorFail);

      const passedCheck = failures.length === 0;
      if (passedCheck) {
        passed++;
      } else {
        failed++;
      }

      return {
        passed: passedCheck,
        failures,
        shouldEscalate: !passedCheck,
      };
    } catch {
      // Fail-open: verifier error → pass through
      return { passed: true, failures: ["verifier-error"], shouldEscalate: false };
    }
  }

  /**
   * Check if cascade routing is applicable for this request.
   * Cascade only for non-streaming, non-tool-result messages.
   * @param {object} body - chat completions body
   * @returns {boolean}
   */
  function canCascade(body) {
    try {
      if (!body || typeof body !== "object") return false;

      // No streaming
      if (body.stream === true) return false;

      // Check if last message is a tool result
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (messages.length === 0) return false;

      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "tool") return false;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get verification stats.
   * @returns {{ verified: number, passed: number, failed: number, escalated: number }}
   */
  function stats() {
    return { verified, passed, failed, escalated };
  }

  /**
   * Record an escalation (called by runner).
   */
  function recordEscalation() {
    escalated++;
  }

  return { verify, canCascade, stats, recordEscalation };
}

/**
 * Standalone canCascade check (for use in pipeline without creating a verifier instance).
 * @param {object} body - chat completions body
 * @returns {boolean}
 */
export function canCascade(body) {
  try {
    if (!body || typeof body !== "object") return false;
    if (body.stream === true) return false;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return false;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "tool") return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a cascade runner that tries cheap model first, verifies, escalates if needed.
 * @param {object} [opts]
 * @param {object} [opts.verifier] - verifier from createCascadeVerifier()
 * @returns {{
 *   run: (opts: { body: object, cheapModel: string, strongModel: string, dispatch: (body: object, model: string) => Promise<object> }) =>
 *     Promise<{ response: object, model: string, escalated: boolean, verifierResult: object }>,
 *   reset: () => void,
 *   stats: () => object,
 * }}
 */
export function createCascadeRunner({ verifier } = {}) {
  const v = verifier || createCascadeVerifier();

  /**
   * Run the cascade: try cheap → verify → escalate if fail.
   * Max 1 escalation per request.
   * @param {object} opts
   * @param {object} opts.body - chat completions body
   * @param {string} opts.cheapModel - model to try first
   * @param {string} opts.strongModel - model to escalate to
   * @param {(body: object, model: string) => Promise<object>} opts.dispatch - callback to invoke model
   * @returns {Promise<{ response: object, model: string, escalated: boolean, verifierResult: object }>}
   */
  async function run({ body, cheapModel, strongModel, dispatch }) {
    try {
      // Try cheap model first
      const cheapBody = { ...body, model: cheapModel };
      let response = await dispatch(cheapBody, cheapModel);
      let model = cheapModel;
      let escalated = false;

      // Verify the response
      const verifierResult = v.verify(response, { body });

      // If verification failed, escalate to strong model
      if (verifierResult.shouldEscalate && strongModel && strongModel !== cheapModel) {
        const strongBody = { ...body, model: strongModel };
        response = await dispatch(strongBody, strongModel);
        model = strongModel;
        escalated = true;
        v.recordEscalation();
      }

      return { response, model, escalated, verifierResult };
    } catch (error) {
      // Fail-open: if anything throws, return an error response
      return {
        response: { error: error.message || "cascade-runner-error" },
        model: strongModel || cheapModel,
        escalated: true,
        verifierResult: { passed: false, failures: ["runner-error"], shouldEscalate: true },
      };
    }
  }

  /**
   * Reset stats (useful for testing).
   */
  function reset() {
    // Verifier is stateful; we can't reset it from here unless we own it.
    // This is a no-op for now; stats are cumulative.
  }

  /**
   * Get stats from the verifier.
   */
  function stats() {
    return v.stats();
  }

  return { run, reset, stats };
}
