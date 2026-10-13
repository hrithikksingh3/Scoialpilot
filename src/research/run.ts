import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RESEARCH_SOURCES } from "./sources.js";
import { fetchRssSource } from "./rss.js";
import { rankAndDeduplicate, scoreStory } from "./score.js";
import { persistResearchReport } from "./persistence.js";
import type { ResearchReport, SourceFailure } from "./types.js";

async function main(): Promise<void> {
  const failures: SourceFailure[] = [];
  const results = await Promise.all(RESEARCH_SOURCES.map(async (source) => {
    try {
      return await fetchRssSource(source);
    } catch (error) {
      failures.push({
        source: source.name,
        error: error instanceof Error ? error.message : "Unknown source error"
      });
      return [];
    }
  }));

  const stories = rankAndDeduplicate(results.flat().map(scoreStory));
  const report: ResearchReport = {
    generatedAt: new Date().toISOString(),
    sourcesChecked: RESEARCH_SOURCES.length,
    storiesFound: stories.length,
    stories: stories.slice(0, 30),
    failures
  };

  const reportPath = resolve("reports", "latest.json");
  await mkdir(resolve("reports"), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  let persistence: Awaited<ReturnType<typeof persistResearchReport>>;
  try {
    persistence = await persistResearchReport(report);
  } catch (error) {
    console.error("Database persistence failed:", error instanceof Error ? error.message : "Unknown database error");
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    status: "completed",
    reportPath: "reports/latest.json",
    generatedAt: report.generatedAt,
    sourcesChecked: report.sourcesChecked,
    storiesFound: report.storiesFound,
    sourceFailures: report.failures.length,
    persistence
  }, null, 2));

  if (stories.length === 0 && failures.length === RESEARCH_SOURCES.length) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Research pipeline failed:", error);
  process.exitCode = 1;
});
