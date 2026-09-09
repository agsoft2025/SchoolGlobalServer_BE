import mongoose from "mongoose";

export const SMS_TEMPLATE_AUDIT_ACTIONS = ["CREATE", "UPDATE", "DELETE", "ACTIVATE", "DEACTIVATE"];

// Append-only audit of every change to an SMS template definition. Kept in the
// Global DB alongside the template master (the local-school AuditLog is a
// different database and tracks send-time activity, not definition changes).
const smsTemplateAuditSchema = new mongoose.Schema(
  {
    action: { type: String, enum: SMS_TEMPLATE_AUDIT_ACTIONS, required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "SmsTemplate", required: true, index: true },
    templateName: { type: String },
    domain: { type: String },
    actor: {
      id: { type: mongoose.Schema.Types.ObjectId },
      username: { type: String },
      role: { type: String },
    },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

smsTemplateAuditSchema.index({ createdAt: -1 });

export default mongoose.model("SmsTemplateAudit", smsTemplateAuditSchema);
