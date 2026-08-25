import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * An append-only record of sensitive operations — creating or reading a credential, connecting a
 * browser session, running an automation, resolving a human-intervention request.
 *
 * Neither project had this on the video side; Project B had it and it is one of the things worth
 * carrying over wholesale. `metadata` must never contain a secret value: `writeAuditLog` is the
 * only writer and it redacts through `core/security/encryption.ts#redactSecrets`.
 */
const auditLogSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    actorType: { type: String, enum: ["user", "api_token", "system"], required: true },
    action: { type: String, required: true, index: true },
    resourceType: { type: String },
    resourceId: { type: String },
    metadata: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ userId: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog: Model<AuditLogDoc> =
  (models.AuditLog as Model<AuditLogDoc>) ?? model<AuditLogDoc>("AuditLog", auditLogSchema);
