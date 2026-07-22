// Supabase Edge Function: coach
// A conversational marathon coach. Receives the user's question, the recent
// conversation, and a compact snapshot of their plan + completed Strava
// sessions, and returns grounded coaching advice.
// The Anthropic API key lives here as a secret (ANTHROPIC_API_KEY) and is never
// exposed to the browser.

const MODEL = "claude-opus-4-8"; // switch to "claude-sonnet-5" for faster, cheaper replies

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

const PERSONA =
  "You are an experienced, supportive marathon coach helping a runner prepare for the Sydney Marathon. " +
  "You are given their training plan and their completed sessions (pulled from Strava, with pace and, for " +
  "interval/threshold work, the rep breakdown). Answer their questions about progress, training balance, " +
  "and what to focus on.\n\n" +
  "Guidelines:\n" +
  "- Be concise and direct. Lead with the answer, then a sentence or two of why. Prefer 2-5 sentences or a short bullet list.\n" +
  "- Ground every claim in their actual data: cite specific sessions, weeks, paces, or weekly volumes rather than generalities.\n" +
  "- For balance questions (e.g. threshold vs intervals), count what they have actually done recently and compare it to the plan and to good marathon-prep practice.\n" +
  "- Give specific, actionable next steps, not generic platitudes.\n" +
  "- Units: kilometres and min/km pace, matching their data.\n" +
  "- You are not a medical professional. If they mention pain or possible injury, advise caution and seeing a professional.\n" +
  "- Reply in plain text with light markdown (short **bold** labels, `- ` bullets). No preamble like \"Great question\"; just answer.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { messages, context } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "Missing messages" }, 400);
    }
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "Server is missing ANTHROPIC_API_KEY" }, 500);

    // Keep only clean user/assistant turns, bounded to the most recent 20.
    const clean = messages
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim())
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: m.content }));
    if (!clean.length || clean[0].role !== "user") {
      return json({ error: "Conversation must start with a user message" }, 400);
    }

    const dataBlock =
      "The runner's current training data (JSON): plan targets per week, and their completed sessions " +
      "with type, distance and notes (pace / rep detail).\n\n" + JSON.stringify(context ?? {});

    const anthropicBody = JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: "disabled" }, // keep replies fast and to the point
      system: [
        { type: "text", text: PERSONA },
        { type: "text", text: dataBlock, cache_control: { type: "ephemeral" } },
      ],
      messages: clean,
    });

    // Retry transient Anthropic errors / empty bodies (same posture as nlplan).
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let lastErr = "Anthropic unavailable";
    for (let attempt = 0; attempt < 4; attempt++) {
      let resp: Response;
      try {
        resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: anthropicBody,
        });
      } catch {
        lastErr = "Network error contacting Anthropic";
        await sleep(400 * (attempt + 1));
        continue;
      }

      const raw = await resp.text();
      const transient = resp.status === 429 || resp.status === 529 || resp.status >= 500 || raw.trim() === "";
      if (transient && attempt < 3) {
        lastErr = raw.trim() === "" ? "Empty response from Anthropic" : `Anthropic ${resp.status}`;
        await sleep(500 * (attempt + 1));
        continue;
      }

      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        if (attempt < 3) { lastErr = "Malformed response from Anthropic"; await sleep(500 * (attempt + 1)); continue; }
        return json({ error: "The coach is busy right now — please try again in a moment." }, 503);
      }
      if (!resp.ok) return json({ error: data?.error?.message || "Anthropic error" }, 502);
      const reply = (data.content || [])
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n")
        .trim();
      if (!reply) return json({ error: "No response from the coach" }, 502);
      return json({ reply }, 200);
    }
    return json({ error: `The coach is busy right now — please try again in a moment. (${lastErr})` }, 503);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
