import mongoose from "mongoose";
import { ROLES } from "./User.js";

/**
 * RolePermission — runtime-editable RBAC matrix.
 *
 * Replaces the old hardcoded ROLE_PERMISSIONS constant. One document per
 * role. The Owner row exists but is bypassed in code (Owner sees all); we
 * still store it so the admin UI can show "Owner: no restrictions".
 *
 * Edits via /api/admin/permissions take effect on the next request because
 * permissionsService caches in memory and busts the cache on writes.
 */
const restrictionSchema = new mongoose.Schema(
  {
    col:    { type: String, required: true },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const rolePermissionSchema = new mongoose.Schema(
  {
    role:       { type: String, enum: ROLES, required: true, unique: true, index: true },
    restricted: { type: [restrictionSchema], default: [] },
    canApprove: { type: Boolean, default: false },
  },
  { timestamps: true }
);

rolePermissionSchema.methods.toJSON = function () {
  return {
    role:       this.role,
    restricted: this.restricted,
    canApprove: this.canApprove,
    updatedAt:  this.updatedAt,
  };
};

export const RolePermission = mongoose.model("RolePermission", rolePermissionSchema);
