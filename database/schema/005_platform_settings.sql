-- Independent fail-closed auto-publishing switches for each platform.
-- All platforms start disabled. Dashboard selections are persisted in Neon.
CREATE TABLE IF NOT EXISTS content_platform_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  threads_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  facebook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  linkedin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO content_platform_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
