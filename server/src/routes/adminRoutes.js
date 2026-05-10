import { Router } from "express";
import * as adminController from "../controllers/adminController.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOwner } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import {
  updatePermissionSchema,
  createDictionaryEntrySchema,
  updateDictionaryEntrySchema,
  updateVisibilitySchema,
} from "../validators/adminValidators.js";

const router = Router();

// Every admin route requires both an auth check AND owner-only RBAC.
router.use(requireAuth, requireOwner);

/* Permissions */
router.get(   "/permissions",        adminController.listPermissions);
router.put(   "/permissions/:role",  validate(updatePermissionSchema), adminController.updatePermission);

/* Dictionary */
router.get(   "/dictionary",         adminController.listDictionary);
router.post(  "/dictionary",         validate(createDictionaryEntrySchema), adminController.createDictionaryEntry);
router.put(   "/dictionary/:id",     validate(updateDictionaryEntrySchema), adminController.updateDictionaryEntry);
router.delete("/dictionary/:id",     adminController.deleteDictionaryEntry);

/* Dataset visibility */
router.patch( "/datasets/:id/visibility", validate(updateVisibilitySchema), adminController.updateDatasetVisibility);

export default router;
