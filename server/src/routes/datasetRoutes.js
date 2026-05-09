import { Router } from "express";
import multer from "multer";
import * as datasetController from "../controllers/datasetController.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { uploadDatasetSchema } from "../validators/queryValidators.js";

// Memory storage: buffer is read once by Papa Parse, then dropped.
// 10MB cap is plenty for the demo and well under the body parser limit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(csv|tsv|txt|xlsx?)$/i.test(file.originalname ?? "");
    cb(ok ? null : new Error("Unsupported file type — upload CSV/TSV/Excel"), ok);
  },
});

const router = Router();
router.use(requireAuth);

router.get("/",  datasetController.list);
router.get("/:id", datasetController.get);
router.post("/", upload.single("file"), validate(uploadDatasetSchema), datasetController.upload);
router.delete("/:id", datasetController.remove);

export default router;
