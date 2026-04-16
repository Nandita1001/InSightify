/**
 * accessControl.js — Role-Based Column-Level Access Control (per-user approvals)
 *
 * Base restrictions come from ROLE_PERMISSIONS (role-level).
 * Approvals are per-user: approving one HR Team member does NOT unlock columns
 * for other HR Team members — each person needs their own approval.
 *
 *  Sales Performance:   month, region, product, channel, revenue, units, cost, returns, ad_spend
 *  Customer Behavior:   week, signups, churn, active_users, avg_handle_time, nps, tickets, resolution_rate, channel
 *  Financial Reports:   department, category, Q1, Q2, Q3, Q4, headcount
 *  Customer Feedback:   date, region, text
 */

import { supabase } from "../lib/supabase.js";

/* ═══════════════════════════════════════════════════════════
   §1  BASE ROLE PERMISSION DEFINITIONS  (never mutated)
═══════════════════════════════════════════════════════════ */

const ROLE_PERMISSIONS = {
  Owner: { restricted: [], canApprove: true },

  "Finance Team": {
    restricted: [
      { col: "text",            reason: "Raw customer feedback — PII / GDPR restricted" },
      { col: "nps",             reason: "Customer experience metric — owned by Customer Success" },
      { col: "avg_handle_time", reason: "Support operations metric — not financial data" },
      { col: "tickets",         reason: "Support operations metric — not financial data" },
      { col: "resolution_rate", reason: "Support operations metric — not financial data" },
    ],
    canApprove: false,
  },

  "Marketing Team": {
    restricted: [
      { col: "cost",            reason: "Internal cost data — Finance confidential" },
      { col: "ad_spend",        reason: "Budget allocation — Finance confidential" },
      { col: "Q1",              reason: "Quarterly budget breakdown — Finance confidential" },
      { col: "Q2",              reason: "Quarterly budget breakdown — Finance confidential" },
      { col: "Q3",              reason: "Quarterly budget breakdown — Finance confidential" },
      { col: "Q4",              reason: "Quarterly budget breakdown — Finance confidential" },
      { col: "headcount",       reason: "Headcount data — HR confidential" },
      { col: "avg_handle_time", reason: "Support operations metric — not marketing data" },
      { col: "resolution_rate", reason: "Support operations metric — not marketing data" },
    ],
    canApprove: false,
  },

  "HR Team": {
    restricted: [
      { col: "revenue",  reason: "Financial data — Finance Team only" },
      { col: "cost",     reason: "Financial data — Finance Team only" },
      { col: "ad_spend", reason: "Marketing budget — Finance/Marketing only" },
      { col: "Q1",       reason: "Quarterly financials — Finance Team only" },
      { col: "Q2",       reason: "Quarterly financials — Finance Team only" },
      { col: "Q3",       reason: "Quarterly financials — Finance Team only" },
      { col: "Q4",       reason: "Quarterly financials — Finance Team only" },
      { col: "nps",      reason: "Customer experience KPI — Customer Success only" },
      { col: "text",     reason: "Raw customer feedback — PII / GDPR restricted" },
      { col: "returns",  reason: "Sales returns detail — Sales/Finance only" },
    ],
    canApprove: false,
  },
};

/* ─── Build a fresh role-level restriction index ─── */
function _buildIndex() {
  const idx = {};
  for (const [role, config] of Object.entries(ROLE_PERMISSIONS)) {
    idx[role] = new Map(
      config.restricted.map(({ col, reason }) => [col.toLowerCase(), reason])
    );
  }
  return idx;
}

/* Role-level restriction index — role → Map<lowercaseCol, reason> */
const _restrictionIndex = _buildIndex();

/* Per-user approved columns — userId → Set<lowercaseCol> */
const _userApprovals = new Map();

/* ═══════════════════════════════════════════════════════════
   §2  INDEX HELPERS  (called by AppContext after DB fetch)
═══════════════════════════════════════════════════════════ */

/**
 * Populate _userApprovals from a list of fetched requests.
 * Only approved requests with a user_id are applied.
 * Role-level _restrictionIndex is NOT touched — restrictions stay role-wide;
 * per-user grants live in _userApprovals.
 */
export function applyApprovedRequests(requests) {
  for (const req of requests) {
    if (req.status !== "approved" || !req.user_id) continue;
    if (!_userApprovals.has(req.user_id)) {
      _userApprovals.set(req.user_id, new Set());
    }
    for (const col of (req.columns ?? [])) {
      _userApprovals.get(req.user_id).add(col.toLowerCase());
    }
  }
}

/**
 * Reset both the role-level restriction index and per-user approvals.
 * Called before re-applying approved requests (keeps state consistent with DB).
 * Also called on logout.
 */
export function resetRestrictionIndex() {
  const fresh = _buildIndex();
  for (const role of Object.keys(_restrictionIndex)) {
    _restrictionIndex[role] = fresh[role];
  }
  for (const [role, map] of Object.entries(fresh)) {
    if (!_restrictionIndex[role]) _restrictionIndex[role] = map;
  }
  _userApprovals.clear();
}

/* ═══════════════════════════════════════════════════════════
   §3  SYNC ACCESS CONTROL  (reads in-memory state — no I/O)
═══════════════════════════════════════════════════════════ */

/**
 * Check whether a user (identified by role + userId) can access all required columns.
 * Columns the user has been individually approved for are not blocked.
 */
export function checkAccess(role, userId, requiredColumns) {
  if (role === "Owner" || !ROLE_PERMISSIONS[role]) {
    return { allowed: true, blockedColumns: [] };
  }

  const index = _restrictionIndex[role];
  const granted = _userApprovals.get(userId) ?? new Set();
  const blocked = [];

  for (const col of (requiredColumns ?? [])) {
    const reason = index.get(col.toLowerCase());
    if (reason !== undefined && !granted.has(col.toLowerCase())) {
      blocked.push({ col, reason });
    }
  }

  return { allowed: blocked.length === 0, blockedColumns: blocked };
}

/**
 * Return the current restricted columns for a user.
 * Columns the user has been approved for are excluded.
 */
export function getRestrictions(role, userId) {
  if (role === "Owner" || !_restrictionIndex[role]) return [];
  const granted = _userApprovals.get(userId) ?? new Set();
  return Array.from(_restrictionIndex[role].entries())
    .filter(([col]) => !granted.has(col))
    .map(([col, reason]) => ({
      col: ROLE_PERMISSIONS[role]?.restricted.find(
        (r) => r.col.toLowerCase() === col
      )?.col ?? col,
      reason,
    }));
}

export function getRoles() {
  return Object.keys(ROLE_PERMISSIONS);
}

export function canApprove(role) {
  return ROLE_PERMISSIONS[role]?.canApprove ?? false;
}

export function getAllPermissions() {
  return JSON.parse(JSON.stringify(ROLE_PERMISSIONS));
}

export function partitionColumns(role, userId, datasetColumns) {
  if (role === "Owner" || !ROLE_PERMISSIONS[role]) {
    return { allowed: datasetColumns, blocked: [] };
  }
  const index = _restrictionIndex[role];
  const granted = _userApprovals.get(userId) ?? new Set();
  const allowed = [], blocked = [];
  for (const col of datasetColumns) {
    const reason = index.get(col.toLowerCase());
    if (reason !== undefined && !granted.has(col.toLowerCase())) {
      blocked.push({ col, reason });
    } else {
      allowed.push(col);
    }
  }
  return { allowed, blocked };
}

/* ═══════════════════════════════════════════════════════════
   §4  ASYNC ACCESS REQUEST WORKFLOW  (Supabase-backed)
═══════════════════════════════════════════════════════════ */

/** Fetch all access requests, newest first. */
export async function getAccessRequests() {
  const { data, error } = await supabase
    .from("access_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Create an access request for a specific user.
 * Deduplicates: returns the existing pending request if same user + columns already pending.
 */
export async function createAccessRequest(fromRole, userId, userName, columns, reason = "") {
  const cols = [].concat(columns);
  const normalizedCols = cols.map((c) => c.toLowerCase()).sort();

  // Check for a duplicate pending request from this exact user + columns
  const { data: existing } = await supabase
    .from("access_requests")
    .select("*")
    .eq("from_role", fromRole)
    .eq("user_id", userId)
    .eq("status", "pending");

  if (existing) {
    const dup = existing.find((req) => {
      const reqCols = (req.columns ?? []).map((c) => c.toLowerCase()).sort();
      return (
        reqCols.length === normalizedCols.length &&
        reqCols.every((c, i) => c === normalizedCols[i])
      );
    });
    if (dup) return { ...dup };
  }

  const { data, error } = await supabase
    .from("access_requests")
    .insert({
      from_role: fromRole,
      user_id: userId,
      user_name: userName,
      columns: cols,
      reason,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Approve an access request. Restriction index is updated by AppContext via fetchAccessRequests(). */
export async function approveRequest(requestId) {
  const { data, error } = await supabase
    .from("access_requests")
    .update({ status: "approved", resolved_at: new Date().toISOString() })
    .eq("id", requestId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Deny an access request. */
export async function denyRequest(requestId) {
  const { data, error } = await supabase
    .from("access_requests")
    .update({ status: "denied", resolved_at: new Date().toISOString() })
    .eq("id", requestId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
