import type { CitationStyle, StartMode } from "@/lib/constants";

export interface Source {
  id: string;
  title: string;
  authors: string[];
  publicationDate: string;
  citationCount: number;
  externalUrl: string;
  summary?: string;
}

export interface ResearchPlanResponse {
  refinedQuestion: string;
  suggestedQueries: string[];
  keywords: string[];
  synonyms: string[];
}

export interface ClaimMatch {
  sourceId: string;
  score: number;
  confidence: "High" | "Medium" | "Low";
  rationale: string;
}

export interface ClaimMatchResponse {
  matches: ClaimMatch[];
}

export interface CitationResponse {
  citationText: string;
  style: CitationStyle;
}

export interface GuestCitationHistoryItem {
  id: string;
  sourceId: string;
  sourceTitle: string;
  style: CitationStyle;
  citationText: string;
  createdAt: string;
}

export interface SearchHistoryItem {
  id: string;
  userId: string;
  query: string;
  startMode: StartMode;
  createdAt: string;
}
