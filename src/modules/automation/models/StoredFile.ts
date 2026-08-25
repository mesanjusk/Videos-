import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * A file produced by a browser run — a screenshot, a download, an upload.
 *
 * Named `StoredFile` rather than Project B's `File`: `File` is a DOM/Node global, and a model of
 * that name reads ambiguously at every call site.
 *
 * Distinct from the existing `Asset` collection on purpose. `Asset` is a *production artifact* —
 * something a scene or project references and the render consumes. This is *run evidence*, which
 * has a different lifetime (subject to cleanup) and is never part of a finished video.
 */
const storedFileSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    mimeType: { type: String, required: true },
    bytes: { type: Number, required: true },
    /** Which storage backend holds it — see core/storage. */
    provider: { type: String, enum: ["cloudinary", "local"], required: true },
    url: { type: String, required: true },
    storageKey: { type: String, required: true },
    kind: { type: String, enum: ["screenshot", "download", "upload", "generated"], default: "generated", index: true },
    taskId: { type: Schema.Types.ObjectId, ref: "AutomationTask", index: true },
    executionStepId: { type: Schema.Types.ObjectId, ref: "ExecutionStep" },
    /** Set by cleanup policies — a screenshot is evidence, not an archive. */
    expiresAt: { type: Date, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type StoredFileDoc = InferSchemaType<typeof storedFileSchema>;
export const StoredFile: Model<StoredFileDoc> =
  (models.StoredFile as Model<StoredFileDoc>) ?? model<StoredFileDoc>("StoredFile", storedFileSchema);
