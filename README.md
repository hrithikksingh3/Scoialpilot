# Scoialpilot — Codersvoice Automation Engine

A cost-conscious content research and publishing engine for Codersvoice. The current milestone researches technology stories from public RSS feeds, scores and deduplicates them, writes a JSON report, and can persist the results to PostgreSQL.

## Current status

- [x] RSS ingestion from Hacker News, GitHub Blog, and Cloudflare Blog
- [x] Relevance/recency scoring and URL deduplication
- [x] JSON research report saved to `reports/latest.json`
- [x] Optional PostgreSQL persistence
- [x] GitHub Actions scheduled workflow and report artifact
- [x] TypeScript checks and unit tests in CI
- [ ] Neon database connection configured
- [ ] AI-assisted, evidence-backed platform drafts
- [ ] Approval dashboard
- [ ] Threads, Facebook Page, and LinkedIn publishing adapters

Publishing is not implemented and no posts are published by the current pipeline.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npm run typecheck
npm test
npm run research
```

The research job writes `reports/latest.json`. If all RSS feeds fail, the job exits unsuccessfully so the failure is visible in GitHub Actions.

## Enable Neon/PostgreSQL persistence

1. Create a free PostgreSQL project in Neon.
2. Copy its pooled or direct connection string from the Neon dashboard. Keep the password private.
3. In this repository, open **Settings → Secrets and variables → Actions → New repository secret**.
4. Name the secret `DATABASE_URL` and paste the connection string as its value.
5. Run **Actions → Research Pipeline → Run workflow**.
6. Open the run summary and download the `scoialpilot-research-report` artifact. The job summary reports whether persistence was enabled.

On the first successful database connection, the application creates the research tables automatically. The SQL migration is also available at `database/schema/001_research.sql`.

Do not put database credentials in source files, workflow YAML, issue comments, or commit history.

## Free-tier safety

- No paid AI provider is enabled or required.
- No social publishing is enabled in this milestone.
- If `DATABASE_URL` is not configured, the report is still generated and uploaded as an artifact; it is not stored permanently in Postgres.
- Provider free tiers can change. The architecture should stop or queue work instead of silently opting into paid usage.
