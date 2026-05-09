import mongoose from "mongoose";

export const DATASET_SOURCES = ["company", "user"];
export const DATASET_TYPES   = ["structured", "unstructured"];

/**
 * Dataset — both built-in company datasets (seeded once) and user-uploaded
 * CSV/Excel files. Rows + column profiles are embedded for simplicity:
 * MongoDB's 16MB document limit is plenty for our demo-scale datasets.
 *
 * For larger files we'd switch to GridFS or a separate `rows` collection
 * with chunking — listed as future work.
 */
const datasetSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "" },

    source:  { type: String, enum: DATASET_SOURCES, required: true, index: true },
    type:    { type: String, enum: DATASET_TYPES, default: "structured" },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

    rowCount: { type: Number, default: 0 },
    columns:  { type: [mongoose.Schema.Types.Mixed], default: [] },
    rows:     { type: [mongoose.Schema.Types.Mixed], default: [] },

    fileName: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

datasetSchema.index({ source: 1, ownerId: 1 });

datasetSchema.methods.toListJSON = function () {
  return {
    id:          this._id.toString(),
    name:        this.name,
    description: this.description,
    source:      this.source,
    type:        this.type,
    rowCount:    this.rowCount,
    columns:     this.columns,
    fileName:    this.fileName,
    uploadedAt:  this.createdAt,
  };
};

datasetSchema.methods.toFullJSON = function () {
  return { ...this.toListJSON(), data: this.rows };
};

export const Dataset = mongoose.model("Dataset", datasetSchema);
