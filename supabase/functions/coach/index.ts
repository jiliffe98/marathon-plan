// Supabase Edge Function: coach
// A conversational marathon coach that can BOTH advise and edit the plan.
// It receives the user's question, the recent conversation, and a snapshot of
// their plan (editable days) + completed Strava sessions. For advice it replies
// with text; when the user asks to change the plan it also calls the
// propose_plan_changes tool, and the app renders those edits as an actionable
// card in the chat.
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
  "You are given their training plan (as editable day entries) and their completed sessions (pulled from " +
  "Strava, with pace and, for interval/threshold work, the rep breakdown). You do two things: answer their " +
  "questions with grounded coaching advice, and edit their plan when they ask.\n\n" +
  "ADVICE guidelines:\n" +
  "- Be concise and direct. Lead with the answer, then a sentence or two of why. Prefer 2-5 sentences or a short bullet list.\n" +
  "- Ground every claim in their actual data: cite specific sessions, weeks, paces, or weekly volumes rather than generalities.\n" +
  "- For balance questions (e.g. threshold vs intervals), count what they have actually done recently and compare it to the plan and to good marathon-prep practice.\n" +
  "- Give specific, actionable next steps. Units: kilometres and min/km pace.\n" +
  "- You are not a medical professional. If they mention pain or possible injury, advise caution and seeing a professional.\n" +
  "- Reply in plain text with light markdown (short **bold** labels, `- ` bullets). No preamble like \"Great question\"; just answer.\n\n" +
  "EDITING the plan:\n" +
  "- When the user asks to change the plan (move/add/remove a session, change a distance, add a note), call the " +
  "propose_plan_changes tool with the COMPLETE set of changes, AND give a one-sentence natural reply. Do NOT call " +
  "the tool for questions or advice — only when they actually want to change the plan. If a question implies a change " +
  "but they haven't asked for one, suggest it in words and offer to make it.\n" +
  "- Every date must be one of the plan days provided. Each day has \"wk\" (0 = this week, 1 = next week, -1 = last week) " +
  "and the day with \"today\":true is today. Use context.weekRanges for the Mon-Sun date span of each relative week.\n" +
  "- Resolve time strictly: \"today\"/\"tomorrow\"/\"yesterday\" by exact date; \"this week\" = ONLY wk 0; \"next week\" = ONLY wk 1; \"last week\" = ONLY wk -1.\n" +
  "- To locate a named session (e.g. \"the long run\") in a target week, SCAN that week's days and pick the exact day whose " +
  "sessions already include that name — it may be Saturday OR Sunday; never assume a weekday, never fall back to a different week.\n" +
  "- To change a session's distance, emit exactly ONE setkm op on the day that already contains it; do not remove-and-re-add, " +
  "do not move it, and do not touch other sessions. Only use 'add' when the target week has no session of that type at all.";

const TOOL = {
  name: "propose_plan_changes",
  description: "Propose concrete edits to the training plan. Call ONLY when the user actually wants to change the plan.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One short sentence describing the complete set of proposed changes." },
      ops: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["move", "add", "remove", "setkm", "note"] },
            date: { type: "string", description: "Target date YYYY-MM-DD (must be a plan day)" },
            from: { type: "string", description: "Source date (move only) YYYY-MM-DD" },
            session: { type: "string", description: "Session name" },
            km: { type: "number", description: "Distance in km" },
            text: { type: "string", description: "Note text (note only)" },
          },
          required: ["op", "date"],
        },
      },
    },
    required: ["summary", "ops"],
  },
};

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

    const clean = messages
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim())
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: m.content }));
    if (!clean.length || clean[0].role !== "user") {
      return json({ error: "Conversation must start with a user message" }, 400);
    }

    const dataBlock =
      "The runner's current training data (JSON). `days` are the editable plan days (date, weekday, week number, " +
      "\"wk\" relative-week offset, \"today\" flag, and current sessions). `done` are completed sessions with pace / rep " +
      "detail. `targets` are per-week volume and long-run goals. `weekRanges` gives Mon-Sun spans for relative weeks.\n\n" +
      JSON.stringify(context ?? {});

    const anthropicBody = JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: "disabled" },
      tools: [TOOL],
      system: [
        { type: "text", text: PERSONA },
        { type: "text", text: dataBlock, cache_control: { type: "ephemeral" } },
      ],
      messages: clean,
    });

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

      const blocks = data.content || [];
      const reply = blocks
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n")
        .trim();
      const toolUse = blocks.find((b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "propose_plan_changes");
      const out: Record<string, unknown> = { reply };
      if (toolUse && toolUse.input) {
        out.summary = toolUse.input.summary || "";
        out.ops = Array.isArray(toolUse.input.ops) ? toolUse.input.ops : [];
      }
      if (!reply && !toolUse) return json({ error: "No response from the coach" }, 502);
      return json(out, 200);
    }
    return json({ error: `The coach is busy right now — please try again in a moment. (${lastErr})` }, 503);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
