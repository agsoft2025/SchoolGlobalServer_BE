import mongoose from "mongoose";

// Per-school SMS configuration: the DLT Sender ID(s) a given school/location may
// send under. One document per school, keyed by the cross-service tenant key
// `externalId` (== local StudentLocation._id == Global Location.externalId —
// see syncGlobalLocationService.js).
//
// The school's available templates are NOT stored here — they are derived from
// the existing SmsTemplate.senderId join (a template is registered under exactly
// one header). School → assignedSenderIds → SmsTemplate.senderId ∈ that set.
//
// Absent document  => grace fallback to DEFAULT_SMS_SENDER_ID (historical single
//                     sender; keeps pre-feature schools working).
// assignedSenderIds: []  => explicit "none": the school cannot send SMS.
const actorSchema = new mongoose.Schema(
  { id: { type: mongoose.Schema.Types.ObjectId }, username: { type: String } },
  { _id: false }
);

const schoolSmsConfigSchema = new mongoose.Schema(
  {
    externalId: { type: String, required: true, unique: true, index: true, trim: true },

    // Denormalised from the Location doc purely for display in the Super Admin
    // list — never used for matching.
    schoolCode: { type: String, default: "", trim: true },
    name: { type: String, default: "", trim: true },
    location: { type: String, default: "", trim: true },

    // DLT-approved sender headers this school may send under. Each must match an
    // ACTIVE SenderId.header. Empty array = explicitly disabled.
    assignedSenderId: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },

    updatedBy: { type: actorSchema },
  },
  { timestamps: true }
);

export default mongoose.model("SchoolSmsConfig", schoolSmsConfigSchema);
