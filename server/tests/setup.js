/**
 * Global test setup — runs ONCE before any test file's imports execute.
 *
 * Top-level awaits here are allowed in ESM and finish before Vitest moves on
 * to evaluating test files. Critical: env vars must be set BEFORE any module
 * that imports `config/env.js` is loaded, because env.js validates at import
 * time and would refuse to boot with an empty MONGO_URI.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeEach } from "vitest";

const mongoServer = await MongoMemoryServer.create();

process.env.MONGO_URI = mongoServer.getUri();
process.env.JWT_ACCESS_SECRET = "test-secret-must-be-at-least-16-chars-long";
process.env.NODE_ENV = "test";
process.env.GROQ_API_KEY = "";                          // tests skip the LLM
process.env.RETRIEVAL_BACKEND = "memory";
process.env.CORS_ORIGIN = "http://localhost:5173";
// PORT left as default (4000); tests use supertest, never bind a real port.

// Now safe to import anything that pulls in env.js / mongoose.
const { connectDB }    = await import("../src/config/db.js");
const mongooseModule   = await import("mongoose");
const mongoose         = mongooseModule.default;

await connectDB();

// Lazy import so env vars are set first.
const { _clearCache: _clearPerms } = await import("../src/services/permissionsService.js");
const { _clearCache: _clearDict }  = await import("../src/services/dictionaryService.js");

beforeEach(async () => {
  // Clear every collection between tests so each test sees a fresh DB.
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  // Drop in-memory service caches too, otherwise mutations from one test
  // leak into the next (DB is wiped but cache remembers).
  _clearPerms();
  _clearDict();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});
