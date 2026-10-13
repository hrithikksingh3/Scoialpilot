import test from "node:test";
import assert from "node:assert/strict";
import { persistResearchReport } from "../src/research/persistence.js";
import type { ResearchReport } from "../src/research/types.js";

const report: ResearchReport = {
  generatedAt: new Date().toISOString(),
  sourcesChecked: 0,
  storiesFound: 0,
  stories: [],
  failures: []
};

test("does not connect to a database when DATABASE_URL is absent", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await persistResearchReport(report);
    assert.deepEqual(result, {
      saved: false,
      storiesSaved: 0,
      reason: "DATABASE_URL_NOT_CONFIGURED"
    });
  } finally {
    if (previous !== undefined) process.env.DATABASE_URL = previous;
  }
});
