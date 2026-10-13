import pg from "pg";
import { timingSafeEqual } from "node:crypto";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });
type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
function authorized(req: Req): boolean {
  const expected = process.env.DASHBOARD_ACCESS_TOKEN;
  const raw = req.headers.authorization;
  const supplied = Array.isArray(raw) ? raw[0] : raw;
  if (!expected || !supplied?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(supplied.slice(7));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
function fail(res: Res, code: number, error: string) { return res.status(code).json({ error }); }
export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) return fail(res, 401, "Unauthorized");
  if (req.method === "GET") {
    try {
      const [rows, counts] = await Promise.all([
        pool.query(`SELECT id, created_at, provider, source_title, source_url, source_name, angle, platform_drafts, review_status
          FROM content_drafts ORDER BY created_at_db DESC LIMIT 100`),
        pool.query(`SELECT review_status, COUNT(*)::int AS count FROM content_drafts GROUP BY review_status`)
      ]);
      const countMap: Record<string, number> = { pending_approval: 0, approved: 0, rejected: 0 };
      for (const row of counts.rows) countMap[String(row.review_status)] = Number(row.count);
      return res.status(200).json({ drafts: rows.rows.map(row => ({
        id: row.id, createdAt: row.created_at, provider: row.provider,
        source: { title: row.source_title, url: row.source_url, sourceName: row.source_name },
        angle: row.angle, platforms: row.platform_drafts, reviewStatus: row.review_status
      })), counts: countMap });
    } catch (error) {
      return fail(res, 500, error instanceof Error ? error.message : "Database query failed");
    }
  }
  if (req.method === "PATCH") {
    if (!req.body || typeof req.body !== "object") return fail(res, 400, "Invalid request body");
    const body = req.body as { id?: unknown; captions?: unknown };
    if (typeof body.id !== "string" || !Array.isArray(body.captions)) return fail(res, 400, "Expected id and captions array");
    try {
      const current = await pool.query("SELECT platform_drafts FROM content_drafts WHERE id = $1", [body.id]);
      if (!current.rowCount) return fail(res, 404, "Draft not found");
      const platforms = current.rows[0].platform_drafts as Array<Record<string, unknown>>;
      const captions = body.captions as Array<{ platform?: unknown; caption?: unknown }>;
      for (const update of captions) {
        if (typeof update.platform !== "string" || typeof update.caption !== "string" || update.caption.length > 10000) return fail(res, 400, "Invalid caption edit");
        const found = platforms.find(p => p.platform === update.platform);
        if (!found) return fail(res, 400, "Unknown platform");
        found.caption = update.caption;
      }
      await pool.query("UPDATE content_drafts SET platform_drafts = $2::jsonb, updated_at = NOW() WHERE id = $1", [body.id, JSON.stringify(platforms)]);
      return res.status(200).json({ updated: true, publishingStatus: "not_published" });
    } catch (error) { return fail(res, 500, error instanceof Error ? error.message : "Could not save edits"); }
  }
  res.setHeader("Allow", "GET, PATCH");
  return fail(res, 405, "Method not allowed");
}
