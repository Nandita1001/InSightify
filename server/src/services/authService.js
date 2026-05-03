import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { signAccessToken } from "../utils/jwt.js";

async function signup({ name, email, password, role }) {
  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict("An account with that email already exists");

  const passwordHash = await User.hashPassword(password);
  const user = await User.create({ name, email, role, passwordHash });
  const token = signAccessToken({ sub: user._id.toString(), role: user.role });
  return { user: user.toSafeJSON(), token };
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user) throw ApiError.unauthorized("Invalid email or password");

  const ok = await user.verifyPassword(password);
  if (!ok) throw ApiError.unauthorized("Invalid email or password");

  const token = signAccessToken({ sub: user._id.toString(), role: user.role });
  return { user: user.toSafeJSON(), token };
}

export const authService = { signup, login };
