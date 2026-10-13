CREATE TABLE IF NOT EXISTS content_drafts (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'openrouter')),
  source_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  angle TEXT NOT NULL,
  factual_claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  platform_drafts JSONB NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (review_status IN ('pending_approval', 'approved', 'rejected')),
  publishing_status TEXT NOT NULL DEFAULT 'not_published'
    CHECK (publishing_status = 'not_published'),
  created_at_db TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_drafts_review_created
  ON content_drafts (review_status, created_at_db DESC);
