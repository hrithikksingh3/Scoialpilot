import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ResearchReport } from "../research/types.js";
import type { ContentDraft } from "./types.js";
import { generateDraft } from "./gemini.js";
import { generateWithOpenRouter } from "./openrouter.js";

async function main(): Promise<void> {
  if (process.env.ALLOW_PAID_AI === "true") throw new Error("Paid AI is disabled. Set ALLOW_PAID_AI=false.");
  const reportPath = resolve(process.env.RESEARCH_REPORT_PATH || "reports/latest.json");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as ResearchReport;
  if (!Array.isArray(report.stories) || report.stories.length === 0) throw new Error("No research stories found. Run npm run research first.");

  const requested = Number.parseInt(process.env.DRAFT_LIMIT || "3", 10);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(3, requested)) : 3;
  const drafts: Array<{ provider: "gemini" | "openrouter"; draft: ContentDraft }> = [];
  const failures: Array<{ sourceUrl: string; provider: string; error: string }> = [];

  for (const story of report.stories.slice(0, limit)) {
    try {
      drafts.push({ provider: "gemini", draft: await generateDraft(story) });
    } catch (primaryError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : "Unknown Gemini error";
      failures.push({ sourceUrl: story.url, provider: "gemini", error: primaryMessage });
      // OpenRouter must be explicitly configured with a :free model. It will fail closed otherwise.
      try {
        drafts.push({ provider: "openrouter", draft: await generateWithOpenRouter(story) });
      } catch (fallbackError) {
        failures.push({ sourceUrl: story.url, provider: "openrouter", error: fallbackError instanceof Error ? fallbackError.message : "Unknown OpenRouter error" });
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    status: "completed",
    drafts,
    failures,
    reviewStatus: "pending_approval",
    publishingStatus: "not_published"
  };
  await mkdir(resolve("reports"), { recursive: true });
  await writeFile(resolve("reports", "drafts-latest.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    status: "completed",
    draftsGenerated: drafts.length,
    failures: failures.length,
    providersUsed: [...new Set(drafts.map((item) => item.provider))],
    reviewStatus: "pending_approval",
    publishingStatus: "not_published",
    outputPath: "reports/drafts-latest.json"
  }, null, 2));
  if (drafts.length === 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Content generation failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
