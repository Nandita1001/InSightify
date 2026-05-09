import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as queryController from "../controllers/queryController.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { querySchema } from "../validators/queryValidators.js";

// Per-user query rate limit. Each /api/query call may fan out to the LLM
// twice (parse + narrative), so cap a bit lower than /api/llm.
const queryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { error: { message: "Query rate limit exceeded. Try again in a minute." } },
});

const router = Router();
router.use(requireAuth);

router.post("/", queryLimiter, validate(querySchema), queryController.run);
router.get("/suggestions", queryController.suggestions);
router.get("/dictionary",  queryController.dictionary);
router.get("/registry",    queryController.registry);

export default router;
