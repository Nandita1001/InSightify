import { ApiError } from "../utils/ApiError.js";

export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return next(ApiError.badRequest("Validation failed", result.error.flatten().fieldErrors));
  }
  req.body = result.data;
  next();
};
