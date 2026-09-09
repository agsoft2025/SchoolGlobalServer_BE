// DLT-approved SMS templates carry positional variable slots written as {#var#}
// (e.g. {#alphanumeric#}). These helpers parse, validate and assemble the final
// message from the approved text + an ordered list of runtime values. The
// approved text and its signature are treated as immutable — only the {#...#}
// slots are ever substituted.

export const DLT_TOKEN = /\{#\s*[A-Za-z0-9_]+\s*#\}/g;

// DLT platforms cap each variable; Fast2SMS/most operators use 30 chars.
export const MAX_VAR_LENGTH = 30;

export const countPlaceholders = (approvedText = "") =>
  (String(approvedText).match(DLT_TOKEN) || []).length;

// Ordered default input spec — one field per {#...#} slot — used when the Super
// Admin does not define a richer field spec.
export const defaultFields = (approvedText = "") =>
  Array.from({ length: countPlaceholders(approvedText) }, (_, i) => ({
    key: `value_${i + 1}`,
    label: `Value ${i + 1}`,
    type: "alphanumeric",
    maxLength: MAX_VAR_LENGTH,
    required: true,
    source: "input",
  }));

// Values a "record" slot may be auto-filled from. MUST stay in sync with the
// keys emitted by SchoolServer_BE/src/service/sms/recipientResolver.js — a slot
// bound to any other key would resolve to an empty string on every send.
export const RECORD_FIELD_KEYS = [
  "student_name",
  "father_name",
  "mother_name",
  "registration_number",
  "class_name",
  "section",
  "hostel_name",
  "board_name",
];

// Validate + normalize a Super-Admin-supplied field spec against the approved
// text. Returns { ok, error } or { ok, fields }. The spec is what lets the
// School Admin's SMS Center know which {#...#} slots it must ask a human to type
// ("input") and which it fills from each student's record ("record"); a spec
// that doesn't line up with the {#...#} count would silently mis-map every slot.
export const normalizeFields = (approvedText = "", fields) => {
  const need = countPlaceholders(approvedText);
  if (fields === undefined || fields === null) return { ok: true, fields: defaultFields(approvedText) };
  if (!Array.isArray(fields)) return { ok: false, error: "fields must be an array" };
  if (fields.length !== need) {
    return { ok: false, error: `fields must describe exactly ${need} slot(s), received ${fields.length}` };
  }

  const seen = new Set();
  const normalized = [];
  for (let i = 0; i < fields.length; i += 1) {
    const f = fields[i] || {};
    const source = f.source === "record" ? "record" : "input";
    const label = String(f.label ?? "").trim() || `Value ${i + 1}`;

    let key;
    if (source === "record") {
      key = String(f.key ?? "").trim();
      if (!RECORD_FIELD_KEYS.includes(key)) {
        return { ok: false, error: `Slot ${i + 1} ("${label}"): pick a valid student field` };
      }
    } else {
      key = String(f.key ?? "").trim() || `value_${i + 1}`;
    }
    if (seen.has(key)) return { ok: false, error: `Slot ${i + 1} ("${label}"): duplicate field "${key}"` };
    seen.add(key);

    // Default to the DLT per-variable norm (30) but let the Super Admin widen it
    // for slots the operator actually allows longer (e.g. a free-text message
    // slot). Hard ceiling keeps a typo from allowing a multi-part-SMS value.
    const rawMax = Number(f.maxLength);
    const maxLength = Number.isFinite(rawMax) && rawMax > 0 ? Math.min(Math.round(rawMax), 500) : MAX_VAR_LENGTH;

    normalized.push({
      key,
      label,
      type: ["text", "alphanumeric", "number"].includes(f.type) ? f.type : "alphanumeric",
      maxLength,
      required: f.required === undefined ? true : !!f.required,
      source,
    });
  }
  return { ok: true, fields: normalized };
};

// values: ordered array of strings. Returns { ok, error }.
export const validateValues = (approvedText, values = [], fields = []) => {
  const need = countPlaceholders(approvedText);
  if (!Array.isArray(values)) return { ok: false, error: "values must be an array" };
  if (values.length !== need) {
    return { ok: false, error: `Template needs exactly ${need} value(s), received ${values.length}` };
  }
  for (let i = 0; i < values.length; i += 1) {
    const raw = values[i];
    const v = String(raw ?? "").trim();
    const label = fields[i]?.label ? ` (${fields[i].label})` : "";
    if (!v) return { ok: false, error: `Value ${i + 1}${label} is required` };
    const max = fields[i]?.maxLength || MAX_VAR_LENGTH;
    if (v.length > max) return { ok: false, error: `Value ${i + 1}${label} exceeds ${max} characters` };
  }
  return { ok: true };
};

// Replace the i-th {#...#} slot with values[i]; punctuation/signature untouched.
export const assembleMessage = (approvedText, values = []) => {
  let i = 0;
  return String(approvedText).replace(DLT_TOKEN, () => String(values[i++] ?? "").trim());
};
