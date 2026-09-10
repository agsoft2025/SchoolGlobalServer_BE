import mongoose from "mongoose";

export const SENDER_ID_AUDIT_ACTIONS = ["CREATE", "UPDATE", "DELETE", "ACTIVATE", "DEACTIVATE"];

// Append-only audit of every change to a sender-header definition. Mirrors
// smsTemplateAudit.model.js.
const senderIdAuditSchema = new mongoose.Schema(
  {
    action: { type: String, enum: SENDER_ID_AUDIT_ACTIONS, required: true },
    senderIdRef: { type: mongoose.Schema.Types.ObjectId, ref: "SenderId", required: true, index: true },
    header: { type: String },
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

senderIdAuditSchema.index({ createdAt: -1 });

export default mongoose.model("SenderIdAudit", senderIdAuditSchema);
