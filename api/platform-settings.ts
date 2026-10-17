import pg from "pg";
import { timingSafeEqual } from "node:crypto";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });
type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
const platforms = ["threads", "facebook", "linkedin"] as const;
type Platform = typeof platforms[number];
type Settings = Record<Platform, boolean>;

function authorized(req: Req): boolean {
  const expected = process.env.DASHBOARD_ACCESS_TOKEN;
  const raw = req.headers.authorization;
  const supplied = Array.isArray(raw) ? raw[0] : raw;
  if (!expected || !supplied?.startsWith("Bearer ")) return false;
  const a = Buffer.from(supplied.slice(7)), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function fail(res: Res, code: number, error: string) { return res.status(code).json({ error }); }
const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS content_platform_settings (
 id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 threads_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 facebook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 linkedin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 auto_approve_before_publish BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE content_platform_settings ADD COLUMN IF NOT EXISTS auto_approve_before_publish BOOLEAN NOT NULL DEFAULT FALSE;
INSERT INTO content_platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
`;
function normalize(row?: Record<string, unknown>): Settings & { autoApproveBeforePublish: boolean } {
 return {
  threads: row?.threads_enabled === true,
  facebook: row?.facebook_enabled === true,
  linkedin: row?.linkedin_enabled === true,
  autoApproveBeforePublish: row?.auto_approve_before_publish === true
 };
}
export default async function handler(req: Req, res: Res) {
 res.setHeader("Cache-Control", "no-store");
 if (!authorized(req)) return fail(res, 401, "Unauthorized");
 try {
  await pool.query(CREATE_SQL);
  if (req.method === "GET") {
   const result = await pool.query("SELECT threads_enabled,facebook_enabled,linkedin_enabled,auto_approve_before_publish,updated_at FROM content_platform_settings WHERE id=1");
   return res.status(200).json({ settings: normalize(result.rows[0]), updatedAt: result.rows[0]?.updated_at ?? null, note: "Generated content is automatic. Approval is checked only when a scheduled post reaches its publishing time." });
  }
  if (req.method !== "PUT") { res.setHeader("Allow", "GET, PUT"); return fail(res, 405, "Method not allowed"); }
  if (!req.body || typeof req.body !== "object") return fail(res, 400, "Invalid request body");
  const body = req.body as Record<string, unknown>;
  if (platforms.some(p => typeof body[p] !== "boolean") || typeof body.autoApproveBeforePublish !== "boolean") return fail(res, 400, "Provide platform booleans and autoApproveBeforePublish.");
  const result = await pool.query(
   `INSERT INTO content_platform_settings(id,threads_enabled,facebook_enabled,linkedin_enabled,auto_approve_before_publish,updated_at)
    VALUES(1,$1,$2,$3,$4,NOW()) ON CONFLICT(id) DO UPDATE SET
    threads_enabled=EXCLUDED.threads_enabled,facebook_enabled=EXCLUDED.facebook_enabled,
    linkedin_enabled=EXCLUDED.linkedin_enabled,auto_approve_before_publish=EXCLUDED.auto_approve_before_publish,updated_at=NOW()
    RETURNING threads_enabled,facebook_enabled,linkedin_enabled,auto_approve_before_publish,updated_at`,
   [body.threads, body.facebook, body.linkedin, body.autoApproveBeforePublish]
  );
  return res.status(200).json({ settings: normalize(result.rows[0]), updatedAt: result.rows[0].updated_at, note: "Saved. Approval is requested only at publishing time when auto-approve is off." });
 } catch (error) {
  return fail(res, 500, error instanceof Error ? error.message : "Platform settings failed");
 }
}
