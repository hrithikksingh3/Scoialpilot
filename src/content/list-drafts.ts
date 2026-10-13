import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to list saved drafts.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 });
  try {
    const result = await pool.query<{
      id: string; created_at: Date; provider: string; source_title: string; source_url: string;
      source_name: string; angle: string; review_status: string; platform_drafts: unknown;
    }>(`SELECT id, created_at, provider, source_title, source_url, source_name, angle, review_status, platform_drafts
       FROM content_drafts WHERE review_status = 'pending_approval'
       ORDER BY created_at_db DESC LIMIT 50`);
    console.log(JSON.stringify({
      pendingCount: result.rowCount ?? result.rows.length,
      drafts: result.rows.map((row) => ({
        id: row.id, createdAt: row.created_at, provider: row.provider,
        source: { title: row.source_title, url: row.source_url, name: row.source_name },
        angle: row.angle, reviewStatus: row.review_status, platforms: row.platform_drafts
      }))
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Could not list drafts:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
