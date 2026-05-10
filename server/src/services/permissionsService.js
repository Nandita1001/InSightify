/**
 * permissionsService — runtime-editable RBAC matrix backed by Mongo.
 *
 * Replaces the old hardcoded ROLE_PERMISSIONS constant. Pattern:
 *   1. First read of any role checks if the collection is empty → seeds it
 *      from the legacy DEFAULT_PERMISSIONS constant
 *   2. Reads are served from an in-memory cache
 *   3. Admin writes call refresh() to bust the cache
 *
 * Multi-instance deployments would need a Redis pub/sub for cache
 * invalidation across nodes — documented in README scaling notes.
 */

import { RolePermission } from "../models/RolePermission.js";
import { ROLES } from "../models/User.js";
import { isOwner as _IS_OWNER, DEFAULT_ROLE_PERMISSIONS } from "../config/permissions.js";

/* ─── Cache ───────────────────────────────────────────────────────────── */

let _cache = null;

async function ensureCache() {
  if (_cache) return _cache;
  await seedIfEmpty();
  await refresh();
  return _cache;
}

async function refresh() {
  const docs = await RolePermission.find();
  _cache = Object.fromEntries(
    docs.map((d) => [d.role, { restricted: d.restricted, canApprove: d.canApprove }])
  );
}

/* ─── Lazy seed from defaults ─────────────────────────────────────────── */

async function seedIfEmpty() {
  const count = await RolePermission.estimatedDocumentCount();
  if (count > 0) return;

  const docs = ROLES.map((role) => {
    const def = DEFAULT_ROLE_PERMISSIONS[role] ?? { restricted: [], canApprove: false };
    return { role, restricted: def.restricted ?? [], canApprove: !!def.canApprove };
  });
  try {
    await RolePermission.insertMany(docs, { ordered: false });
    console.log(`[permissions] seeded ${docs.length} roles from defaults`);
  } catch (err) {
    // Race-condition tolerance: another process beat us to it.
    if (err.code !== 11000) throw err;
  }
}

/* ─── Public read API ─────────────────────────────────────────────────── */

export async function getAllPermissions() {
  return ensureCache();
}

export async function getRoleRestrictions(role) {
  const cache = await ensureCache();
  return cache[role]?.restricted ?? [];
}

export async function canApprove(role) {
  const cache = await ensureCache();
  return !!cache[role]?.canApprove;
}

/** Identical to the old isOwner — keeps "Owner" as the privileged role name. */
export const isOwner = _IS_OWNER;

/* ─── Admin write API ─────────────────────────────────────────────────── */

export async function updateRolePermission(role, { restricted, canApprove: ca }) {
  if (!ROLES.includes(role)) {
    const err = new Error(`Unknown role: ${role}`);
    err.status = 400;
    throw err;
  }

  // Sanitize: drop empties, dedupe by lowercase column name.
  const seen = new Set();
  const clean = (restricted ?? [])
    .filter((r) => r && r.col && typeof r.col === "string")
    .filter((r) => {
      const k = r.col.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({ col: r.col, reason: String(r.reason ?? "") }));

  const updated = await RolePermission.findOneAndUpdate(
    { role },
    { restricted: clean, canApprove: !!ca },
    { new: true, upsert: true }
  );

  await refresh();
  return updated.toJSON();
}

/* ─── Test helper — drop the cache (used between tests) ───────────────── */

export function _clearCache() {
  _cache = null;
}
