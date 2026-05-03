import { z } from "zod";

export const createRequestSchema = z.object({
  columns: z.array(z.string().min(1)).min(1, "At least one column required").max(50),
  reason:  z.string().max(500).default(""),
});

export const resolveRequestSchema = z.object({
  status: z.enum(["approved", "denied"]),
});
