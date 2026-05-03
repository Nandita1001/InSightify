import mongoose from "mongoose";
import { ROLES } from "./User.js";

export const REQUEST_STATUSES = ["pending", "approved", "denied"];

const accessRequestSchema = new mongoose.Schema(
  {
    fromRole:   { type: String, enum: ROLES, required: true, index: true },
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userName:   { type: String, required: true },
    columns:    { type: [String], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },
    reason:     { type: String, default: "" },
    status:     { type: String, enum: REQUEST_STATUSES, default: "pending", index: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

accessRequestSchema.index({ status: 1, createdAt: -1 });

accessRequestSchema.methods.toJSON = function () {
  const obj = this.toObject();
  return {
    id: obj._id.toString(),
    from_role:   obj.fromRole,
    user_id:     obj.userId?.toString() ?? null,
    user_name:   obj.userName,
    columns:     obj.columns,
    reason:      obj.reason,
    status:      obj.status,
    resolved_at: obj.resolvedAt,
    resolved_by: obj.resolvedBy?.toString() ?? null,
    created_at:  obj.createdAt,
    updated_at:  obj.updatedAt,
  };
};

export const AccessRequest = mongoose.model("AccessRequest", accessRequestSchema);
