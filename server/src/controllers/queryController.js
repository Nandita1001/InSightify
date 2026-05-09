import {
  processQuery,
  getSuggestedQuestions,
  getDataDictionary,
  getRegistryInfo,
} from "../services/queryService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const run = asyncHandler(async (req, res) => {
  const result = await processQuery({ user: req.user, ...req.body });
  res.json(result);
});

export const suggestions = asyncHandler(async (req, res) => {
  const { activeTab = "company", datasetId } = req.query;
  const suggestions = await getSuggestedQuestions(activeTab, datasetId, req.user.role);
  res.json({ suggestions });
});

export const dictionary = asyncHandler(async (req, res) => {
  const { activeTab = "company", datasetId } = req.query;
  const dictionary = await getDataDictionary(activeTab, datasetId);
  res.json({ dictionary });
});

export const registry = asyncHandler(async (req, res) => {
  const info = await getRegistryInfo(req.user);
  res.json(info);
});
