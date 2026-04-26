import { ObjectId } from "mongodb";

import type { CitationStyle, StartMode } from "@/lib/constants";
import { getMongoDb } from "@/lib/mongodb";
import type {
  ClaimMatch,
  EnhancedQueryItem,
  SavedCitation,
  SavedSource,
  SearchHistoryItem,
  Source,
} from "@/types/domain";

const SEARCH_HISTORY_COLLECTION = "search_history_items";
const ENHANCED_QUERY_COLLECTION = "enhanced_query_items";
const SAVED_SOURCE_COLLECTION = "saved_sources";
const SAVED_CITATION_COLLECTION = "saved_citations";

interface SearchHistoryDocument {
  _id: ObjectId;
  userId: ObjectId;
  query: string;
  startMode: StartMode;
  createdAt: Date;
}

interface EnhancedQueryDocument {
  _id: ObjectId;
  userId: ObjectId;
  originalQuery: string;
  refinedQuestion: string;
  suggestedQueries: string[];
  selectedQuery: string;
  claimText: string;
  claimMatches: ClaimMatch[];
  createdAt: Date;
}

interface SavedSourceDocument {
  _id: ObjectId;
  userId: ObjectId;
  openAlexId: string;
  title: string;
  authors: string[];
  publicationDate: string;
  citationCount: number;
  externalUrl: string;
  summary: string;
  createdAt: Date;
}

interface SavedCitationDocument {
  _id: ObjectId;
  userId: ObjectId;
  sourceId: string;
  sourceTitle: string;
  style: CitationStyle;
  citationText: string;
  createdAt: Date;
}

function toObjectId(id: string) {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  return new ObjectId(id);
}

function mapSearchHistoryDocument(doc: SearchHistoryDocument): SearchHistoryItem {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    query: doc.query,
    startMode: doc.startMode,
    createdAt: doc.createdAt.toISOString(),
  };
}

function mapEnhancedQueryDocument(doc: EnhancedQueryDocument): EnhancedQueryItem {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    originalQuery: doc.originalQuery,
    refinedQuestion: doc.refinedQuestion,
    suggestedQueries: doc.suggestedQueries,
    selectedQuery: doc.selectedQuery,
    claimText: doc.claimText,
    claimMatches: doc.claimMatches,
    createdAt: doc.createdAt.toISOString(),
  };
}

function mapSavedSourceDocument(doc: SavedSourceDocument): SavedSource {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    openAlexId: doc.openAlexId,
    title: doc.title,
    authors: doc.authors,
    publicationDate: doc.publicationDate,
    citationCount: doc.citationCount,
    externalUrl: doc.externalUrl,
    summary: doc.summary,
    createdAt: doc.createdAt.toISOString(),
  };
}

function mapSavedCitationDocument(doc: SavedCitationDocument): SavedCitation {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    sourceId: doc.sourceId,
    sourceTitle: doc.sourceTitle,
    style: doc.style,
    citationText: doc.citationText,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function recordSearchHistory(params: {
  userId: string;
  query: string;
  startMode: StartMode;
}) {
  const userObjectId = toObjectId(params.userId);
  if (!userObjectId) {
    return null;
  }

  const db = await getMongoDb();
  const now = new Date();

  const result = await db.collection<SearchHistoryDocument>(SEARCH_HISTORY_COLLECTION).insertOne({
    _id: new ObjectId(),
    userId: userObjectId,
    query: params.query,
    startMode: params.startMode,
    createdAt: now,
  });

  const inserted = await db
    .collection<SearchHistoryDocument>(SEARCH_HISTORY_COLLECTION)
    .findOne({ _id: result.insertedId });

  return inserted ? mapSearchHistoryDocument(inserted) : null;
}

export async function listSearchHistory(userId: string, limit = 50) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) {
    return [];
  }

  const db = await getMongoDb();
  const docs = await db
    .collection<SearchHistoryDocument>(SEARCH_HISTORY_COLLECTION)
    .find({ userId: userObjectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return docs.map(mapSearchHistoryDocument);
}

export async function deleteSearchHistoryItem(userId: string, itemId: string) {
  const userObjectId = toObjectId(userId);
  const itemObjectId = toObjectId(itemId);

  if (!userObjectId || !itemObjectId) {
    return false;
  }

  const db = await getMongoDb();
  const result = await db.collection<SearchHistoryDocument>(SEARCH_HISTORY_COLLECTION).deleteOne({
    _id: itemObjectId,
    userId: userObjectId,
  });

  return result.deletedCount > 0;
}

export async function clearSearchHistory(userId: string) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) {
    return 0;
  }

  const db = await getMongoDb();
  const result = await db
    .collection<SearchHistoryDocument>(SEARCH_HISTORY_COLLECTION)
    .deleteMany({ userId: userObjectId });

  return result.deletedCount;
}

export async function createEnhancedQueryItem(params: {
  userId: string;
  originalQuery: string;
  refinedQuestion: string;
  suggestedQueries: string[];
  selectedQuery: string;
  claimText: string;
  claimMatches: ClaimMatch[];
}) {
  const userObjectId = toObjectId(params.userId);
  if (!userObjectId) {
    return null;
  }

  const db = await getMongoDb();
  const now = new Date();
  const result = await db
    .collection<EnhancedQueryDocument>(ENHANCED_QUERY_COLLECTION)
    .insertOne({
      _id: new ObjectId(),
      userId: userObjectId,
      originalQuery: params.originalQuery,
      refinedQuestion: params.refinedQuestion,
      suggestedQueries: params.suggestedQueries,
      selectedQuery: params.selectedQuery,
      claimText: params.claimText,
      claimMatches: params.claimMatches,
      createdAt: now,
    });

  const inserted = await db
    .collection<EnhancedQueryDocument>(ENHANCED_QUERY_COLLECTION)
    .findOne({ _id: result.insertedId });

  return inserted ? mapEnhancedQueryDocument(inserted) : null;
}

export async function listEnhancedQueryItems(userId: string, limit = 50) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) {
    return [];
  }

  const db = await getMongoDb();
  const docs = await db
    .collection<EnhancedQueryDocument>(ENHANCED_QUERY_COLLECTION)
    .find({ userId: userObjectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return docs.map(mapEnhancedQueryDocument);
}

export async function deleteEnhancedQueryItem(userId: string, itemId: string) {
  const userObjectId = toObjectId(userId);
  const itemObjectId = toObjectId(itemId);

  if (!userObjectId || !itemObjectId) {
    return false;
  }

  const db = await getMongoDb();
  const result = await db.collection<EnhancedQueryDocument>(ENHANCED_QUERY_COLLECTION).deleteOne({
    _id: itemObjectId,
    userId: userObjectId,
  });

  return result.deletedCount > 0;
}

export async function clearEnhancedQueryItems(userId: string) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) {
    return 0;
  }

  const db = await getMongoDb();
  const result = await db
    .collection<EnhancedQueryDocument>(ENHANCED_QUERY_COLLECTION)
    .deleteMany({ userId: userObjectId });

  return result.deletedCount;
}

export async function saveSource(params: { userId: string; source: Source }) {
  const userObjectId = toObjectId(params.userId);
  if (!userObjectId) {
    return null;
  }

  const db = await getMongoDb();
  const now = new Date();

  const result = await db.collection<SavedSourceDocument>(SAVED_SOURCE_COLLECTION).findOneAndUpdate(
    {
      userId: userObjectId,
      openAlexId: params.source.id,
    },
    {
      $set: {
        title: params.source.title,
        authors: params.source.authors,
        publicationDate: params.source.publicationDate,
        citationCount: params.source.citationCount,
        externalUrl: params.source.externalUrl,
        summary: params.source.summary ?? "",
      },
      $setOnInsert: {
        _id: new ObjectId(),
        userId: userObjectId,
        openAlexId: params.source.id,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" }
  );

  return result ? mapSavedSourceDocument(result) : null;
}

export async function listSavedSources(userId: string, limit = 100) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) {
    return [];
  }

  const db = await getMongoDb();
  const docs = await db
    .collection<SavedSourceDocument>(SAVED_SOURCE_COLLECTION)
    .find({ userId: userObjectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return docs.map(mapSavedSourceDocument);
}

export async function deleteSavedSource(userId: string, itemId: string) {
  const userObjectId = toObjectId(userId);
  const itemObjectId = toObjectId(itemId);

  if (!userObjectId || !itemObjectId) {
    return false;
  }

  const db = await getMongoDb();
  const result = await db.collection<SavedSourceDocument>(SAVED_SOURCE_COLLECTION).deleteOne({
    _id: itemObjectId,
    userId: userObjectId,
  });

  return result.deletedCount > 0;
}

export async function clearSavedSources(userId: string) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) {
    return 0;
  }

  const db = await getMongoDb();
  const result = await db
    .collection<SavedSourceDocument>(SAVED_SOURCE_COLLECTION)
    .deleteMany({ userId: userObjectId });

  return result.deletedCount;
}

export async function saveCitation(params: {
  userId: string;
  sourceId: string;
  sourceTitle: string;
  style: CitationStyle;
  citationText: string;
}) {
  const userObjectId = toObjectId(params.userId);
  if (!userObjectId) {
    return null;
  }

  const db = await getMongoDb();
  const now = new Date();
  const result = await db
    .collection<SavedCitationDocument>(SAVED_CITATION_COLLECTION)
    .insertOne({
      _id: new ObjectId(),
      userId: userObjectId,
      sourceId: params.sourceId,
      sourceTitle: params.sourceTitle,
      style: params.style,
      citationText: params.citationText,
      createdAt: now,
    });

  const inserted = await db
    .collection<SavedCitationDocument>(SAVED_CITATION_COLLECTION)
    .findOne({ _id: result.insertedId });

  return inserted ? mapSavedCitationDocument(inserted) : null;
}

export async function listSavedCitations(userId: string, limit = 100) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) {
    return [];
  }

  const db = await getMongoDb();
  const docs = await db
    .collection<SavedCitationDocument>(SAVED_CITATION_COLLECTION)
    .find({ userId: userObjectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return docs.map(mapSavedCitationDocument);
}

export async function deleteSavedCitation(userId: string, itemId: string) {
  const userObjectId = toObjectId(userId);
  const itemObjectId = toObjectId(itemId);

  if (!userObjectId || !itemObjectId) {
    return false;
  }

  const db = await getMongoDb();
  const result = await db.collection<SavedCitationDocument>(SAVED_CITATION_COLLECTION).deleteOne({
    _id: itemObjectId,
    userId: userObjectId,
  });

  return result.deletedCount > 0;
}

export async function clearSavedCitations(userId: string) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) {
    return 0;
  }

  const db = await getMongoDb();
  const result = await db
    .collection<SavedCitationDocument>(SAVED_CITATION_COLLECTION)
    .deleteMany({ userId: userObjectId });

  return result.deletedCount;
}

export async function deleteAllSavedDataForUser(userId: string) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) {
    return {
      searchHistoryDeleted: 0,
      enhancedQueriesDeleted: 0,
      savedSourcesDeleted: 0,
      savedCitationsDeleted: 0,
    };
  }

  const db = await getMongoDb();

  const [searchHistoryResult, enhancedQueryResult, savedSourceResult, savedCitationResult] =
    await Promise.all([
      db.collection<SearchHistoryDocument>(SEARCH_HISTORY_COLLECTION).deleteMany({ userId: userObjectId }),
      db
        .collection<EnhancedQueryDocument>(ENHANCED_QUERY_COLLECTION)
        .deleteMany({ userId: userObjectId }),
      db.collection<SavedSourceDocument>(SAVED_SOURCE_COLLECTION).deleteMany({ userId: userObjectId }),
      db
        .collection<SavedCitationDocument>(SAVED_CITATION_COLLECTION)
        .deleteMany({ userId: userObjectId }),
    ]);

  return {
    searchHistoryDeleted: searchHistoryResult.deletedCount,
    enhancedQueriesDeleted: enhancedQueryResult.deletedCount,
    savedSourcesDeleted: savedSourceResult.deletedCount,
    savedCitationsDeleted: savedCitationResult.deletedCount,
  };
}
