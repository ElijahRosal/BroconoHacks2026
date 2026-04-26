import { CITATION_STYLE_VALUES, GUEST_CITATION_HISTORY_KEY, type CitationStyle } from "@/lib/constants";
import type { GuestCitationHistoryItem } from "@/types/domain";

interface CreateGuestCitationHistoryItemInput {
  sourceId: string;
  sourceTitle: string;
  style: CitationStyle;
  citationText: string;
}

const CITATION_STYLE_SET = new Set<string>(CITATION_STYLE_VALUES);

function isGuestCitationHistoryItem(value: unknown): value is GuestCitationHistoryItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    typeof item.sourceId === "string" &&
    typeof item.sourceTitle === "string" &&
    typeof item.style === "string" &&
    CITATION_STYLE_SET.has(item.style) &&
    typeof item.citationText === "string" &&
    typeof item.createdAt === "string"
  );
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createGuestCitationHistoryItem(
  input: CreateGuestCitationHistoryItemInput
): GuestCitationHistoryItem {
  return {
    id: createId(),
    sourceId: input.sourceId,
    sourceTitle: input.sourceTitle,
    style: input.style,
    citationText: input.citationText,
    createdAt: new Date().toISOString(),
  };
}

export function readGuestCitationHistory(): GuestCitationHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  const rawValue = window.localStorage.getItem(GUEST_CITATION_HISTORY_KEY);
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isGuestCitationHistoryItem);
  } catch {
    return [];
  }
}

export function saveGuestCitationHistory(items: GuestCitationHistoryItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(GUEST_CITATION_HISTORY_KEY, JSON.stringify(items));
}

export function appendGuestCitationHistory(item: GuestCitationHistoryItem) {
  const currentItems = readGuestCitationHistory();
  const updatedItems = [item, ...currentItems];
  saveGuestCitationHistory(updatedItems);
  return updatedItems;
}

export function clearGuestCitationHistory() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(GUEST_CITATION_HISTORY_KEY);
}
