import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as llmController from "../controllers/llmController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { parseSchema, narrativeSchema } from "../validators/llmValidators.js";

// Per-user LLM rate limit: keyed by user id (set by requireAuth) to prevent
// one account from burning the whole Groq budget.
const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { error: { message: "LLM rate limit exceeded. Try again in a minute." } },
});

const router = Router();

router.use(requireAuth);

router.get("/status", llmController.status);
router.post("/parse", llmLimiter, validate(parseSchema), llmController.parse);
router.post("/narrative", llmLimiter, validate(narrativeSchema), llmController.narrative);

export default router;
