import pg from "pg";
import type { ResearchReport, ResearchStory } from "./types.js";

const { Pool } = pg;

const CREATE_TABLES_SQL = `
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
`;

export interface PersistenceResult {
  saved: boolean;
  runId?: string;
  storiesSaved: number;
  reason?: "DATABASE_URL_NOT_CONFIGURED";
}

export async function persistResearchReport(report: ResearchReport): Promise<PersistenceResult> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return { saved: false, storiesSaved: 0, reason: "DATABASE_URL_NOT_CONFIGURED" };
  }

  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 5_000
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(CREATE_TABLES_SQL);

    const runResult = await client.query<{ id: string }>(
      `INSERT INTO research_runs (generated_at, sources_checked, stories_found, failures)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [report.generatedAt, report.sourcesChecked, report.storiesFound, JSON.stringify(report.failures)]
    );
    const runId = runResult.rows[0]?.id;
    if (!runId) throw new Error("Database did not return a research run ID");

    let storiesSaved = 0;
    for (const [index, story] of report.stories.entries()) {
      const storyId = await upsertStory(client, story);
      await client.query(
        `INSERT INTO research_run_stories (run_id, story_id, score, position)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (run_id, story_id) DO UPDATE
         SET score = EXCLUDED.score, position = EXCLUDED.position`,
        [runId, storyId, story.score, index + 1]
      );
      storiesSaved += 1;
    }

    await client.query("COMMIT");
    return { saved: true, runId, storiesSaved };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function upsertStory(client: pg.PoolClient, story: ResearchStory): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO research_stories
       (canonical_url, title, source_name, published_at, summary, latest_score, matched_signals, last_seen_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
     ON CONFLICT (canonical_url) DO UPDATE SET
       title = EXCLUDED.title,
       source_name = EXCLUDED.source_name,
       published_at = COALESCE(EXCLUDED.published_at, research_stories.published_at),
       summary = EXCLUDED.summary,
       latest_score = EXCLUDED.latest_score,
       matched_signals = EXCLUDED.matched_signals,
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [
      canonicalizeUrl(story.url),
      story.title,
      story.source,
      story.publishedAt,
      story.summary,
      story.score,
      JSON.stringify(story.matchedSignals)
    ]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Database did not return a story ID");
  return id;
}

function canonicalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|ref_src)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "");
}
