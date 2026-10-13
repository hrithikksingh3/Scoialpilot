# Scoialpilot — Social Content Automation

Scoialpilot is a free-first content research, AI-assisted drafting, review, and scheduling workspace for Codersvoice. It is designed to fail closed when free AI capacity is unavailable; it must never silently use paid AI.

## Current implementation

- [x] Public RSS research from Hacker News, GitHub Blog, and Cloudflare Blog
- [x] Story scoring, topic diversity, and duplicate reduction
- [x] Gemini drafting with explicitly free OpenRouter fallback
- [x] Neon/PostgreSQL persistence for drafts and review status
- [x] Protected Vercel dashboard with token authentication
- [x] Edit captions, approve/reject drafts, and view draft status
- [x] Separate draft-generation schedule (daily batch count, local time, timezone)
- [x] Separate publishing-queue controls (posts/day, start time, interval, timezone)
- [x] Approval and availability validation before reserving drafts
- [x] Unique draft reservation and next-day scheduling when today's first slot has passed
- [x] Responsive dashboard styling for mobile, tablet, and desktop
- [x] CI type-check and test workflow
- [x] Opt-in due-queue worker and text-only adapters for Threads, Facebook Pages, and LinkedIn Company Pages
- [ ] Add platform credentials/permissions and verify each platform with a controlled test post
- [x] Per-platform delivery ledger with post IDs, attempts, error states, and ambiguous-outcome protection
- [x] Dashboard queue view with per-platform delivery statuses, errors, and returned post IDs
- [x] Independent Threads/Facebook/LinkedIn publishing switches persisted in Neon; all default off
- [ ] Queue cancellation/rescheduling controls

**Important:** The worker and text-post adapters are implemented, but real publishing remains opt-in and is not verified until valid platform credentials and permissions are configured. Queueing alone is not publishing. Keep both repository variables `PUBLISHING_ENABLED=false` and `PUBLISH_DRY_RUN=true` until you intentionally enable live posting. The worker will not publish with the default settings.

## Deployment

### Vercel dashboard

Deploy the repository root on Vercel, with the main branch connected. Configure these environment variables in Vercel:

- DATABASE_URL: Neon PostgreSQL connection string (server-side only).
- DASHBOARD_ACCESS_TOKEN: long random dashboard access token.

Redeploy after changing environment variables. The static UI is public/index.html; serverless endpoints live under api/.

### GitHub Actions

Configure repository Actions secrets:

- DATABASE_URL
- GEMINI_API_KEY
- OPENROUTER_API_KEY (optional fallback)\n- THREADS_ACCESS_TOKEN and THREADS_USER_ID\n- FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID (Facebook Page only, not a personal profile)\n- LINKEDIN_ACCESS_TOKEN and LINKEDIN_ORGANIZATION_ID

Optional repository variables:

- OPENROUTER_FREE_MODEL: an explicitly free model identifier, ideally ending in :free.
- GEMINI_MODEL: Gemini model ID.

Do not commit secrets or paste them into chat. Keep ALLOW_PAID_AI=false; the pipeline intentionally stops rather than falling back to paid AI.

### Database schema

Apply migrations in order if not already created:

1. database/schema/001_research.sql
2. database/schema/002_content_drafts.sql
3. database/schema/003_publish_queue.sql
4. database/schema/004_publish_deliveries.sql
5. database/schema/005_platform_settings.sql

The dashboard API creates schedule/queue tables if missing; the publishing worker creates its delivery ledger if missing. Migrations are included to make the schema reproducible.

## Run and test locally

Requirements: Node.js 20+.

```bash
npm install
npm run typecheck
npm test
npm run research
npm run generate-drafts
npm run list-drafts
```

Draft generation requires a recent reports/latest.json and configured free-tier AI/database environment variables. Never enable paid AI as an automatic fallback.

## Daily scheduling behavior

Draft generation and publishing queue reservation are separate:

- **Draft generation schedule:** creates a batch of 1–5 draft candidates at the configured local hour. GitHub Actions checks hourly, so the time should be selected on an hourly boundary for reliable operation.
- **Publishing queue:** reserves 1–5 already-approved, not-yet-reserved drafts at the chosen start time and interval. If the first slot for today has passed, the queue begins tomorrow. If the selected slots cross midnight or there are not enough approved drafts, the request is rejected.
- **Publishing status:** queue status is not proof of delivery. Real publishing remains disabled until a worker and platform adapters are connected.

## Free-tier and safety policy

- No paid AI provider is enabled or required.
- Research uses public feeds/endpoints where possible.
- Do not add paid APIs, hosted workers, or billing-dependent services as critical-path dependencies without explicit approval.
- Keep tokens in Vercel environment variables or GitHub Actions secrets.
- The worker processes only due, approved queue items. Per-platform delivery state is recorded independently.
- Platform switches are controlled in the dashboard and persisted in Neon. All default off; only checked platforms are eligible. Missing settings fail closed.
- A network timeout or ambiguous platform response is marked `unknown` and is not automatically retried, to reduce duplicate-post risk. Check the platform manually before any retry.
- Initial adapters publish text only; visual/image upload is not implemented.
- Real publishing must remain disabled until platform permissions, token validity, and controlled end-to-end posts are verified.
