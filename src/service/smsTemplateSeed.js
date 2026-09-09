import SmsTemplate from "../models/smsTemplate.model.js";
import { countPlaceholders, defaultFields } from "../utils/dltTemplate.js";

// Idempotent seed of the currently-approved SCHOOL SMS templates. A row that
// already exists (matched by domain + name) is left untouched, so Super Admin
// edits always win over the seed.
const SEED = [
  {
    name: "Exam Marks",
    description: "Sends a student's exam marks summary to the registered parent number.",
    domain: "SCHOOL",
    // The real DLT template id for this approved text is NOT present anywhere in
    // the codebase. Supply it via SCHOOL_EXAM_MARKS_DLT_TEMPLATE_ID or the Super
    // Admin UI. Until then the template is created INACTIVE and cannot be used
    // for sending.
    dltTemplateId: process.env.SCHOOL_EXAM_MARKS_DLT_TEMPLATE_ID || "",
    // IMPORTANT: on the Fast2SMS `dlt` route the delivered SMS is rendered by the
    // OPERATOR from the template registered in the DLT portal under the id above —
    // this string is NOT transmitted, it only drives our preview / char-count /
    // value validation. It must therefore be a BYTE-EXACT copy of the portal
    // registration, including whitespace. The portal registration for this text
    // has a space before the full stop after the variable ("{#var#} ."), so a
    // clean "{#alphanumeric#}." here made the preview disagree with real delivery
    // ("Dear Student, your marks are: Vikas . Please contact ..."). Kept in sync
    // below; if the portal text is ever corrected, update this to match.
    approvedText:
      "Dear Student, your marks are: {#alphanumeric#} . Please contact your School Management for further details. - AG SOFT SOLUTIONS",
    fields: [
      {
        key: "marks_summary",
        label: "Marks summary",
        type: "alphanumeric",
        maxLength: 30,
        required: true,
        source: "input",
      },
    ],
  },
  {
    // The one DLT template currently approved & working on this Fast2SMS account
    // (id 224809 — already present in the School server config as
    // FAST2SMS_OTP_TEMPLATE_ID and the offline fallback). Seeded ACTIVE so the
    // SMS Center keeps working end-to-end while a real "Exam Marks" DLT id is
    // registered.
    name: "Student Notification",
    description: "General student notification (2-slot DLT template 224809).",
    domain: "SCHOOL",
    dltTemplateId: process.env.SCHOOL_STUDENT_NOTIFICATION_DLT_TEMPLATE_ID || "224809",
    approvedText: "Dear {#var#}, {#var#} - SID GROUPS",
    fields: [
      { key: "student_name", label: "Student name", type: "text", maxLength: 30, required: true, source: "record" },
      { key: "message", label: "Message text", type: "alphanumeric", maxLength: 160, required: true, source: "input" },
    ],
  },
];

export const seedSmsTemplates = async () => {
  for (const tpl of SEED) {
    const exists = await SmsTemplate.findOne({ domain: tpl.domain, name: tpl.name });
    if (exists) continue;

    const fields = tpl.fields?.length ? tpl.fields : defaultFields(tpl.approvedText);
    await SmsTemplate.create({
      name: tpl.name,
      description: tpl.description || "",
      domain: tpl.domain,
      dltTemplateId: tpl.dltTemplateId || "",
      approvedText: tpl.approvedText,
      placeholderCount: countPlaceholders(tpl.approvedText),
      fields,
      status: tpl.dltTemplateId ? "ACTIVE" : "INACTIVE",
      version: 1,
      createdBy: { username: "system-seed" },
      updatedBy: { username: "system-seed" },
    });

    console.log(
      `🌱 Seeded SMS template ${tpl.domain}/${tpl.name} — ` +
        (tpl.dltTemplateId ? "ACTIVE" : "INACTIVE (set a DLT Template ID to activate)")
    );
  }
};
