// Supabase Edge Function: resync
// Triggers the "Strava sync" GitHub Action on demand (workflow_dispatch).
// Needs a GitHub token with Actions: write on jiliffe98/marathon-plan,
// stored as the Supabase secret GITHUB_TOKEN.
//
// Deploy:  supabase functions deploy resync --project-ref <ref>
// Secret:  Dashboard -> Edge Functions -> Secrets -> GITHUB_TOKEN = github_pat_...

const REPO = "jiliffe98/marathon-plan";
const WORKFLOW = "sync.yml";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const tok = Deno.env.get("GITHUB_TOKEN");
  if (!tok) return json({ error: "Server is missing GITHUB_TOKEN secret" }, 500);

  const r = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tok,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "marathon-plan-resync",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );

  if (r.status === 204) return json({ ok: true });
  const body = await r.text();
  return json({ error: `GitHub ${r.status}: ${body}` }, 502);
});
