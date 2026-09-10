import mongoose from "mongoose";
import { countPlaceholders } from "../utils/dltTemplate.js";

export const SMS_TEMPLATE_DOMAINS = ["SCHOOL", "INMATE"];
export const SMS_TEMPLATE_STATUSES = ["ACTIVE", "INACTIVE"];

// Per-slot input specification. One entry per {#...#} in approvedText, in order.
//   source: "input"  -> the School Admin types the value in the SMS Center
//           "record" -> the value comes from an application record and is
//                       read-only to the sender (name, amount, date, ...)
const fieldSpecSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: ["text", "alphanumeric", "number"], default: "alphanumeric" },
    maxLength: { type: Number, default: 30 },
    required: { type: Boolean, default: true },
    source: { type: String, enum: ["input", "record"], default: "input" },
  },
  { _id: false }
);

const actorSchema = new mongoose.Schema(
  { id: { type: mongoose.Schema.Types.ObjectId }, username: { type: String } },
  { _id: false }
);

const smsTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },

    // Domain isolation boundary. SCHOOL is the only domain managed today; the
    // enum keeps room for INMATE without a migration. Never change after create.
    domain: { type: String, enum: SMS_TEMPLATE_DOMAINS, default: "SCHOOL", required: true, index: true },

    // The operator/DLT-registered numeric template id. Empty until configured;
    // a template cannot be ACTIVE without it.
    dltTemplateId: { type: String, default: "", trim: true },

    // The DLT-approved sender header this content template is registered under
    // (e.g. AGSWSL). Must match an ACTIVE SenderId.header. Empty until
    // configured; a template cannot be ACTIVE without it. The School Admin never
    // picks a sender — it is derived from the template at send time.
    senderId: { type: String, default: "", trim: true, uppercase: true },

    // The exact DLT-approved message, including the signature. Immutable content
    // apart from the {#...#} slots. Never assembled on the client.
    approvedText: { type: String, required: true, trim: true },
    placeholderCount: { type: Number, default: 0 },
    fields: { type: [fieldSpecSchema], default: [] },

    status: { type: String, enum: SMS_TEMPLATE_STATUSES, default: "INACTIVE", index: true },

    // Bumped whenever approvedText or dltTemplateId changes, so historical SMS
    // records can pin the exact version they were sent with.
    version: { type: Number, default: 1 },

    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },

    // Soft delete — rows are never physically removed.
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

smsTemplateSchema.index({ domain: 1, status: 1, deletedAt: 1 });
smsTemplateSchema.index(
  { domain: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

smsTemplateSchema.pre("save", function derivePlaceholders(next) {
  if (this.isModified("approvedText")) {
    this.placeholderCount = countPlaceholders(this.approvedText);
  }
  next();
});

export default mongoose.model("SmsTemplate", smsTemplateSchema);
