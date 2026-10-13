CREATE TABLE IF NOT EXISTS research_runs (
  id BIGSERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  sources_checked INTEGER NOT NULL DEFAULT 0,
  stories_found INTEGER NOT NULL DEFAULT 0,
  failures JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_stories (
  id BIGSERIAL PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  summary TEXT NOT NULL DEFAULT '',
  latest_score INTEGER NOT NULL DEFAULT 0,
  matched_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_run_stories (
  run_id BIGINT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  story_id BIGINT NOT NULL REFERENCES research_stories(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (run_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_research_stories_score
  ON research_stories (latest_score DESC, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_runs_generated_at
  ON research_runs (generated_at DESC);
