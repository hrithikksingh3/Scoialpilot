-- Per-platform delivery ledger. Queue rows are master scheduled items; each platform
-- gets an independent delivery record so partial success is visible and not retried blindly.
CREATE TABLE IF NOT EXISTS content_publish_deliveries (
  id BIGSERIAL PRIMARY KEY,
  queue_id BIGINT NOT NULL REFERENCES content_publish_queue(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('threads', 'facebook', 'linkedin')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'published', 'failed', 'unknown', 'skipped')),
  platform_post_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (queue_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_publish_deliveries_status
  ON content_publish_deliveries (status, updated_at);
