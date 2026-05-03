import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  const status = err.status ?? 500;
  const body = {
    error: {
      message: status >= 500 ? "Internal server error" : err.message,
    },
  };
  if (err.details) body.error.details = err.details;
  if (status >= 500) {
    console.error("[error]", err);
    if (env.NODE_ENV !== "production") body.error.message = err.message;
  }
  res.status(status).json(body);
}
