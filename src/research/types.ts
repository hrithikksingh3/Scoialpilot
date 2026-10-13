export interface ResearchSource {
  name: string;
  url: string;
  kind: "rss";
}

export interface ResearchStory {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  summary: string;
  imageUrl?: string;
  score: number;
  matchedSignals: string[];
}

export interface SourceFailure {
  source: string;
  error: string;
}

export interface ResearchReport {
  generatedAt: string;
  sourcesChecked: number;
  storiesFound: number;
  stories: ResearchStory[];
  failures: SourceFailure[];
}
