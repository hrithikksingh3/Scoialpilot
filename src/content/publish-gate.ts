import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_platform_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      threads_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      facebook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      linkedin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      auto_approve_before_publish BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE content_platform_settings ADD COLUMN IF NOT EXISTS auto_approve_before_publish BOOLEAN NOT NULL DEFAULT FALSE;
    INSERT INTO content_platform_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

    ALTER TABLE content_publish_queue DROP CONSTRAINT IF EXISTS content_publish_queue_status_check;
    ALTER TABLE content_publish_queue ADD CONSTRAINT content_publish_queue_status_check
      CHECK (status IN ('scheduled','awaiting_approval','published','failed','cancelled'));
  `);

  const settings = await pool.query<{ auto_approve_before_publish: boolean }>(
    "SELECT auto_approve_before_publish FROM content_platform_settings WHERE id=1"
  );
  const autoApprove = settings.rows[0]?.auto_approve_before_publish === true;

  const due = await pool.query<{ queue_id: string; draft_id: string }>(
    `SELECT q.id AS queue_id, q.draft_id
       FROM content_publish_queue q
       JOIN content_drafts d ON d.id=q.draft_id
      WHERE q.status='scheduled' AND q.scheduled_at <= NOW()
        AND d.review_status='ready'
      ORDER BY q.scheduled_at, q.id
      LIMIT 100`
  );

  for (const row of due.rows) {
    if (autoApprove) {
      await pool.query(
        "UPDATE content_drafts SET review_status='approved', updated_at=NOW() WHERE id=$1 AND review_status='ready'",
        [row.draft_id]
      );
      console.log(`AUTO_APPROVED draft=${row.draft_id} queue=${row.queue_id} final publish gate passed.`);
    } else {
      await pool.query(
        "UPDATE content_publish_queue SET status='awaiting_approval', updated_at=NOW() WHERE id=$1 AND status='scheduled'",
        [row.queue_id]
      );
      await pool.query(
        "UPDATE content_drafts SET review_status='pending_approval', updated_at=NOW() WHERE id=$1 AND review_status='ready'",
        [row.draft_id]
      );
      console.log(`APPROVAL_REQUIRED draft=${row.draft_id} queue=${row.queue_id} scheduled time reached; no platform API request made.`);
    }
  }

  console.log(JSON.stringify({ status: "completed", due: due.rows.length, autoApprove, mode: autoApprove ? "automatic_publish" : "final_publish_approval" }));
}

main().catch((error: unknown) => {
  console.error("Publish gate failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
