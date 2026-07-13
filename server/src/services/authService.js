import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { signAccessToken } from "../utils/jwt.js";

function isMongoPermissionError(err) {
  return err?.code === 8000 || err?.codeName === "AtlasError" || err?.message?.includes("not allowed to do action");
}

function isTransientMongoError(err) {
  return (
    err?.code === 10107 ||
    err?.codeName === "NotWritablePrimary" ||
    err?.message?.includes("not primary") ||
    err?.message?.includes("topology was destroyed") ||
    err?.message?.includes("server selection timed out") ||
    err?.message?.includes("connection closed")
  );
}

async function withMongoRetry(operation, retries = 6) {
  // 6 attempts with linear backoff = up to ~21s of patience, which covers
  // Atlas M0 cold-start elections after a cluster resume (usually 30-60s
  // to elect a primary, but the first attempts happen while it's already
  // partway through).
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      if (!isTransientMongoError(err) || attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastErr;
}

async function signup({ name, email, password, role }) {
  try {
    return await withMongoRetry(async () => {
      const existing = await User.findOne({ email });
      if (existing) throw ApiError.conflict("An account with that email already exists");

      const passwordHash = await User.hashPassword(password);
      const user = await User.create({ name, email, role, passwordHash });
      const token = signAccessToken({ sub: user._id.toString(), role: user.role });
      return { user: user.toSafeJSON(), token };
    });
  } catch (err) {
    if (isMongoPermissionError(err)) {
      throw ApiError.unauthorized("Database permission error while creating account. Please verify Atlas user privileges for the users collection.");
    }
    throw err;
  }
}

async function login({ email, password }) {
  try {
    return await withMongoRetry(async () => {
      const user = await User.findOne({ email }).select("+passwordHash");
      if (!user) throw ApiError.unauthorized("Invalid email or password");

      const ok = await user.verifyPassword(password);
      if (!ok) throw ApiError.unauthorized("Invalid email or password");

      const token = signAccessToken({ sub: user._id.toString(), role: user.role });
      return { user: user.toSafeJSON(), token };
    });
  } catch (err) {
    if (isMongoPermissionError(err)) {
      throw ApiError.unauthorized("Database permission error while signing in. Please verify Atlas user privileges for the users collection.");
    }
    throw err;
  }
}

export const authService = { signup, login };
