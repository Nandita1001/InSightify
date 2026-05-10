/**
 * accessService — business rules for access requests + RBAC.
 *
 * Owners see/manage all requests. Non-owners can only create their own.
 * Approving a request grants the requesting user access to the listed columns.
 * Effective restrictions = role baseline minus the user's approved columns.
 */

import { AccessRequest } from "../models/AccessRequest.js";
import { isOwner } from "../config/permissions.js";
import { getRoleRestrictions } from "./permissionsService.js";
import { ApiError } from "../utils/ApiError.js";
import { broadcast } from "./realtime.js";

const CHANGE_EVENT = "access_requests:changed";

/* ─── Reads ─────────────────────────────────────────────────── */

async function listRequests(currentUser) {
  const filter = isOwner(currentUser.role) ? {} : { userId: currentUser._id };
  const docs = await AccessRequest.find(filter).sort({ createdAt: -1 }).limit(200);
  return docs.map((d) => d.toJSON());
}

/**
 * Compute the user's currently restricted columns: role baseline minus any
 * columns granted via approved requests for this user.
 */
async function getRestrictionsFor(currentUser) {
  const baseline = await getRoleRestrictions(currentUser.role);
  if (baseline.length === 0) return [];

  const approved = await AccessRequest.find({
    userId: currentUser._id,
    status: "approved",
  }).select("columns");

  const grantedSet = new Set();
  for (const req of approved) {
    for (const col of req.columns) grantedSet.add(col.toLowerCase());
  }

  return baseline.filter(({ col }) => !grantedSet.has(col.toLowerCase()));
}

/* ─── Mutations ─────────────────────────────────────────────── */

async function createRequest(currentUser, { columns, reason }) {
  const cols = (columns ?? []).map(String);
  if (cols.length === 0) throw ApiError.badRequest("columns must not be empty");

  // Dedupe: if this user already has a pending request for the SAME column set, return it.
  const normalized = [...cols].map((c) => c.toLowerCase()).sort();
  const existing = await AccessRequest.find({
    userId: currentUser._id,
    status: "pending",
  });

  const dup = existing.find((r) => {
    const a = (r.columns ?? []).map((c) => c.toLowerCase()).sort();
    return a.length === normalized.length && a.every((c, i) => c === normalized[i]);
  });
  if (dup) return dup.toJSON();

  const doc = await AccessRequest.create({
    fromRole: currentUser.role,
    userId:   currentUser._id,
    userName: currentUser.name,
    columns:  cols,
    reason:   reason ?? "",
    status:   "pending",
  });

  broadcast(CHANGE_EVENT, { id: doc._id.toString(), type: "created" });
  return doc.toJSON();
}

async function resolveRequest(currentUser, id, status) {
  if (!["approved", "denied"].includes(status)) {
    throw ApiError.badRequest("status must be 'approved' or 'denied'");
  }
  if (!isOwner(currentUser.role)) throw ApiError.forbidden("Owner role required");

  const doc = await AccessRequest.findById(id);
  if (!doc) throw ApiError.notFound("Access request not found");
  if (doc.status !== "pending") {
    throw ApiError.conflict(`Request is already ${doc.status}`);
  }

  doc.status = status;
  doc.resolvedAt = new Date();
  doc.resolvedBy = currentUser._id;
  await doc.save();

  broadcast(CHANGE_EVENT, { id: doc._id.toString(), type: "resolved", status });
  return doc.toJSON();
}

export const accessService = {
  listRequests,
  getRestrictionsFor,
  createRequest,
  resolveRequest,
};
