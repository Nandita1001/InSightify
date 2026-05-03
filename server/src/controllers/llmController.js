import { llmService } from "../services/llmService.js";
import { isGroqConfigured } from "../services/groqService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const status = asyncHandler(async (_req, res) => {
  res.json({ available: isGroqConfigured() });
});

export const parse = asyncHandler(async (req, res) => {
  const result = await llmService.parse(req.body);
  res.json(result);
});

export const narrative = asyncHandler(async (req, res) => {
  const result = await llmService.narrative(req.body);
  res.json(result);
});
