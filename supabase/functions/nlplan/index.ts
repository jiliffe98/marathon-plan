// Supabase Edge Function: nlplan
// Turns a natural-language request into structured edits for the training plan.
// Your Anthropic API key lives here as a secret (ANTHROPIC_API_KEY) and is never
// exposed to the browser.
//
// Deploy: paste this into Supabase Dashboard -> Edge Functions -> new function "nlplan".
// Secret: Dashboard -> Edge Functions -> Secrets -> ANTHROPIC_API_KEY = sk-ant-...

const MODEL = "claude-haiku-4-5"; // change to "claude-opus-4-8" for higher quality at ~5x cost

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { instruction, plan } = await req.json();
    if (!instruction || !Array.isArray(plan)) {
      return json({ error: "Missing instruction or plan" }, 400);
    }
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "Server is missing ANTHROPIC_API_KEY" }, 500);

    const system =
      "You edit a marathon training plan. You receive the current plan as a list of days " +
      "(date, weekday, week number, and the planned sessions on that day), then a user request " +
      "in natural language. Respond ONLY by calling the propose_changes tool.\n\n" +
      "Rules:\n" +
      "- Session names look like: Intervals, Threshold, Easy/hills, Long run, Ride, Strength, Rest, Shakeout.\n" +
      "- All dates are YYYY-MM-DD and must be dates that appear in the plan.\n" +
      "- op 'move' relocates a planned session: set `from` (source date), `date` (destination), `session`.\n" +
      "- op 'add' adds a session to `date` (optional `km`).\n" +
      "- op 'remove' deletes `session` from `date`.\n" +
      "- op 'setkm' sets the distance of `session` on `date` to `km`.\n" +
      "- op 'note' attaches free text (`text`) to `date`.\n" +
      "- Only include changes the user actually asked for. Resolve relative dates (e.g. 'this Friday', " +
      "'next Sunday's long run') against the weekday/week info in the plan. If a request is impossible " +
      "(date not in plan), skip it and say so in the summary.\n" +
      "- `summary`: one or two plain-English sentences describing the COMPLETE set of proposed changes (the cumulative result).\n" +
      "- `reply`: one short, friendly sentence addressed to the user's MOST RECENT message specifically — " +
      "acknowledging what you just changed in response to it (or asking for clarification if it was unclear).";

    const tool = {
      name: "propose_changes",
      description: "Return the proposed edits to the training plan.",
      input_schema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One or two sentence summary of the complete proposed changes." },
          reply: { type: "string", description: "Short sentence answering the user's most recent message specifically." },
          ops: {
            type: "array",
            items: {
              type: "object",
              properties: {
                op: { type: "string", enum: ["move", "add", "remove", "setkm", "note"] },
                date: { type: "string", description: "Target date YYYY-MM-DD" },
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

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        tools: [tool],
        tool_choice: { type: "tool", name: "propose_changes" },
        messages: [
          {
            role: "user",
            content:
              "Current plan:\n" + JSON.stringify(plan) +
              "\n\nRequested change:\n" + instruction,
          },
        ],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) return json({ error: data?.error?.message || "Anthropic error" }, 502);
    const block = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
    if (!block) return json({ error: "No structured response from model" }, 502);
    return json(block.input, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
