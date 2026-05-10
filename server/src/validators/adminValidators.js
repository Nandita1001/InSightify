import { z } from "zod";
import { ROLES } from "../models/User.js";

const restrictionSchema = z.object({
  col:    z.string().trim().min(1).max(100),
  reason: z.string().trim().max(500).default(""),
});

export const updatePermissionSchema = z.object({
  restricted: z.array(restrictionSchema).max(50).default([]),
  canApprove: z.boolean().default(false),
});

export const createDictionaryEntrySchema = z.object({
  name:  z.string().trim().min(1).max(100),
  def:   z.string().trim().min(1).max(1000),
  scope: z.string().trim().max(64).default("global"),
});

export const updateDictionaryEntrySchema = createDictionaryEntrySchema.partial();

export const updateVisibilitySchema = z.object({
  source:       z.enum(["company", "user"]).optional(),
  allowedRoles: z.array(z.enum(ROLES)).max(ROLES.length).optional(),
}).refine(
  (v) => v.source !== undefined || v.allowedRoles !== undefined,
  { message: "Body must include source and/or allowedRoles" }
);
