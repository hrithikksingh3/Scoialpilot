import type { ResearchSource } from "./types.js";

export const RESEARCH_SOURCES: ResearchSource[] = [
  {
    name: "Hacker News",
    url: "https://hnrss.org/frontpage",
    kind: "rss"
  },
  {
    name: "GitHub Blog",
    url: "https://github.blog/feed/",
    kind: "rss"
  },
  {
    name: "Cloudflare Blog",
    url: "https://blog.cloudflare.com/rss/",
    kind: "rss"
  }
];
