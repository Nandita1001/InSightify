import { authService } from "../services/authService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const signup = asyncHandler(async (req, res) => {
  const result = await authService.signup(req.body);
  res.status(201).json(result);
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.json(result);
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
});

export const logout = asyncHandler(async (_req, res) => {
  // Stateless JWT: client discards the token. Endpoint exists for parity
  // and future refresh-token revocation.
  res.json({ success: true });
});
