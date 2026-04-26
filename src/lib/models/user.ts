import { randomBytes, createHash } from "node:crypto";

import { ObjectId } from "mongodb";

import { getMongoDb } from "@/lib/mongodb";

const USER_COLLECTION = "users";
const VERIFICATION_COLLECTION = "email_verification_tokens";
const VERIFICATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

export interface UserDocument {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface VerificationTokenDocument {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function findUserByEmail(email: string) {
  const db = await getMongoDb();
  return db
    .collection<UserDocument>(USER_COLLECTION)
    .findOne({ email: normalizeEmail(email) });
}

export async function findUserById(id: string) {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const db = await getMongoDb();
  return db.collection<UserDocument>(USER_COLLECTION).findOne({ _id: new ObjectId(id) });
}

export async function createUser(email: string, passwordHash: string) {
  const db = await getMongoDb();
  const now = new Date();
  const normalizedEmail = normalizeEmail(email);

  const result = await db.collection<UserDocument>(USER_COLLECTION).insertOne({
    _id: new ObjectId(),
    email: normalizedEmail,
    passwordHash,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });

  return db.collection<UserDocument>(USER_COLLECTION).findOne({ _id: result.insertedId });
}

export async function createEmailVerificationToken(userId: ObjectId) {
  const db = await getMongoDb();

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashVerificationToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS);

  await db
    .collection<VerificationTokenDocument>(VERIFICATION_COLLECTION)
    .deleteMany({ userId });

  await db.collection<VerificationTokenDocument>(VERIFICATION_COLLECTION).insertOne({
    _id: new ObjectId(),
    userId,
    tokenHash,
    createdAt: now,
    expiresAt,
  });

  return {
    token: rawToken,
    expiresAt,
  };
}

export async function verifyEmailWithToken(rawToken: string) {
  const db = await getMongoDb();
  const tokenHash = hashVerificationToken(rawToken);
  const now = new Date();

  const tokenDoc = await db
    .collection<VerificationTokenDocument>(VERIFICATION_COLLECTION)
    .findOne({ tokenHash, expiresAt: { $gt: now } });

  if (!tokenDoc) {
    return null;
  }

  await db.collection<UserDocument>(USER_COLLECTION).updateOne(
    { _id: tokenDoc.userId },
    {
      $set: {
        emailVerified: true,
        updatedAt: now,
      },
    }
  );

  await db
    .collection<VerificationTokenDocument>(VERIFICATION_COLLECTION)
    .deleteMany({ userId: tokenDoc.userId });

  return db.collection<UserDocument>(USER_COLLECTION).findOne({ _id: tokenDoc.userId });
}

export async function deleteUserById(id: string) {
  if (!ObjectId.isValid(id)) {
    return false;
  }

  const db = await getMongoDb();
  const result = await db.collection<UserDocument>(USER_COLLECTION).deleteOne({
    _id: new ObjectId(id),
  });

  return result.deletedCount > 0;
}

export async function deleteVerificationTokensForUser(userId: string) {
  if (!ObjectId.isValid(userId)) {
    return 0;
  }

  const db = await getMongoDb();
  const result = await db
    .collection<VerificationTokenDocument>(VERIFICATION_COLLECTION)
    .deleteMany({ userId: new ObjectId(userId) });

  return result.deletedCount;
}
