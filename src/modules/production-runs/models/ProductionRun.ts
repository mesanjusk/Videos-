import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * One record per "click Generate" — production history, not a second state machine. The live
 * in-progress stage for a run is derived at read time from the same Project/Scene/Job data every
 * other dashboard already reads (core/production-engine/compute-stage.ts, the same
 * derive-don't-duplicate precedent as lib/workflow-steps.ts#computeStepStatuses). `stage` here is
 * only ever written at genuine milestones (created, completed) — see
 * modules/production-runs/service.ts.
 *
 * `profileVersion`/`promptTemplateVersionsUsed`/`characterVersionsUsed`/`providerUsed` are
 * snapshots taken at generation time, not live references — history has to stay accurate even
 * after a profile or character is edited later.
 */
export const PRODUCTION_RUN_STAGES = [
  "planning",
  "ready",
  "generating",
  "rendering",
  "downloading",
  "quality_check",
  "retry",
  "completed",
  "failed",
] as const;
export type ProductionRunStage = (typeof PRODUCTION_RUN_STAGES)[number];

const productionRunSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    profileId: { type: Schema.Types.ObjectId, ref: "ProductionProfile", required: true },
    profileVersion: { type: Number, required: true },
    topic: { type: String, required: true },
    notes: { type: String },

    startedAt: { type: Date, required: true, default: Date.now },
    completedAt: { type: Date },
    executionTimeSeconds: { type: Number },

    retryCount: { type: Number, default: 0 },
    failedSceneIds: [{ type: Schema.Types.ObjectId, ref: "Scene" }],
    generatedAssetIds: [{ type: Schema.Types.ObjectId, ref: "Asset" }],

    promptTemplateVersionsUsed: { type: Schema.Types.Mixed }, // { [scope]: templateId }
    characterVersionsUsed: { type: Schema.Types.Mixed }, // { [characterId]: version }
    providerUsed: { type: Schema.Types.Mixed }, // { [capability]: providerId }

    stage: { type: String, enum: PRODUCTION_RUN_STAGES, default: "planning" },
  },
  { timestamps: true },
);

productionRunSchema.index({ userId: 1, createdAt: -1 });

export type ProductionRunDoc = InferSchemaType<typeof productionRunSchema>;

export const ProductionRun: Model<ProductionRunDoc> =
  (models.ProductionRun as Model<ProductionRunDoc>) ?? model<ProductionRunDoc>("ProductionRun", productionRunSchema);
