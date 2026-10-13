import pg from "pg";
import { timingSafeEqual } from "node:crypto";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });
type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
function authorized(req: Req): boolean {
  const expected = process.env.DASHBOARD_ACCESS_TOKEN;
  const raw = req.headers.authorization;
  const supplied = Array.isArray(raw) ? raw[0] : raw;
  if (!expected || !supplied?.startsWith("Bearer ")) return false;
  const a = Buffer.from(supplied.slice(7)), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST" || !req.body || typeof req.body !== "object") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST with id and decision required" });
  }
  const body = req.body as { id?: unknown; decision?: unknown };
  if (typeof body.id !== "string" || !["approve", "reject"].includes(String(body.decision))) return res.status(400).json({ error: "Invalid id or decision" });
  const next = body.decision === "approve" ? "approved" : "rejected";
  try {
    const result = await pool.query(
      "UPDATE content_drafts SET review_status = $2, updated_at = NOW() WHERE id = $1 AND review_status = 'pending_approval' RETURNING id, review_status, publishing_status",
      [body.id, next]
    );
    if (!result.rowCount) return res.status(409).json({ error: "Draft not found or no longer pending review" });
    return res.status(200).json({ updated: true, ...result.rows[0], note: "No content was published." });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Database update failed" });
  }
}
