import type { ResearchStory } from "../research/types.js";

const TOPICS: Array<{ name: string; pattern: RegExp }> = [
  { name: "AI", pattern: /\b(ai|llm|model|agent|inference|generative|machine learning)\b/i },
  { name: "Security", pattern: /\b(security|vulnerabilit|breach|privacy|auth|encryption|malware)\b/i },
  { name: "Developer tools", pattern: /\b(github|developer|sdk|api|framework|compiler|programming|ide|editor)\b/i },
  { name: "Cloud", pattern: /\b(cloud|serverless|worker|compute|database|hosting|infrastructure|network)\b/i },
  { name: "Open source", pattern: /\b(open.source|repository|license|maintainer|community)\b/i },
  { name: "Consumer tech", pattern: /\b(phone|laptop|app|browser|social|device|consumer)\b/i },
  { name: "Startups", pattern: /\b(startup|funding|business|company|launch|product)\b/i }
];

export function topicForStory(story: ResearchStory): string {
  const text = `${story.title} ${story.summary}`;
  return TOPICS.find(topic => topic.pattern.test(text))?.name ?? "Tech discoveries";
}

export function selectDiverseStories(stories: ResearchStory[], limit = 3): ResearchStory[] {
  const selected: ResearchStory[] = [];
  const remaining = [...stories];
  const topicCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  while (selected.length < limit && remaining.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    remaining.forEach((story, index) => {
      const topic = topicForStory(story);
      const source = story.source.toLowerCase();
      const diversityBonus = 5 / (1 + (topicCounts.get(topic) ?? 0)) + 2 / (1 + (sourceCounts.get(source) ?? 0));
      const value = story.score + diversityBonus;
      if (value > bestScore) { bestScore = value; bestIndex = index; }
    });
    const [story] = remaining.splice(bestIndex, 1);
    if (story) {
      selected.push(story);
      const topic = topicForStory(story);
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      const source = story.source.toLowerCase();
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
  }
  return selected;
}
