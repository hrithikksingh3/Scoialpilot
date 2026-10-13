import pg from "pg";

const { Pool } = pg;

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: get("hour") };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for scheduler configuration.");
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8000 });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS content_scheduler_config (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      drafts_per_day INTEGER NOT NULL DEFAULT 2 CHECK (drafts_per_day BETWEEN 1 AND 5),
      run_at_local TEXT NOT NULL DEFAULT '10:00' CHECK (run_at_local ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      last_run_local_date TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ); INSERT INTO content_scheduler_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`);
    await pool.query("ALTER TABLE content_scheduler_config ADD COLUMN IF NOT EXISTS last_run_local_date TEXT");
    const result = await pool.query("SELECT enabled, drafts_per_day, run_at_local, timezone, last_run_local_date FROM content_scheduler_config WHERE id=1");
    const config = result.rows[0];
    const now = localParts(new Date(), config.timezone);
    const hour = String(config.run_at_local).slice(0, 2);
    const isManual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
    const due = isManual || (config.enabled && now.hour === hour && config.last_run_local_date !== now.date);
    const limit = isManual ? Math.max(1, Math.min(5, Number(process.env.DRAFT_LIMIT || 2))) : Number(config.drafts_per_day);
    const output = process.env.GITHUB_OUTPUT;
    if (output) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(output, `should_run=${due}\ndraft_limit=${limit}\nlocal_date=${now.date}\n`);
    }
    console.log(JSON.stringify({ enabled: config.enabled, timezone: config.timezone, configuredTime: config.run_at_local, localDate: now.date, localHour: now.hour, alreadyRanToday: config.last_run_local_date === now.date, manual: isManual, shouldRun: due, draftLimit: limit }));
  } finally { await pool.end(); }
}

async function markRun() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8000 });
  try {
    await pool.query("UPDATE content_scheduler_config SET last_run_local_date = to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD'), updated_at=NOW() WHERE id=1");
    console.log("Scheduler run date recorded.");
  } finally { await pool.end(); }
}

if (process.argv[2] === "mark") await markRun();
else await main();
