import type { ResearchStory } from "./types.js";

const SIGNALS: Array<{ label: string; pattern: RegExp; weight: number }> = [
  { label: "AI and models", pattern: /\b(ai|llm|language model|agentic|agent|inference|multimodal|generative)\b/i, weight: 3 },
  { label: "Developer tools", pattern: /\b(developer|open.source|sdk|api|framework|compiler|programming|github|database)\b/i, weight: 2 },
  { label: "New capability", pattern: /\b(launch|released?|introduc|breakthrough|available|new feature|now supports|open.sourc)\b/i, weight: 2 },
  { label: "Infrastructure", pattern: /\b(cloud|serverless|security|compute|chip|gpu|infrastructure|browser|robotics)\b/i, weight: 1 }
];

export function scoreStory(story: ResearchStory): ResearchStory {
  const text = `${story.title} ${story.summary}`;
  const matchedSignals = SIGNALS.filter((signal) => signal.pattern.test(text));
  const ageHours = story.publishedAt ? Math.max(0, (Date.now() - Date.parse(story.publishedAt)) / 3_600_000) : 72;
  const recencyBonus = ageHours <= 24 ? 2 : ageHours <= 72 ? 1 : 0;
  const score = matchedSignals.reduce((sum, signal) => sum + signal.weight, 0) + recencyBonus;
  return { ...story, score, matchedSignals: matchedSignals.map((signal) => signal.label) };
}

export function rankAndDeduplicate(stories: ResearchStory[]): ResearchStory[] {
  const unique = new Map<string, ResearchStory>();
  for (const story of stories) {
    const key = story.url.replace(/\/$/, "").toLowerCase();
    const previous = unique.get(key);
    if (!previous || story.score > previous.score) unique.set(key, story);
  }
  return [...unique.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
