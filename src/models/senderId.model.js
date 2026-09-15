import mongoose from "mongoose";

export const SENDER_ID_DOMAINS = ["SCHOOL", "INMATE"];
export const SENDER_ID_STATUSES = ["ACTIVE", "INACTIVE"];

// A DLT-approved sender header (a.k.a. "Sender ID" / "header" in the operator
// portal, e.g. AGSWSL). Super Admin maintains this list by hand, mirroring what
// is approved in the Fast2SMS DLT Manager — there is no operator API to sync it.
//
// A sender is a property of an SmsTemplate (each DLT content template is
// registered under exactly one header), so nothing here is assigned to a school
// directly; the school's effective senders are derived from its allowed
// templates.
const actorSchema = new mongoose.Schema(
  { id: { type: mongoose.Schema.Types.ObjectId }, username: { type: String } },
  { _id: false }
);

const senderIdSchema = new mongoose.Schema(
  {
    // The approved header exactly as registered with the operator. DLT headers
    // are 3–11 chars, upper-case alphanumeric.
    header: { type: String, required: true, trim: true, uppercase: true, minlength: 3, maxlength: 11 },
    description: { type: String, default: "", trim: true },

    // Optional PE / Entity id from the DLT portal — informational only.
    dltEntityId: { type: String, default: "", trim: true },

    domain: { type: String, enum: SENDER_ID_DOMAINS, default: "SCHOOL", required: true, index: true },
    status: { type: String, enum: SENDER_ID_STATUSES, default: "ACTIVE", index: true },

    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },

    // Soft delete — rows are never physically removed.
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

senderIdSchema.index(
  { domain: 1, header: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

export default mongoose.model("SenderId", senderIdSchema);
