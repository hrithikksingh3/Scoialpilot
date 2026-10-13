import pg from "pg";
import type { ContentDraft } from "./types.js";

const { Pool } = pg;

export async function saveDrafts(drafts: Array<{ provider: "gemini" | "openrouter"; draft: ContentDraft }>): Promise<{ saved: number; skipped: boolean }> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to save drafts to Neon. Refusing to report drafts as saved.");
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });
  try {
    await pool.query(`
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
        review_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (review_status IN ('pending_approval', 'approved', 'rejected')),
        publishing_status TEXT NOT NULL DEFAULT 'not_published' CHECK (publishing_status = 'not_published'),
        created_at_db TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_content_drafts_review_created ON content_drafts (review_status, created_at_db DESC);
    `);
    let saved = 0;
    for (const item of drafts) {
      const d = item.draft;
      await pool.query(
        `INSERT INTO content_drafts
          (id, created_at, provider, source_title, source_url, source_name, angle, factual_claims, platform_drafts, review_status, publishing_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'pending_approval', 'not_published')
         ON CONFLICT (id) DO NOTHING`,
        [d.id, d.createdAt, item.provider, d.source.title, d.source.url, d.source.sourceName, d.angle, JSON.stringify(d.factualClaims), JSON.stringify(d.platforms)]
      );
      saved += 1;
    }
    return { saved, skipped: false };
  } finally {
    await pool.end();
  }
}
