import { z } from "zod";

const columnSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
});

const datasetSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  columns: z.array(columnSchema).default([]),
});

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().default(""),
});

export const parseSchema = z.object({
  question: z.string().min(1).max(2000),
  registry: z.array(datasetSchema).max(20).default([]),
  context: z.array(messageSchema).max(20).default([]),
});

export const narrativeSchema = z.object({
  question: z.string().min(1).max(2000),
  // result shape is highly variable (array of rows, sentiment object, combined map…).
  // Accept any JSON value but cap recursion at the body size limit (1mb).
  result: z.unknown(),
  metadata: z.record(z.unknown()).optional(),
});
