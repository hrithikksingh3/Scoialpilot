import { timingSafeEqual } from "node:crypto";

type Req = { method?: string; headers: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined> };
type Res = { status: (code: number) => Res; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
const OWNER = "hrithikksingh3";
const REPO = "Scoialpilot";
function authorized(req: Req): boolean {
  const expected = process.env.DASHBOARD_ACCESS_TOKEN;
  const raw = req.headers.authorization;
  const supplied = Array.isArray(raw) ? raw[0] : raw;
  if (!expected || !supplied?.startsWith("Bearer ")) return false;
  const a = Buffer.from(supplied.slice(7)), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function github(path: string) {
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub Actions API returned HTTP ${response.status}${response.status === 403 ? ". Add a fine-grained GITHUB_ACTIONS_TOKEN with Actions: read permission." : ""}.${detail.slice(0,180)}`);
  }
  return response.json() as Promise<any>;
}
export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  try {
    const rawId = req.query?.run_id;
    const runId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (runId !== undefined) {
      if (!/^\d{1,20}$/.test(runId)) return res.status(400).json({ error: "Invalid workflow run ID" });
      const [run, jobs] = await Promise.all([
        github(`actions/runs/${runId}`),
        github(`actions/runs/${runId}/jobs?per_page=50`)
      ]);
      return res.status(200).json({
        run: { id: run.id, name: run.name, status: run.status, conclusion: run.conclusion, event: run.event, branch: run.head_branch, commit: run.head_sha, createdAt: run.created_at, startedAt: run.run_started_at, updatedAt: run.updated_at, runNumber: run.run_number, htmlUrl: run.html_url, durationMs: run.run_started_at ? Math.max(0, new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) : null },
        jobs: (jobs.jobs || []).map((job: any) => ({ id: job.id, name: job.name, status: job.status, conclusion: job.conclusion, startedAt: job.started_at, completedAt: job.completed_at, htmlUrl: job.html_url, steps: (job.steps || []).map((step: any) => ({ name: step.name, status: step.status, conclusion: step.conclusion, number: step.number, startedAt: step.started_at, completedAt: step.completed_at })) }))
      });
    }
    const result = await github("actions/runs?per_page=20");
    return res.status(200).json({ fetchedAt: new Date().toISOString(), runs: (result.workflow_runs || []).map((run: any) => ({ id: run.id, name: run.name, status: run.status, conclusion: run.conclusion, event: run.event, branch: run.head_branch, commit: run.head_sha, createdAt: run.created_at, startedAt: run.run_started_at, updatedAt: run.updated_at, runNumber: run.run_number, htmlUrl: run.html_url, durationMs: run.run_started_at && run.updated_at ? Math.max(0, new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) : null })) });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not load GitHub Actions runs" });
  }
}