import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { SCHEDULE_FREQUENCIES } from "../constants";

/**
 * A recurring trigger for an Automation, swept by the worker's scheduler
 * (core/automation/scheduler.ts) once a minute.
 *
 * Deliberately DB-polled rather than a cron daemon or a hosted scheduler: the platform's whole
 * infrastructure requirement stays MongoDB + Redis, which is what makes local development and a
 * single small worker host viable. Note the sweep runs only in the always-on worker, never in the
 * Vercel serverless tick — that runs on every warm invocation and would fire schedules repeatedly.
 */
const scheduleSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    automationId: { type: Schema.Types.ObjectId, ref: "Automation", required: true, index: true },
    frequency: { type: String, enum: SCHEDULE_FREQUENCIES, required: true },
    cronExpression: { type: String },
    timezone: { type: String, default: "UTC" },
    enabled: { type: Boolean, default: true, index: true },
    nextRunAt: { type: Date, index: true },
    lastRunAt: { type: Date },
    input: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export type ScheduleDoc = InferSchemaType<typeof scheduleSchema>;
export const Schedule: Model<ScheduleDoc> =
  (models.Schedule as Model<ScheduleDoc>) ?? model<ScheduleDoc>("Schedule", scheduleSchema);
