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
const CREATE_SQL = `CREATE TABLE IF NOT EXISTS content_scheduler_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  drafts_per_day INTEGER NOT NULL DEFAULT 2 CHECK (drafts_per_day BETWEEN 1 AND 5),
  run_at_local TEXT NOT NULL DEFAULT '10:00' CHECK (run_at_local ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  last_run_local_date TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO content_scheduler_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;
export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    await pool.query(CREATE_SQL);
    if (req.method === "GET") {
      const result = await pool.query("SELECT enabled, drafts_per_day AS \"draftsPerDay\", run_at_local AS \"runAtLocal\", timezone, updated_at AS \"updatedAt\" FROM content_scheduler_config WHERE id = 1");
      return res.status(200).json(result.rows[0]);
    }
    if (req.method === "PUT") {
      if (!req.body || typeof req.body !== "object") return res.status(400).json({ error: "Invalid request body" });
      const body = req.body as { enabled?: unknown; draftsPerDay?: unknown; runAtLocal?: unknown; timezone?: unknown };
      if (typeof body.enabled !== "boolean" || !Number.isInteger(body.draftsPerDay) || Number(body.draftsPerDay) < 1 || Number(body.draftsPerDay) > 5 ||
          typeof body.runAtLocal !== "string" || !/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(body.runAtLocal) ||
          typeof body.timezone !== "string" || body.timezone.length > 80) return res.status(400).json({ error: "Choose 1–5 drafts/day, a valid time, and a timezone." });
      try { new Intl.DateTimeFormat("en", { timeZone: body.timezone }); } catch { return res.status(400).json({ error: "Invalid timezone" }); }
      const result = await pool.query(`UPDATE content_scheduler_config SET enabled=$1, drafts_per_day=$2, run_at_local=$3, timezone=$4, updated_at=NOW() WHERE id=1
        RETURNING enabled, drafts_per_day AS "draftsPerDay", run_at_local AS "runAtLocal", timezone, updated_at AS "updatedAt"`,
        [body.enabled, body.draftsPerDay, body.runAtLocal, body.timezone]);
      return res.status(200).json(result.rows[0]);
    }
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Scheduler settings failed" });
  }
}
