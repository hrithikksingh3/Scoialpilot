import test from "node:test";
import assert from "node:assert/strict";
import { rankAndDeduplicate, scoreStory } from "../src/research/score.js";
import type { ResearchStory } from "../src/research/types.js";

const story = (overrides: Partial<ResearchStory> = {}): ResearchStory => ({
  title: "A new open-source AI developer tool was released",
  url: "https://example.com/story",
  source: "Test Feed",
  publishedAt: new Date().toISOString(),
  summary: "A developer API introduces a new capability.",
  score: 0,
  matchedSignals: [],
  ...overrides
});

test("scores relevant stories and records matching signals", () => {
  const scored = scoreStory(story());
  assert.ok(scored.score >= 5);
  assert.ok(scored.matchedSignals.includes("AI and models"));
  assert.ok(scored.matchedSignals.includes("Developer tools"));
});

test("deduplicates by URL and keeps the higher scoring story", () => {
  const lower = story({ score: 1, title: "Original title" });
  const higher = story({ score: 8, title: "Better version", url: "https://example.com/story/" });
  const result = rankAndDeduplicate([lower, higher]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.title, "Better version");
});

test("sorts highest score first", () => {
  const result = rankAndDeduplicate([
    story({ url: "https://example.com/low", score: 1 }),
    story({ url: "https://example.com/high", score: 10 })
  ]);
  assert.equal(result[0]?.score, 10);
});
