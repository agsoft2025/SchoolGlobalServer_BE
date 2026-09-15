import SenderId from "../models/senderId.model.js";
import SmsTemplate from "../models/smsTemplate.model.js";
import SchoolSmsConfig from "../models/schoolSmsConfig.model.js";

// Idempotent rollout seed for school-wise Sender ID + template isolation.
//
//  1. Register the current default sender header so existing ACTIVE templates
//     stay valid under the new "template must have a registered sender" rule.
//  2. Backfill SmsTemplate.senderId for templates created before the field
//     existed.
//
// Per-school SchoolSmsConfig rows are NOT seeded here: the authoritative school
// list lives on the local school server (many schools never sync a Global
// Location row), and until the Super Admin configures a school the internal
// feed falls back to "all ACTIVE templates" so nothing breaks. The Super Admin
// then narrows each school from the portal.
//
// Safe to re-run: both steps are guarded / no-op once done.
export const seedSenderAndSchoolConfig = async () => {
  const DEFAULT_HEADER = (process.env.DEFAULT_SMS_SENDER_ID || "AGSWSL").trim().toUpperCase();

  // 1. Default sender header
  const exists = await SenderId.findOne({ domain: "SCHOOL", header: DEFAULT_HEADER, deletedAt: null });
  if (!exists) {
    await SenderId.create({
      header: DEFAULT_HEADER,
      description: "Default sender header (seeded during school-wise SMS isolation rollout).",
      domain: "SCHOOL",
      status: "ACTIVE",
      createdBy: { username: "system-seed" },
      updatedBy: { username: "system-seed" },
    });
    console.log(`🌱 Seeded default SMS sender header ${DEFAULT_HEADER}`);
  }

  // 2. Backfill templates with no sender header
  const backfilled = await SmsTemplate.updateMany(
    { domain: "SCHOOL", $or: [{ senderId: { $exists: false } }, { senderId: "" }, { senderId: null }] },
    { $set: { senderId: DEFAULT_HEADER } }
  );
  if (backfilled.modifiedCount) {
    console.log(`🌱 Backfilled senderId=${DEFAULT_HEADER} on ${backfilled.modifiedCount} SMS template(s)`);
  }

  // 3. Drop the obsolete per-template whitelist field left by the earlier model
  //    (school config is now keyed on assignedSenderIds).
  const cleaned = await SchoolSmsConfig.updateMany(
    { allowedTemplateIds: { $exists: true } },
    { $unset: { allowedTemplateIds: "" } }
  );
  if (cleaned.modifiedCount) {
    console.log(`🌱 Removed obsolete allowedTemplateIds from ${cleaned.modifiedCount} school SMS config(s)`);
  }
};
