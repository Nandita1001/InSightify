import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 chars"),
  JWT_ACCESS_TTL: z.string().default("7d"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Groq LLM (optional — endpoints return 503 when missing; client falls back to local templates).
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.1-8b-instant"),
  GROQ_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),

  // RAG retrieval backend.
  //   "memory" → in-process cosine similarity (no Atlas setup required)
  //   "atlas"  → MongoDB Atlas Vector Search via $vectorSearch aggregation;
  //              requires a vector search index named ATLAS_VECTOR_INDEX
  //              on the documentchunks collection
  RETRIEVAL_BACKEND:    z.enum(["memory", "atlas"]).default("memory"),
  ATLAS_VECTOR_INDEX:   z.string().default("vector_index"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
