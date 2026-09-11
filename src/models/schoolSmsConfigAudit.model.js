import mongoose from "mongoose";

export const SCHOOL_SMS_CONFIG_AUDIT_ACTIONS = [
  "ASSIGN",
  "CHANGE",
  "CLEAR",
];

// Append-only audit of every change to a school's assigned SMS Sender ID.

const schoolSmsConfigAuditSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: SCHOOL_SMS_CONFIG_AUDIT_ACTIONS,
      required: true,
    },

    externalId: {
      type: String,
      required: true,
      index: true,
    },

    schoolName: {
      type: String,
    },

    actor: {
      id: {
        type: mongoose.Schema.Types.ObjectId,
      },
      username: {
        type: String,
      },
      role: {
        type: String,
      },
    },

    before: {
      assignedSenderId: {
        type: String,
        default: "",
      },
    },

    after: {
      assignedSenderId: {
        type: String,
        default: "",
      },
    },
  },
  { timestamps: true }
);

schoolSmsConfigAuditSchema.index({ createdAt: -1 });

export default mongoose.model(
  "SchoolSmsConfigAudit",
  schoolSmsConfigAuditSchema
);