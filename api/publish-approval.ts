import pg from "pg";
import { timingSafeEqual } from "node:crypto";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });
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
function fail(res: Res, code: number, error: string) { return res.status(code).json({ error }); }

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) return fail(res, 401, "Unauthorized");
  if (req.method !== "POST" || !req.body || typeof req.body !== "object") return fail(res, 405, "POST with deliveryId or queueId required");
  const body = req.body as { deliveryId?: unknown; queueId?: unknown; decision?: unknown };
  const decision = body.decision === "reject" ? "reject" : "approve";
  if ((typeof body.deliveryId !== "string" || !/^\d+$/.test(body.deliveryId)) && (typeof body.queueId !== "string" || !/^\d+$/.test(body.queueId))) return fail(res, 400, "Provide a numeric deliveryId or queueId.");
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS content_publish_deliveries (
      id BIGSERIAL PRIMARY KEY, queue_id BIGINT NOT NULL REFERENCES content_publish_queue(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', platform_post_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, published_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(queue_id,platform)
    );`);
    if (decision === "approve") {
      const result = typeof body.deliveryId === "string"
        ? await pool.query("UPDATE content_publish_deliveries SET status='pending',last_error='Approved for publishing by user',updated_at=NOW() WHERE id=$1 AND status='awaiting_approval' RETURNING id,queue_id,platform,status", [body.deliveryId])
        : await pool.query("UPDATE content_publish_deliveries SET status='pending',last_error='Approved for publishing by user',updated_at=NOW() WHERE queue_id=$1 AND status='awaiting_approval' RETURNING id,queue_id,platform,status", [body.queueId]);
      if (!result.rowCount) return fail(res, 409, "Nothing is waiting for approval, or it has already been handled.");
      return res.status(200).json({ approved: true, deliveries: result.rows, note: "Approved deliveries are now eligible for the publishing worker. No platform API call was made by this approval request." });
    }
    const result = typeof body.deliveryId === "string"
      ? await pool.query("UPDATE content_publish_deliveries SET status='skipped',last_error='Rejected at publishing approval step',updated_at=NOW() WHERE id=$1 AND status='awaiting_approval' RETURNING id,queue_id,platform,status", [body.deliveryId])
      : await pool.query("UPDATE content_publish_deliveries SET status='skipped',last_error='Rejected at publishing approval step',updated_at=NOW() WHERE queue_id=$1 AND status='awaiting_approval' RETURNING id,queue_id,platform,status", [body.queueId]);
    if (!result.rowCount) return fail(res, 409, "Nothing is waiting for approval, or it has already been handled.");
    return res.status(200).json({ rejected: true, deliveries: result.rows, note: "Rejected deliveries will not be published." });
  } catch (error) {
    return fail(res, 500, error instanceof Error ? error.message : "Publishing approval failed");
  }
}
