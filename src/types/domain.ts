import type { CitationStyle, StartMode } from "@/lib/constants";

export interface Source {
  id: string;
  title: string;
  authors: string[];
  publicationDate: string;
  citationCount: number;
  externalUrl: string;
  accessType?: "free" | "paid" | "unknown";
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

export interface ClaimMatchSearchResponse {
  originalClaim: string;
  refinedQuestion: string;
  retrievalQueries: string[];
  keywords: string[];
  page: number;
  limit: number;
  totalResults: number;
  hasMore: boolean;
  sources: Source[];
  matches: ClaimMatch[];
  matchError?: string;
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

export interface EnhancedQueryItem {
  id: string;
  userId: string;
  originalQuery: string;
  refinedQuestion: string;
  suggestedQueries: string[];
  selectedQuery: string;
  claimText: string;
  claimMatches: ClaimMatch[];
  createdAt: string;
}

export interface SavedSource {
  id: string;
  userId: string;
  openAlexId: string;
  title: string;
  authors: string[];
  publicationDate: string;
  citationCount: number;
  externalUrl: string;
  summary: string;
  createdAt: string;
}

export interface SavedCitation {
  id: string;
  userId: string;
  sourceId: string;
  sourceTitle: string;
  style: CitationStyle;
  citationText: string;
  createdAt: string;
}
