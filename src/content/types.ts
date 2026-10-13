import type { ResearchStory } from "../research/types.js";

export type ContentPlatform = "threads" | "facebook" | "linkedin";

export interface PlatformDraft {
  platform: ContentPlatform;
  hook: string;
  caption: string;
  callToAction: string;
  hashtags: string[];
  visualUrl: string;
}

export interface ContentDraft {
  id: string;
  createdAt: string;
  source: {
    title: string;
    url: string;
    sourceName: string;
    publishedAt: string | null;
  };
  angle: string;
  factualClaims: string[];
  platforms: PlatformDraft[];
  reviewStatus: "pending_approval";
  publishingStatus: "not_published";
}

export interface DraftGenerationResult {
  status: "generated";
  provider: "gemini";
  model: string;
  drafts: ContentDraft[];
}
