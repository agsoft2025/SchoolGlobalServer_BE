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
