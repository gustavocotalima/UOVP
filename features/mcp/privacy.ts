// Financial labels are useful analysis data, but can contain an incidental CPF.
// Never forward provider payloads or account/card identifiers through this helper.
export function redactAnalysisText(value: string | null | undefined, maxLength = 500) {
  if (!value) return null;
  return value.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
    .replace(/\b\d{11}\b/g, "[identifier]")
    .slice(0, maxLength);
}
