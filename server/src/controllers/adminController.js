import * as permissionsService from "../services/permissionsService.js";
import * as dictionaryService  from "../services/dictionaryService.js";
import { datasetService } from "../services/datasetService.js";
import { ROLES } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/* ─── Permissions (role × column restrictions) ───────────────────────── */

export const listPermissions = asyncHandler(async (_req, res) => {
  const all = await permissionsService.getAllPermissions();
  // Return as an array for stable ordering in the admin UI.
  const rows = ROLES.map((role) => ({
    role,
    restricted: all[role]?.restricted ?? [],
    canApprove: !!all[role]?.canApprove,
  }));
  res.json({ roles: rows });
});

export const updatePermission = asyncHandler(async (req, res) => {
  const updated = await permissionsService.updateRolePermission(req.params.role, req.body);
  res.json(updated);
});

/* ─── Dictionary (business glossary) ─────────────────────────────────── */

export const listDictionary = asyncHandler(async (_req, res) => {
  const entries = await dictionaryService.listAll();
  res.json({ entries });
});

export const createDictionaryEntry = asyncHandler(async (req, res) => {
  const entry = await dictionaryService.createEntry(req.body);
  res.status(201).json(entry);
});

export const updateDictionaryEntry = asyncHandler(async (req, res) => {
  const entry = await dictionaryService.updateEntry(req.params.id, req.body);
  res.json(entry);
});

export const deleteDictionaryEntry = asyncHandler(async (req, res) => {
  await dictionaryService.deleteEntry(req.params.id);
  res.status(204).end();
});

/* ─── Dataset visibility (source + allowedRoles) ─────────────────────── */

export const updateDatasetVisibility = asyncHandler(async (req, res) => {
  const result = await datasetService.updateVisibility(req.params.id, req.body);
  res.json(result);
});
