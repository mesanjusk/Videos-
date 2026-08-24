import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * A Production Director plan, persisted so it can be reviewed before anything expensive runs.
 *
 * The plan being a stored artifact rather than a transient value is the point: "here is what I am
 * about to make, which stages will run, and which providers under which cost policy" is a question
 * the user should get to answer before a single generation is enqueued. `status` tracks that —
 * a plan sits in `draft` until someone approves it.
 *
 * `plan` holds the validated `ProductionPlan` from core/production/types.ts verbatim. It is stored
 * as-is rather than normalised into columns because it is a document the Director produced whole
 * and the pipeline consumes whole; splitting it would only create a mapping to keep in sync.
 */
const productionPlanSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    /** The user's own words, unmodified — what the plan has to be judged against. */
    request: { type: String, required: true },
    pipelineId: { type: String, required: true, index: true },
    plan: { type: Schema.Types.Mixed, required: true },
    /** Stages that will actually run, after the pipeline's list minus the user's skips. */
    stages: [{ type: String }],
    /** Corrections the Director made to the model's plan — shown to the user, never hidden. */
    notes: [{ type: String }],
    costPolicy: { type: String, required: true },
    /** Which provider produced the plan, after gateway routing. */
    plannedByProvider: { type: String },

    status: {
      type: String,
      enum: ["draft", "approved", "running", "completed", "failed", "cancelled"],
      default: "draft",
      index: true,
    },
    /** Set once approved and the pipeline starts — links the plan to what it produced. */
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
    /** Shared by every job in this production, so the whole run is traceable as a unit. */
    correlationId: { type: String, index: true },
    error: { type: String },
    approvedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

productionPlanSchema.index({ userId: 1, createdAt: -1 });

export type ProductionPlanDoc = InferSchemaType<typeof productionPlanSchema>;

export const ProductionPlanModel: Model<ProductionPlanDoc> =
  (models.ProductionPlan as Model<ProductionPlanDoc>) ?? model<ProductionPlanDoc>("ProductionPlan", productionPlanSchema);
