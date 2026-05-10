import mongoose from "mongoose";

/**
 * DictionaryEntry — runtime-editable business glossary.
 *
 * Replaces the old hardcoded DATA_DICTIONARY constant. One document per
 * term. `scope: "global"` entries apply to all datasets; entries scoped to
 * a specific datasetId apply only to that dataset's queries.
 *
 * Used as grounding context for the LLM and surfaced in the UI's
 * data-dictionary dropdown.
 */
const dictionaryEntrySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    def:  { type: String, required: true, maxlength: 1000 },
    // "global" = applies everywhere; otherwise the string id of a specific Dataset.
    scope: { type: String, default: "global", index: true },
  },
  { timestamps: true }
);

dictionaryEntrySchema.index({ scope: 1, name: 1 }, { unique: true });

dictionaryEntrySchema.methods.toJSON = function () {
  return {
    id:        this._id.toString(),
    name:      this.name,
    def:       this.def,
    scope:     this.scope,
    updatedAt: this.updatedAt,
  };
};

export const DictionaryEntry = mongoose.model("DictionaryEntry", dictionaryEntrySchema);
