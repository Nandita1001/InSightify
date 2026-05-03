import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export function isGroqConfigured() {
  return typeof env.GROQ_API_KEY === "string" && env.GROQ_API_KEY.length > 10;
}

/**
 * Low-level Groq chat-completions call.
 * Throws ApiError on failure so the controller layer can translate to HTTP.
 */
export async function groqChat({ system, user, model, temperature }) {
  if (!isGroqConfigured()) {
    throw new ApiError(503, "LLM provider not configured");
  }

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: model ?? env.GROQ_MODEL,
      messages,
      temperature: temperature ?? env.GROQ_TEMPERATURE,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Map upstream 429 to our 429 so clients can back off consistently.
    const status = res.status === 429 ? 429 : 502;
    throw new ApiError(status, `Upstream LLM error (${res.status})`, body.slice(0, 500));
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new ApiError(502, "LLM returned an empty response");
  return text;
}
