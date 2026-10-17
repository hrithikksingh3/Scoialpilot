import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });
type Platform = "threads" | "facebook" | "linkedin";
type PlatformDraft = { platform: Platform; caption: string; hook?: string; callToAction?: string; hashtags?: string[]; visualUrl?: string };
type Settings = Record<Platform, boolean> & { autoApproveBeforePublish: boolean };

const env = (key: string) => process.env[key]?.trim() ?? "";
const platforms: Platform[] = ["threads", "facebook", "linkedin"];

async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_publish_deliveries (
      id BIGSERIAL PRIMARY KEY,
      queue_id BIGINT NOT NULL REFERENCES content_publish_queue(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK (platform IN ('threads','facebook','linkedin')),
      status TEXT NOT NULL DEFAULT 'pending',
      platform_post_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_error TEXT,
      published_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(queue_id,platform)
    );
    ALTER TABLE content_publish_deliveries DROP CONSTRAINT IF EXISTS content_publish_deliveries_status_check;
    ALTER TABLE content_publish_deliveries ADD CONSTRAINT content_publish_deliveries_status_check
      CHECK (status IN ('pending','awaiting_approval','processing','published','failed','unknown','blocked','skipped'));
    CREATE INDEX IF NOT EXISTS idx_publish_deliveries_status ON content_publish_deliveries(status,updated_at);
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
  `);
}

async function settings(): Promise<Settings> {
  const result = await pool.query("SELECT threads_enabled,facebook_enabled,linkedin_enabled,auto_approve_before_publish FROM content_platform_settings WHERE id=1");
  const row = result.rows[0] ?? {};
  return {
    threads: row.threads_enabled === true,
    facebook: row.facebook_enabled === true,
    linkedin: row.linkedin_enabled === true,
    autoApproveBeforePublish: row.auto_approve_before_publish === true
  };
}

function textFor(draft: PlatformDraft): string {
  return [draft.hook, draft.caption, draft.callToAction, ...(draft.hashtags ?? [])]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n").trim();
}

function requireCredentials(platform: Platform): void {
  if (platform === "threads" && (!env("THREADS_ACCESS_TOKEN") || !env("THREADS_USER_ID"))) throw new Error("Missing THREADS_ACCESS_TOKEN or THREADS_USER_ID");
  if (platform === "facebook" && (!env("FACEBOOK_PAGE_ACCESS_TOKEN") || !env("FACEBOOK_PAGE_ID"))) throw new Error("Missing FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_PAGE_ID");
  if (platform === "linkedin" && (!env("LINKEDIN_ACCESS_TOKEN") || !env("LINKEDIN_ORGANIZATION_ID") || !/^\d{6}$/.test(env("LINKEDIN_VERSION")))) throw new Error("Missing LinkedIn token/org ID or invalid LINKEDIN_VERSION (YYYYMM)");
}

async function requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
  const body = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = body ? JSON.parse(body) as Record<string, unknown> : {}; } catch { /* keep HTTP status */ }
  if (!response.ok) {
    const message = typeof parsed.error === "object" && parsed.error !== null && "message" in parsed.error ? String((parsed.error as { message: unknown }).message) : typeof parsed.message === "string" ? parsed.message : `HTTP ${response.status}`;
    throw new Error(`${message} (HTTP ${response.status})`);
  }
  return parsed;
}

async function publish(platform: Platform, draft: PlatformDraft): Promise<string> {
  const text = textFor(draft);
  if (!text) throw new Error("Caption is empty");
  if (platform === "threads") {
    if (text.length > 500) throw new Error("Threads text exceeds the supported 500-character limit");
    requireCredentials(platform);
    const userId = encodeURIComponent(env("THREADS_USER_ID"));
    const token = env("THREADS_ACCESS_TOKEN");
    const container = await requestJson(`https://graph.threads.net/v1.0/${userId}/threads`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ media_type: "TEXT", text, access_token: token }) });
    if (typeof container.id !== "string") throw new Error("Threads did not return a creation container ID");
    const published = await requestJson(`https://graph.threads.net/v1.0/${userId}/threads_publish`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: container.id, access_token: token }) });
    if (typeof published.id !== "string") throw new Error("Threads did not return a post ID");
    return published.id;
  }
  if (platform === "facebook") {
    requireCredentials(platform);
    const result = await requestJson(`https://graph.facebook.com/v23.0/${encodeURIComponent(env("FACEBOOK_PAGE_ID"))}/feed`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ message: text, access_token: env("FACEBOOK_PAGE_ACCESS_TOKEN") }) });
    if (typeof result.id !== "string") throw new Error("Facebook did not return a post ID");
    return result.id;
  }
  requireCredentials(platform);
  const organizationId = env("LINKEDIN_ORGANIZATION_ID").replace(/^urn:li:organization:/, "");
  if (!/^\d+$/.test(organizationId)) throw new Error("LINKEDIN_ORGANIZATION_ID must be numeric");
  const response = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", headers: { Authorization: `Bearer ${env("LINKEDIN_ACCESS_TOKEN")}`, "Content-Type": "application/json", "LinkedIn-Version": env("LINKEDIN_VERSION"), "X-Restli-Protocol-Version": "2.0.0" }, body: JSON.stringify({ author: `urn:li:organization:${organizationId}`, commentary: text, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }), signal: AbortSignal.timeout(25000) });
  const body = await response.text();
  if (!response.ok) { let message = body || `HTTP ${response.status}`; try { const parsed = JSON.parse(body) as { message?: unknown }; if (typeof parsed.message === "string") message = parsed.message; } catch { /* keep body */ } throw new Error(`LinkedIn API: ${message} (HTTP ${response.status})`); }
  const headerId = response.headers.get("x-restli-id");
  if (headerId) return headerId;
  try { const parsed = body ? JSON.parse(body) as { id?: unknown } : {}; if (typeof parsed.id === "string") return parsed.id; } catch { /* successful response may have no JSON body */ }
  throw new Error("LinkedIn accepted the request but returned no post ID; delivery is unknown and must be reconciled");
}

async function ensureDeliveries(queueId: string, draftId: string, platformDrafts: PlatformDraft[], configured: Settings): Promise<void> {
  for (const platform of platforms) {
    if (!configured[platform]) continue;
    if (!platformDrafts.some(d => d.platform === platform)) {
      await pool.query("INSERT INTO content_publish_deliveries(queue_id,draft_id,platform,status,last_error) VALUES($1,$2,$3,'blocked',$4) ON CONFLICT(queue_id,platform) DO NOTHING", [queueId, draftId, platform, "Generated content has no draft for this platform"]);
      continue;
    }
    await pool.query("INSERT INTO content_publish_deliveries(queue_id,draft_id,platform,status) VALUES($1,$2,$3,'pending') ON CONFLICT(queue_id,platform) DO NOTHING", [queueId, draftId, platform]);
  }
}

async function claim(queueId: string): Promise<{ id: string; platform: Platform; draft: PlatformDraft } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT x.id,x.platform,d.platform_drafts FROM content_publish_deliveries x JOIN content_drafts d ON d.id=x.draft_id WHERE x.queue_id=$1 AND x.status='pending' ORDER BY x.id LIMIT 1 FOR UPDATE OF x SKIP LOCKED`, [queueId]);
    if (!result.rowCount) { await client.query("COMMIT"); return null; }
    const row = result.rows[0] as { id: string; platform: Platform; platform_drafts: PlatformDraft[] };
    const changed = await client.query("UPDATE content_publish_deliveries SET status='processing',attempts=attempts+1,last_error=NULL,updated_at=NOW() WHERE id=$1 AND status='pending' RETURNING id", [row.id]);
    if (!changed.rowCount) { await client.query("ROLLBACK"); return null; }
    await client.query("COMMIT");
    const draft = row.platform_drafts.find(item => item.platform === row.platform);
    if (!draft) { await pool.query("UPDATE content_publish_deliveries SET status='blocked',last_error='Platform draft missing',updated_at=NOW() WHERE id=$1", [row.id]); return null; }
    return { id: row.id, platform: row.platform, draft };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function finalize(queueId: string): Promise<void> {
  await pool.query(`UPDATE content_publish_queue q SET status=CASE
    WHEN EXISTS(SELECT 1 FROM content_publish_deliveries d WHERE d.queue_id=q.id AND d.status IN ('pending','awaiting_approval','processing')) THEN 'scheduled'
    WHEN EXISTS(SELECT 1 FROM content_publish_deliveries d WHERE d.queue_id=q.id AND d.status IN ('failed','unknown')) THEN 'failed'
    WHEN EXISTS(SELECT 1 FROM content_publish_deliveries d WHERE d.queue_id=q.id AND d.status='published')
      AND NOT EXISTS(SELECT 1 FROM content_publish_deliveries d WHERE d.queue_id=q.id AND d.status NOT IN ('published','skipped','blocked')) THEN 'published'
    WHEN EXISTS(SELECT 1 FROM content_publish_deliveries d WHERE d.queue_id=q.id AND d.status='blocked') THEN 'failed'
    ELSE 'cancelled' END, updated_at=NOW() WHERE q.id=$1`, [queueId]);
}

async function main(): Promise<void> {
  if (!env("DATABASE_URL")) throw new Error("DATABASE_URL is required");
  await ensureSchema();
  const configured = await settings();
  if (process.env.PUBLISHING_ENABLED !== "true" || process.env.PUBLISH_DRY_RUN !== "false") {
    console.log(JSON.stringify({ status: "blocked", reason: "Publishing safety gates are not enabled", apiCalls: 0 }));
    return;
  }
  const due = await pool.query<{ queue_id: string; draft_id: string; platform_drafts: PlatformDraft[] }>(`SELECT q.id AS queue_id,q.draft_id,d.platform_drafts FROM content_publish_queue q JOIN content_drafts d ON d.id=q.draft_id WHERE q.status='scheduled' AND q.scheduled_at<=NOW() ORDER BY q.scheduled_at LIMIT 50`);
  for (const row of due.rows) {
    await ensureDeliveries(row.queue_id, row.draft_id, row.platform_drafts, configured);
    if (!configured.autoApproveBeforePublish) {
      const pending = await pool.query(`UPDATE content_publish_deliveries SET status='awaiting_approval',last_error='Approval required at scheduled publish time',updated_at=NOW() WHERE queue_id=$1 AND status='pending' RETURNING id,platform`, [row.queue_id]);
      if (pending.rowCount) console.log(JSON.stringify({ status: "approval_required", queueId: row.queue_id, deliveries: pending.rows }));
      await finalize(row.queue_id);
      continue;
    }
    let processed = 0;
    while (processed < 30) {
      const item = await claim(row.queue_id);
      if (!item) break;
      processed++;
      try {
        const postId = await publish(item.platform, item.draft);
        await pool.query("UPDATE content_publish_deliveries SET status='published',platform_post_id=$2,published_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1", [item.id, postId]);
        console.log(JSON.stringify({ status: "published", deliveryId: item.id, platform: item.platform, postId }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown platform error";
        const unknown = /accepted|no post ID|timeout|timed out|ECONN|network/i.test(message);
        await pool.query("UPDATE content_publish_deliveries SET status=$2,last_error=$3,updated_at=NOW() WHERE id=$1", [item.id, unknown ? "unknown" : "failed", message.slice(0, 2000)]);
        console.error(JSON.stringify({ status: unknown ? "unknown" : "failed", deliveryId: item.id, platform: item.platform, error: message }));
      }
    }
    await finalize(row.queue_id);
  }
}

main().catch((error: unknown) => { console.error("Publish worker failed:", error instanceof Error ? error.message : error); process.exitCode = 1; });
