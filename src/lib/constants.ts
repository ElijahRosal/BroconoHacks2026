export const START_MODE_VALUES = [
  "regular-query",
  "query-to-research-plan",
  "claim-to-source",
] as const;

export type StartMode = (typeof START_MODE_VALUES)[number];

export const START_MODES: ReadonlyArray<{
  value: StartMode;
  label: string;
  description: string;
}> = [
  {
    value: "regular-query",
    label: "Regular Query",
    description: "Standard topic search against OpenAlex.",
  },
  {
    value: "query-to-research-plan",
    label: "Query-to-research-plan",
    description:
      "Generate refined research questions, keywords, and suggested queries first.",
  },
  {
    value: "claim-to-source",
    label: "Claim-to-source",
    description:
      "Start from a claim and rank sources by rationale and confidence.",
  },
] as const;

export const CITATION_STYLE_VALUES = [
  "MLA",
  "APA",
  "Chicago",
  "IEEE",
  "Harvard",
] as const;

export type CitationStyle = (typeof CITATION_STYLE_VALUES)[number];

export const GUEST_CITATION_HISTORY_KEY = "acfg_guest_citation_history_v1";
