import type { ResearchSource } from "./types.js";

export const RESEARCH_SOURCES: ResearchSource[] = [
  { name: "Hacker News", url: "https://hnrss.org/frontpage", kind: "rss" },
  { name: "GitHub Blog", url: "https://github.blog/feed/", kind: "rss" },
  { name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/", kind: "rss" },
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml", kind: "rss" },
  { name: "Google AI Blog", url: "https://blog.research.google/feeds/posts/default?alt=rss", kind: "rss" },
  { name: "Microsoft Developer Blogs", url: "https://devblogs.microsoft.com/feed/", kind: "rss" },
  { name: "The Register", url: "https://www.theregister.com/headlines.atom", kind: "rss" }
];
