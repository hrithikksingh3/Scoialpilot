import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 5000
});

type Platform = "threads" | "facebook" | "linkedin";
type PlatformDraft = { platform: Platform; caption: string; hook?: string; callToAction?: string; hashtags?: string[]; visualUrl?: string };
type DueRow = { queue_id: string; draft_id: string; scheduled_at: Date; review_status: string; platform_drafts: PlatformDraft[] };
type Delivery = { id: string; queue_id: string; draft_id: string; platform: Platform; attempts: number };

const env = (key: string) => process.env[key]?.trim() ?? "";
const enabledPlatforms: Platform[] = ["threads", "facebook", "linkedin"];

function textFor(draft: PlatformDraft): string {
  return [draft.hook, draft.caption, draft.callToAction, ...(draft.hashtags ?? [])]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n")
    .trim();
}

function requireCredentials(platform: Platform): void {
  if (platform === "threads" && (!env("THREADS_ACCESS_TOKEN") || !env("THREADS_USER_ID"))) {
    throw new Error("Missing THREADS_ACCESS_TOKEN or THREADS_USER_ID");
  }
  if (platform === "facebook" && (!env("FACEBOOK_PAGE_ACCESS_TOKEN") || !env("FACEBOOK_PAGE_ID"))) {
    throw new Error("Missing FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_PAGE_ID");
  }
  if (platform === "linkedin" && (!env("LINKEDIN_ACCESS_TOKEN") || !env("LINKEDIN_ORGANIZATION_ID") || !/^\d{6}$/.test(env("LINKEDIN_VERSION")))) {
    throw new Error("Missing LinkedIn token/org ID or invalid LINKEDIN_VERSION (YYYYMM)");
  }
}

async function requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
  const body = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = body ? JSON.parse(body) as Record<string, unknown> : {}; } catch { /* preserve safe status below */ }
  if (!response.ok) {
    const message = typeof parsed.error === "object" && parsed.error !== null && "message" in parsed.error
      ? String((parsed.error as { message: unknown }).message)
      : typeof parsed.message === "string" ? parsed.message : `HTTP ${response.status}`;
    throw new Error(`${message} (HTTP ${response.status})`);
  }
  return parsed;
}

async function publishThreads(text: string): Promise<string> {
  requireCredentials("threads");
  const userId = encodeURIComponent(env("THREADS_USER_ID"));
  const token = env("THREADS_ACCESS_TOKEN");
  const container = await requestJson(`https://graph.threads.net/v1.0/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ media_type: "TEXT", text, access_token: token })
  });
  if (typeof container.id !== "string") throw new Error("Threads did not return a creation container ID");
  const published = await requestJson(`https://graph.threads.net/v1.0/${userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: container.id, access_token: token })
  });
  if (typeof published.id !== "string") throw new Error("Threads did not return a post ID");
  return published.id;
}

async function publishFacebook(text: string): Promise<string> {
  requireCredentials("facebook");
  const pageId = encodeURIComponent(env("FACEBOOK_PAGE_ID"));
  const result = await requestJson(`https://graph.facebook.com/v23.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ message: text, access_token: env("FACEBOOK_PAGE_ACCESS_TOKEN") })
  });
  if (typeof result.id !== "string") throw new Error("Facebook did not return a post ID");
  return result.id;
}

async function publishLinkedIn(text: string): Promise<string> {
  requireCredentials("linkedin");
  const organizationId = env("LINKEDIN_ORGANIZATION_ID").replace(/^urn:li:organization:/, "");
  if (!/^\d+$/.test(organizationId)) throw new Error("LINKEDIN_ORGANIZATION_ID must be a numeric organization ID or organization URN");
  const result = await requestJson("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("LINKEDIN_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": env("LINKEDIN_VERSION"),
      "X-Restli-Protocol-Version": "2.0.0"
    },
    body: JSON.stringify({
      author: `urn:li:organization:${organizationId}`,
      commentary: text,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false
    })
  });
  const headerId = result.id;
  if (typeof headerId === "string") return headerId;
  throw new Error("LinkedIn did not return a post ID; verify API response and permissions");
}

async function publish(platform: Platform, draft: PlatformDraft): Promise<string> {
  const text = textFor(draft);
  if (!text) throw new Error("Caption is empty");
  if (text.length > 500 && platform === "threads") throw new Error("Threads text exceeds the supported 500-character limit");
  if (platform === "threads") return publishThreads(text);
  if (platform === "facebook") return publishFacebook(text);
  return publishLinkedIn(text);
}

async function ensureDeliveryRows(row: DueRow): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      "SELECT review_status, platform_drafts FROM content_drafts WHERE id=$1 FOR UPDATE",
      [row.draft_id]
    );
    if (!locked.rowCount || locked.rows[0].review_status !== "approved") {
      await client.query("UPDATE content_publish_queue SET status='cancelled', updated_at=NOW() WHERE id=$1 AND status='scheduled'", [row.queue_id]);
      await client.query("COMMIT");
      return;
    }
    const drafts = locked.rows[0].platform_drafts as PlatformDraft[];
    for (const draft of drafts) {
      if (!enabledPlatforms.includes(draft.platform)) continue;
      await client.query(
        `INSERT INTO content_publish_deliveries(queue_id,draft_id,platform,status)
         VALUES($1,$2,$3,'pending') ON CONFLICT(queue_id,platform) DO NOTHING`,
        [row.queue_id, row.draft_id, draft.platform]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function claimDelivery(): Promise<{ delivery: Delivery; draft: PlatformDraft } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query(
      `SELECT x.id, x.queue_id, x.draft_id, x.platform, x.attempts,
              d.platform_drafts
       FROM content_publish_deliveries x
       JOIN content_publish_queue q ON q.id=x.queue_id
       JOIN content_drafts d ON d.id=x.draft_id
       WHERE x.status='pending' AND q.status='scheduled' AND q.scheduled_at <= NOW()
         AND d.review_status='approved'
       ORDER BY q.scheduled_at, x.id
       FOR UPDATE OF x SKIP LOCKED LIMIT 1`
    );
    if (!selected.rowCount) { await client.query("COMMIT"); return null; }
    const row = selected.rows[0] as { id: string; queue_id: string; draft_id: string; platform: Platform; attempts: number; platform_drafts: PlatformDraft[] };
    const updated = await client.query(
      "UPDATE content_publish_deliveries SET status='processing', attempts=attempts+1, last_error=NULL, updated_at=NOW() WHERE id=$1 AND status='pending' RETURNING id",
      [row.id]
    );
    if (!updated.rowCount) { await client.query("ROLLBACK"); return null; }
    await client.query("COMMIT");
    const draft = row.platform_drafts.find(item => item.platform === row.platform);
    if (!draft) {
      await pool.query("UPDATE content_publish_deliveries SET status='failed',last_error='Platform draft missing',updated_at=NOW() WHERE id=$1", [row.id]);
      return null;
    }
    return { delivery: { id: row.id, queue_id: row.queue_id, draft_id: row.draft_id, platform: row.platform, attempts: Number(row.attempts) + 1 }, draft };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function finalizeQueue(queueId: string): Promise<void> {
  await pool.query(
    `UPDATE content_publish_queue q SET
       status=CASE
         WHEN EXISTS(SELECT 1 FROM content_publish_deliveries d WHERE d.queue_id=q.id AND d.status IN ('pending','processing')) THEN 'scheduled'
         WHEN EXISTS(SELECT 1 FROM content_publish_deliveries d WHERE d.queue_id=q.id AND d.status IN ('failed','unknown')) THEN 'failed'
         WHEN EXISTS(SELECT 1 FROM content_publish_deliveries d WHERE d.queue_id=q.id AND d.status='published')
           AND NOT EXISTS(SELECT 1 FROM content_publish_deliveries d WHERE d.queue_id=q.id AND d.status NOT IN ('published','skipped')) THEN 'published'
         ELSE 'scheduled' END,
       updated_at=NOW()
     WHERE q.id=$1`,
    [queueId]
  );
}

async function main(): Promise<void> {
  if (process.env.PUBLISHING_ENABLED !== "true") {
    console.log("Publishing disabled. Set PUBLISHING_ENABLED=true only after adding platform secrets and verifying permissions.");
    return;
  }
  if (process.env.PUBLISH_DRY_RUN !== "false") {
    console.log("Dry-run safety is enabled. Set PUBLISH_DRY_RUN=false to permit real publishing.");
    return;
  }
  if (!env("DATABASE_URL")) throw new Error("DATABASE_URL is required");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_publish_deliveries (
      id BIGSERIAL PRIMARY KEY,
      queue_id BIGINT NOT NULL REFERENCES content_publish_queue(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK (platform IN ('threads','facebook','linkedin')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','published','failed','unknown','skipped')),
      platform_post_id TEXT, attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_error TEXT, published_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(queue_id,platform)
    );
    CREATE INDEX IF NOT EXISTS idx_publish_deliveries_status ON content_publish_deliveries(status,updated_at);
  `);
  const due = await pool.query<DueRow>(
    `SELECT q.id AS queue_id, q.draft_id, q.scheduled_at, d.review_status, d.platform_drafts
     FROM content_publish_queue q JOIN content_drafts d ON d.id=q.draft_id
     WHERE q.status='scheduled' AND q.scheduled_at <= NOW()
     ORDER BY q.scheduled_at LIMIT 50`
  );
  for (const row of due.rows) await ensureDeliveryRows(row);

  let processed = 0;
  while (processed < 30) {
    const item = await claimDelivery();
    if (!item) break;
    processed++;
    try {
      const postId = await publish(item.delivery.platform, item.draft);
      await pool.query(
        "UPDATE content_publish_deliveries SET status='published',platform_post_id=$2,published_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1 AND status='processing'",
        [item.delivery.id, postId]
      );
      console.log(`Published delivery ${item.delivery.id} to ${item.delivery.platform}; platform ID recorded.`);
    } catch (error) {
      // Once a request has reached a platform, the outcome can be ambiguous (timeout, lost response).
      // Do not automatically retry: duplicate posts are worse than a manual reconciliation.
      const message = error instanceof Error ? error.message : "Unknown publishing error";
      const ambiguous = /timeout|timed out|fetch failed|socket|network|ECONNRESET|aborted/i.test(message);
      await pool.query(
        "UPDATE content_publish_deliveries SET status=$2,last_error=$3,updated_at=NOW() WHERE id=$1 AND status='processing'",
        [item.delivery.id, ambiguous ? "unknown" : "failed", message.slice(0, 1500)]
      );
      console.error(`Delivery ${item.delivery.id} to ${item.delivery.platform} ${ambiguous ? "has an unknown outcome; manual check required" : "failed"}: ${message}`);
    }
    await finalizeQueue(item.delivery.queue_id);
  }
  console.log(`Publish worker finished; deliveries processed: ${processed}.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => { await pool.end(); });
