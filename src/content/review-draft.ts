import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  const [id, decision] = process.argv.slice(2);
  if (!id || !["approve", "reject"].includes(decision ?? "")) {
    console.error("Usage: npm run review-draft -- <draft-id> <approve|reject>");
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 });
  try {
    const reviewStatus = decision === "approve" ? "approved" : "rejected";
    const result = await pool.query(
      `UPDATE content_drafts
       SET review_status = $2, updated_at = NOW()
       WHERE id = $1 AND review_status = 'pending_approval'
       RETURNING id, review_status, publishing_status`,
      [id, reviewStatus]
    );
    if (result.rowCount === 0) {
      throw new Error("Draft not found or it is no longer pending approval. No change was made.");
    }
    console.log(JSON.stringify({
      updated: true,
      ...result.rows[0],
      note: "Approval only records your decision. Publishing remains disabled."
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Review failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
