/** Parse only complete finite decimal input; an empty draft is never zero. */
export function parseNumericDraft(
  draft: string,
  { min, max }: { min: number; max: number },
): number | null {
  const text = draft.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}
