require('dotenv').config();

const BASE_URL = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const API_KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10);

function extractJSON(text) {
  if (text == null) throw new Error('callLLM: LLM returned empty content');
  const raw = String(text).trim();
  const attempts = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1].trim());
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) attempts.push(raw.slice(firstBrace, lastBrace + 1));
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (_) { /* try next strategy */ }
  }
  throw new Error(`callLLM: could not parse JSON from LLM response: ${raw.slice(0, 200)}`);
}

/**
 * Extracts appendable text from one SSE `data:` line.
 * Returns '' for control lines ([DONE], usage-only chunks, reasoning-only
 * deltas from thinking models such as GLM which put chain-of-thought in
 * `delta.reasoning_content` instead of `delta.content`).
 */
function sseLineToContent(line) {
  const trimmed = String(line).trim();
  if (!trimmed || !trimmed.startsWith('data:')) return '';
  const dataStr = trimmed.slice(5).trim();
  if (!dataStr || dataStr === '[DONE]') return '';
  let parsed;
  try {
    parsed = JSON.parse(dataStr);
  } catch (_) {
    return ''; // ignore non-JSON stream data lines
  }
  const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
  const content = delta && delta.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Some providers return content parts: [{ type: 'text', text: '...' }]
    return content.map((p) => (typeof p === 'string' ? p : p.text || '')).join('');
  }
  return '';
}

/** Parses a complete SSE payload held in memory (non-stream fallback). */
function collectSSEText(text) {
  let out = '';
  for (const line of String(text).split('\n')) {
    out += sseLineToContent(line);
  }
  return out;
}

/**
 * Shared LLM wrapper. Makes one chat-completion call to an OpenAI-compatible
 * API (TokenRouter, OpenAI, Groq, Ollama's compat layer, ...) and returns the
 * parsed JSON object from the response.
 *
 * Mock mode: when LLM_API_KEY is not set, returns `options.mock` instead
 * (resolved with the user input if it is a function). This keeps the harness
 * fully runnable/demonstrable before a real key is configured.
 *
 * @param {string} systemPrompt   agent-specific system prompt (must demand JSON output)
 * @param {object|string} userInput
 * @param {object} [options]      { mock: object | function(input), timeoutMs?: number, temperature?: number }
 * @returns {Promise<object>}     parsed JSON from the LLM
 */
async function callLLM(systemPrompt, userInput, options = {}) {
  if (!API_KEY) {
    if (options.mock === undefined) {
      throw new Error('callLLM: LLM_API_KEY is not set and no mock fallback was provided');
    }
    const mock = typeof options.mock === 'function' ? options.mock(userInput) : options.mock;
    console.log('[callLLM] mock mode — no LLM_API_KEY set, using deterministic fallback');
    return mock;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUT_MS);
  try {
    // NOTE: keep the request body minimal (model/temperature/messages/stream).
    // Extra fields like `stream_options` / `extra_body` are rejected by some
    // OpenAI-compatible gateways (TokenRouter returns 503 for them) — verified
    // by direct testing: same request without those fields returns 200.
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: typeof options.temperature === 'number' ? options.temperature : 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: typeof userInput === 'string' ? userInput : JSON.stringify(userInput) },
        ],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`callLLM: API responded ${res.status} — ${body.slice(0, 300)}`);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    // Some gateways ignore `stream: true` and return a plain JSON body.
    // Handle that case instead of hanging while waiting for SSE chunks.
    if (!contentType.includes('text/event-stream')) {
      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        // Might still be SSE bytes with a wrong content-type — fall through.
        parsed = null;
      }
      if (parsed) {
        const content = parsed.choices && parsed.choices[0] &&
          (parsed.choices[0].message ? parsed.choices[0].message.content : parsed.choices[0].text);
        if (content) return extractJSON(content);
        throw new Error(`callLLM: non-stream response had no message content: ${text.slice(0, 200)}`);
      }
      // Fall through to SSE parsing of `text` below.
      return extractJSON(collectSSEText(text));
    }

    // Read SSE stream chunks matching stream=true response.
    // Race each read against the abort signal so a stalled stream still
    // respects the timeout and falls back to the mock instead of hanging.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    const aborted = new Promise((_, reject) => {
      if (controller.signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      controller.signal.addEventListener('abort', () => {
        reader.cancel().catch(() => {});
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });

    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last incomplete line in buffer

      for (const line of lines) {
        const chunk = sseLineToContent(line);
        if (chunk) fullText += chunk;
      }
    }
    if (buffer.trim()) {
      const chunk = sseLineToContent(buffer);
      if (chunk) fullText += chunk;
    }

    if (!fullText.trim()) {
      throw new Error('callLLM: stream completed without any delta content');
    }
    return extractJSON(fullText);
  } catch (err) {
    const errMsg = err.name === 'AbortError' ? 'callLLM: request timed out' : err.message;
    if (options.mock !== undefined) {
      console.warn(`[callLLM] Live call error (${errMsg}). Falling back to mock implementation.`);
      return typeof options.mock === 'function' ? options.mock(userInput) : options.mock;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callLLM, extractJSON };
