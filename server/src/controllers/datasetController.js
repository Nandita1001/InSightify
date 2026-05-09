import { datasetService } from "../services/datasetService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const list = asyncHandler(async (req, res) => {
  const datasets = await datasetService.listFor(req.user);
  res.json({ datasets });
});

export const get = asyncHandler(async (req, res) => {
  const dataset = await datasetService.getFullFor(req.user, req.params.id);
  res.json({ dataset });
});

export const upload = asyncHandler(async (req, res) => {
  const dataset = await datasetService.uploadFor(req.user, req.file, req.body);
  res.status(201).json({ dataset });
});

export const remove = asyncHandler(async (req, res) => {
  await datasetService.removeFor(req.user, req.params.id);
  res.status(204).end();
});
