/**
 * accessControl.js — thin client-side cache + sync helpers.
 *
 * The authoritative RBAC matrix and access requests live on the backend. This
 * module just caches the current user's effective restricted columns so the
 * (still client-side) queryEngine can run synchronous access checks against them.
 *
 * Hydration:
 *   - AppContext fetches restrictions on login + after socket "access_requests:changed"
 *     and calls setMyRestrictions(restrictions).
 *   - On logout, AppContext calls resetRestrictionIndex().
 *
 * Server-side enforcement happens at the access-request routes themselves
 * (only the requester can create, only the Owner can approve/deny). Once the
 * query engine moves server-side (phase 4), RBAC will also gate query execution.
 */

/* ─── Static role list ─── */
/* Mirrors User.js / permissions.js on the server. Kept as a sync constant
   because AppContext seeds initial state from it during the very first render. */
const ROLES = ["Owner", "Finance Team", "Marketing Team", "HR Team"];

/* ─── In-memory cache of the current user's restrictions ─── */
let _restrictions = [];           // [{ col, reason }]
let _restrictedSet = new Set();   // Set<lowercaseCol> — derived

export function setMyRestrictions(restrictions) {
  _restrictions = Array.isArray(restrictions) ? restrictions : [];
  _restrictedSet = new Set(_restrictions.map((r) => r.col.toLowerCase()));
}

export function resetRestrictionIndex() {
  _restrictions = [];
  _restrictedSet = new Set();
}

/* ─── Sync helpers used by queryEngine + UI ─── */

export function getRoles() {
  return ROLES.slice();
}

/**
 * Return the current user's restricted columns.
 * Signature kept (role, userId) for backwards compatibility — values come
 * from the cached server response, not the parameters.
 */
// eslint-disable-next-line no-unused-vars
export function getRestrictions(_role, _userId) {
  return _restrictions.slice();
}

/**
 * Synchronous access check used inside queryEngine.
 * Owner role bypasses all checks (matches server-side isOwner()).
 */
export function checkAccess(role, _userId, requiredColumns) {
  if (role === "Owner") return { allowed: true, blockedColumns: [] };

  const blocked = [];
  for (const col of requiredColumns ?? []) {
    if (_restrictedSet.has(String(col).toLowerCase())) {
      const meta = _restrictions.find((r) => r.col.toLowerCase() === String(col).toLowerCase());
      blocked.push({ col, reason: meta?.reason ?? "Restricted" });
    }
  }
  return { allowed: blocked.length === 0, blockedColumns: blocked };
}
