import type { ResearchStory } from "../research/types.js";

const TOPICS: Array<{ name: string; pattern: RegExp }> = [
  { name: "AI models", pattern: /\\b(ai|llm|language model|multimodal|inference|foundation model|generative)\\b/i },
  { name: "AI agents", pattern: /\\b(agent|agentic|workflow automation|computer use|tool calling)\\b/i },
  { name: "Cybersecurity", pattern: /\\b(security|vulnerabilit|breach|privacy|auth|encryption|malware|ransomware|patch)\\b/i },
  { name: "Developer tools", pattern: /\\b(developer|sdk|api|framework|compiler|programming|ide|editor|debugger)\\b/i },
  { name: "Open source", pattern: /\\b(open.source|repository|license|maintainer|self.hosted|github)\\b/i },
  { name: "Cloud and infrastructure", pattern: /\\b(cloud|serverless|worker|compute|database|hosting|infrastructure|network|cdn|edge)\\b/i },
  { name: "Robotics and hardware", pattern: /\\b(robot|robotics|chip|gpu|processor|semiconductor|hardware|device)\\b/i },
  { name: "Consumer technology", pattern: /\\b(phone|laptop|browser|consumer|android|ios|smartphone|gadget)\\b/i },
  { name: "Startups and business", pattern: /\\b(startup|funding|valuation|acquisition|business|company|revenue|product launch)\\b/i },
  { name: "Science and research", pattern: /\\b(research|paper|scientist|experiment|study|benchmark|dataset)\\b/i },
  { name: "Creator economy", pattern: /\\b(creator|youtube|instagram|social media|content|video|monetiz|newsletter)\\b/i },
  { name: "Web and browsers", pattern: /\\b(browser|web platform|html|css|javascript|typescript|webassembly|webgpu)\\b/i }
];

export function topicForStory(story: ResearchStory): string {
  const text = `${story.title} ${story.summary}`;
  return TOPICS.find(topic => topic.pattern.test(text))?.name ?? "Tech discoveries";
}

function normalizedTitle(story: ResearchStory): string {
  return story.title.toLowerCase().replace(/https?:\\/\\/\\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function similarity(a: ResearchStory, b: ResearchStory): number {
  const words = (s: ResearchStory) => new Set(normalizedTitle(s).split(" ").filter(w => w.length > 3));
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap++;
  return overlap / (left.size + right.size - overlap);
}

export function selectDiverseStories(stories: ResearchStory[], limit = 3): ResearchStory[] {
  const remaining = [...stories].sort((a, b) => b.score - a.score);
  const selected: ResearchStory[] = [];
  const topicCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  while (selected.length < limit && remaining.length) {
    let bestIndex = -1;
    let bestValue = -Infinity;
    remaining.forEach((story, index) => {
      if (selected.some(previous => previous.url.replace(/\\/$/, "").toLowerCase() === story.url.replace(/\\/$/, "").toLowerCase())) return;
      const topic = topicForStory(story);
      const source = story.source.toLowerCase();
      const nearDuplicatePenalty = selected.reduce((penalty, previous) => Math.max(penalty, similarity(story, previous)), 0) * 8;
      const topicPenalty = (topicCounts.get(topic) ?? 0) * 7;
      const sourcePenalty = (sourceCounts.get(source) ?? 0) * 2;
      const value = story.score - topicPenalty - sourcePenalty - nearDuplicatePenalty;
      if (value > bestValue) { bestValue = value; bestIndex = index; }
    });
    if (bestIndex < 0) break;
    const [story] = remaining.splice(bestIndex, 1);
    if (!story) break;
    selected.push(story);
    const topic = topicForStory(story);
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    const source = story.source.toLowerCase();
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }
  return selected;
}
