// Live catalogs can return either router-qualified IDs or raw vendor IDs.
export function toChatRequestModel(providerId, rawId, providerAlias = providerId) {
  if (rawId.startsWith(`${providerId}/`) || rawId.startsWith(`${providerAlias}/`)) return rawId;
  return `${providerId}/${rawId}`;
}

function textContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => textContent(part?.text ?? part)).join("");
  return "";
}

function errorMessage(data, fallback) {
  return data?.error?.message || (typeof data?.error === "string" ? data.error : "") || data?.message || fallback;
}

// Keep SSE framing/UTF-8 decoding out of the component so transport failures
// cannot silently turn into empty successful assistant messages.
export async function readChatResponse(response, onText = () => {}) {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(errorMessage(data, `Request failed (${response.status})`));
  }
  if (response.headers.get("content-type")?.includes("application/json")) {
    const data = await response.json();
    if (data.error) throw new Error(errorMessage(data, "Request failed"));
    const text = textContent(data.choices?.[0]?.message?.content ?? data.output_text ?? data.text);
    if (!text) throw new Error("Model returned no text. Try a different model.");
    onText(text);
    return text;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response stream is unavailable.");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let complete = false;
  let doneSentinel = false;
  const consume = (frame) => {
    const payload = frame.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!payload) return;
    if (payload === "[DONE]") {
      complete = true;
      doneSentinel = true;
      return;
    }
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return; }
    if (chunk.error || chunk.type === "error") throw new Error(errorMessage(chunk, "Provider stream failed."));
    const choice = chunk.choices?.[0];
    const delta = textContent(choice?.delta?.content ?? choice?.message?.content ?? chunk.output_text ?? chunk.text);
    if (delta) {
      text += delta;
      onText(text);
    }
    if (choice?.finish_reason != null) complete = true;
  };
  const drain = () => {
    let boundary;
    while (!doneSentinel && (boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      consume(frame);
    }
  };
  try {
    while (!doneSentinel) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        // Normalize after concatenation, including CRLF split across reads.
        buffer = buffer.replace(/\r\n/g, "\n");
        drain();
        if (!doneSentinel && buffer.trim()) consume(buffer);
        break;
      }
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      drain();
    }
    if (!complete) throw new Error("Response stream interrupted. You can start a new chat and retry.");
    if (!text) throw new Error("Model returned no text. Try a different model.");
    return text;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
