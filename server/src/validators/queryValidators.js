import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().default(""),
});

export const querySchema = z.object({
  question:  z.string().trim().min(1, "Question is required").max(2000),
  activeTab: z.enum(["company", "upload"]).default("company"),
  datasetId: z.string().optional().nullable(),
  context:   z.array(messageSchema).max(20).default([]),
});

export const uploadDatasetSchema = z.object({
  type: z.enum(["structured", "unstructured"]).default("structured"),
});
