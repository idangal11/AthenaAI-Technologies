// AthenaAI chat proxy (Cloudflare Worker).
// The landing page sends the conversation here; this worker adds the business knowledge,
// calls the Claude API with the secret key, and returns the reply. The key never reaches the browser.
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, LEAD_TOOL } from "./knowledge.js";

const MAX_MESSAGES = 24;      // conversation turns kept per request
const MAX_CHARS = 1000;       // longest visitor message accepted
const MAX_TOKENS = 1024;      // reply budget (short chat answers)
const PKG = { basic: "דף נחיתה מעוצב", chatbot: "דף נחיתה + צ'אטבוט AI", agent: "דף נחיתה + פתרון AI עסקי מתקדם", unsure: "עדיין לא בטוח/ה" };

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    if (!cors) return json({ error: "origin" }, 403);
    if (request.method === "GET") return json({ ok: true, service: "athena-chat" }, 200, cors);
    if (request.method !== "POST") return json({ error: "method" }, 405, cors);

    if (env.CHAT_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.CHAT_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "rate" }, 429, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400, cors); }
    const messages = cleanMessages(body && body.messages);
    if (!messages) return json({ error: "bad_messages" }, 400, cors);
    const page = typeof body.page === "string" ? body.page.slice(0, 200) : "";

    if (!env.ANTHROPIC_API_KEY) return json({ error: "not_configured" }, 503, cors);
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) });

    try {
      let leadSaved = false;
      // At most one tool round: the bot may save a lead, then writes its reply.
      for (let round = 0; round < 2; round++) {
        const response = await client.messages.create({
          model: env.MODEL || "claude-haiku-5-5",
          max_tokens: MAX_TOKENS,
          output_config: { effort: "low" },
          // Tools and system prompt never change, so they are cached and billed at a fraction after the first visitor.
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools: [LEAD_TOOL],
          messages
        });

        if (response.stop_reason === "refusal") return json({ reply: "", fallback: true }, 200, cors);

        const toolUses = response.content.filter((b) => b.type === "tool_use");
        if (response.stop_reason === "tool_use" && toolUses.length && round === 0) {
          messages.push({ role: "assistant", content: response.content });
          const results = [];
          for (const use of toolUses) {
            let ok = false;
            if (use.name === LEAD_TOOL.name) { ok = await saveLead(use.input, env, page); leadSaved = leadSaved || ok; }
            results.push({ type: "tool_result", tool_use_id: use.id, content: ok ? "saved" : "failed: ask the visitor to use WhatsApp 052-426-8076 or the form", is_error: !ok });
          }
          messages.push({ role: "user", content: results });
          continue;
        }

        const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        return json({ reply, lead: leadSaved }, 200, cors);
      }
      return json({ reply: "", lead: leadSaved, fallback: true }, 200, cors);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 503, cors);
      if (err instanceof Anthropic.AuthenticationError) { console.error("bad ANTHROPIC_API_KEY"); return json({ error: "not_configured" }, 503, cors); }
      if (err instanceof Anthropic.APIError) { console.error("claude api error", err.status, err.message); return json({ error: "upstream" }, 502, cors); }
      console.error(err);
      return json({ error: "server" }, 500, cors);
    }
  }
};

function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const out = [];
  for (const m of list.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const text = m.content.trim().slice(0, MAX_CHARS);
    if (!text) continue;
    // Merge consecutive messages of the same role; the API expects alternating turns.
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += "\n" + text;
    else out.push({ role: m.role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

async function saveLead(input, env, page) {
  if (!env.LEAD_ENDPOINT || !input || !input.name || (!input.phone && !input.email)) return false;
  const data = new URLSearchParams();
  data.append("name", String(input.name));
  data.append("business", String(input.business || ""));
  data.append("phone", String(input.phone || ""));
  data.append("email", String(input.email || ""));
  data.append("package", PKG[input.interest] || "");
  data.append("page", ("צ'אט באתר | " + (input.summary || "") + (page ? " | " + page : "")).slice(0, 200));
  try {
    const r = await fetch(env.LEAD_ENDPOINT, { method: "POST", body: data });
    const d = await r.json();
    return !!(d && d.ok === true);
  } catch (e) {
    console.error("lead save failed", e);
    return false;
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
