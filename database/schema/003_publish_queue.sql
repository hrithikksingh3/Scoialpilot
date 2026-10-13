-- Publishing schedule configuration and approval-gated queue.
-- Apply after 002_content_drafts.sql. Queue rows reserve approved drafts only;
-- this migration does not enable or perform social-platform publishing.
CREATE TABLE IF NOT EXISTS content_publish_schedule (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  posts_per_day INTEGER NOT NULL DEFAULT 1 CHECK (posts_per_day BETWEEN 1 AND 5),
  start_at_local TEXT NOT NULL DEFAULT '10:00'
    CHECK (start_at_local ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
  interval_hours INTEGER NOT NULL DEFAULT 2
    CHECK (interval_hours IN (1, 2, 3, 4, 6, 8)),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO content_publish_schedule (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS content_publish_queue (
  id BIGSERIAL PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE
    REFERENCES content_drafts(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'published', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_publish_queue_scheduled
  ON content_publish_queue (status, scheduled_at);
