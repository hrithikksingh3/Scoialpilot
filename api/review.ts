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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT review_status FROM content_drafts WHERE id=$1 FOR UPDATE", [body.id]);
    if (!current.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Draft not found" }); }
    const currentStatus = String(current.rows[0].review_status);
    const allowed = body.decision === "approve" ? ["ready", "pending_approval", "rejected"] : ["ready", "pending_approval"];
    if (!allowed.includes(currentStatus)) { await client.query("ROLLBACK"); return res.status(409).json({ error: `Draft is not eligible for final approval from status ${currentStatus}.` }); }

    await client.query("UPDATE content_drafts SET review_status=$2, updated_at=NOW() WHERE id=$1", [body.id, next]);

    if (next === "approved") {
      await client.query(
        "UPDATE content_publish_queue SET status='scheduled', updated_at=NOW() WHERE draft_id=$1 AND status='awaiting_approval'",
        [body.id]
      );
      await client.query(
        "UPDATE content_publish_deliveries SET status='pending', last_error=NULL, updated_at=NOW() WHERE draft_id=$1 AND status='awaiting_approval'",
        [body.id]
      );
    } else {
      await client.query(
        "UPDATE content_publish_queue SET status='cancelled', updated_at=NOW() WHERE draft_id=$1 AND status='awaiting_approval'",
        [body.id]
      );
      await client.query(
        "UPDATE content_publish_deliveries SET status='skipped', last_error='Rejected at final publish approval', updated_at=NOW() WHERE draft_id=$1 AND status='awaiting_approval'",
        [body.id]
      );
    }
    await client.query("COMMIT");
    return res.status(200).json({ updated: true, id: body.id, reviewStatus: next, finalPublishGate: next === "approved" ? "passed" : "rejected", note: next === "approved" ? "Final approval recorded. The existing scheduled time will be used for publishing." : "Publishing cancelled for this draft." });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: error instanceof Error ? error.message : "Database update failed" });
  } finally {
    client.release();
  }
}
