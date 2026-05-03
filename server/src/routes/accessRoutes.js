import { Router } from "express";
import * as accessController from "../controllers/accessController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOwner } from "../middleware/rbac.js";
import { createRequestSchema, resolveRequestSchema } from "../validators/accessValidators.js";

const router = Router();

router.use(requireAuth);

router.get("/roles", accessController.listRoles);
router.get("/me/restrictions", accessController.myRestrictions);

router.get("/requests", accessController.listRequests);
router.post("/requests", validate(createRequestSchema), accessController.createRequest);

// Owner-only: approve/deny.
router.patch("/requests/:id", requireOwner, validate(resolveRequestSchema), accessController.resolveRequest);

export default router;
