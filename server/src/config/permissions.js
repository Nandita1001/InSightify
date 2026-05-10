/**
 * Default Role-Based Access Control matrix — used ONLY as the seed when the
 * RolePermission collection is empty (first boot). At runtime, the
 * authoritative matrix lives in Mongo and is editable via /api/admin/permissions.
 *
 * To change permissions for an existing deployment: use the admin API.
 * To change the bootstrap defaults for a fresh deployment: edit this file.
 */

import { ROLES } from "../models/User.js";

export { ROLES };

export const DEFAULT_ROLE_PERMISSIONS = {
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

/**
 * `isOwner(role)` is the only sync helper that survives — it's a constant
 * predicate not tied to mutable permissions. For everything else, use
 * `permissionsService` (async, Mongo-backed, cached).
 */
export function isOwner(role) {
  return role === "Owner";
}
