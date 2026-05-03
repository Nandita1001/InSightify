/**
 * Role-Based Access Control matrix.
 *
 * Source of truth for which dataset columns each role is restricted from.
 * Per-user grants are stored in the AccessRequest collection (status="approved")
 * and combined with this matrix at read time inside accessService.
 */

import { ROLES } from "../models/User.js";

export { ROLES };

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

export function getRoleRestrictions(role) {
  return ROLE_PERMISSIONS[role]?.restricted ?? [];
}

export function canApprove(role) {
  return ROLE_PERMISSIONS[role]?.canApprove ?? false;
}

export function isOwner(role) {
  return role === "Owner";
}
