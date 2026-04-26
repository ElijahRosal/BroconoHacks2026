import { MongoClient } from "mongodb";

import { getServerEnv } from "@/lib/env";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function createClientPromise() {
  const { MONGODB_URI } = getServerEnv();
  const client = new MongoClient(MONGODB_URI);
  return client.connect();
}

export function getMongoClient() {
  if (!globalThis._mongoClientPromise) {
    globalThis._mongoClientPromise = createClientPromise();
  }

  return globalThis._mongoClientPromise;
}

export async function getMongoDb() {
  const client = await getMongoClient();
  return client.db();
}
