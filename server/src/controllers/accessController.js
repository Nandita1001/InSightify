import { accessService } from "../services/accessService.js";
import { ROLES } from "../config/permissions.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const listRoles = asyncHandler(async (_req, res) => {
  res.json({ roles: ROLES });
});

export const myRestrictions = asyncHandler(async (req, res) => {
  const restrictions = await accessService.getRestrictionsFor(req.user);
  res.json({ restrictions });
});

export const listRequests = asyncHandler(async (req, res) => {
  const requests = await accessService.listRequests(req.user);
  res.json({ requests });
});

export const createRequest = asyncHandler(async (req, res) => {
  const created = await accessService.createRequest(req.user, req.body);
  res.status(201).json(created);
});

export const resolveRequest = asyncHandler(async (req, res) => {
  const updated = await accessService.resolveRequest(req.user, req.params.id, req.body.status);
  res.json(updated);
});
