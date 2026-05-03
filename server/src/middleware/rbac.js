import { ApiError } from "../utils/ApiError.js";
import { isOwner } from "../config/permissions.js";

/**
 * Block the request unless the authenticated user has the Owner role.
 * Must be mounted AFTER requireAuth so req.user exists.
 */
export function requireOwner(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized());
  if (!isOwner(req.user.role)) return next(ApiError.forbidden("Owner role required"));
  next();
}
