import type { ResearchSource, ResearchStory } from "./types.js";

const USER_AGENT = "ScoialpilotResearch/0.1 (+https://github.com/hrithikksingh3/Scoialpilot)";
const REQUEST_TIMEOUT_MS = 12_000;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstTag(block: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = block.match(new RegExp("<(?:[\\w.-]+:)?" + escaped + "\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?" + escaped + "\\s*>", "i"));
    if (match?.[1]) return decodeXml(match[1]);
  }
  return "";
}

function parseItems(xml: string): Array<{ title: string; url: string; date: string; summary: string; imageUrl?: string }> {
  const blocks = xml.match(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1\s*>/gi) ?? [];
  return blocks.map((block) => {
    const title = firstTag(block, ["title"]);
    const linkTag = block.match(/<link\b([^>]*)\/?\s*>/i);
    const href = linkTag?.[1]?.match(/href=["']([^"']+)["']/i)?.[1];
    const url = href || firstTag(block, ["link", "guid", "id"]);
    const date = firstTag(block, ["pubDate", "published", "updated", "date"]);
    const summary = firstTag(block, ["description", "summary", "content:encoded", "content"]);
    const imageMatch = block.match(/<(?:media:content|media:thumbnail|enclosure)\b([^>]*)\/?\s*>/i);
    const imageUrl = imageMatch?.[1]?.match(/(?:url|href)=["']([^"']+)["']/i)?.[1];
    return { title, url: url.trim(), date, summary, ...(imageUrl && /^https:\/\//i.test(imageUrl) ? { imageUrl } : {}) };
  }).filter((item) => item.title.length > 0 && /^https?:\/\//i.test(item.url));
}

export async function fetchRssSource(source: ResearchSource): Promise<ResearchStory[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    if (xml.length > 5_000_000) throw new Error("Feed exceeded 5 MB safety limit");
    return parseItems(xml).map((item) => ({
      title: item.title,
      url: item.url,
      source: source.name,
      publishedAt: item.date && !Number.isNaN(Date.parse(item.date)) ? new Date(item.date).toISOString() : null,
      summary: item.summary.slice(0, 1200),
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
      score: 0,
      matchedSignals: []
    }));
  } finally {
    clearTimeout(timeout);
  }
}
