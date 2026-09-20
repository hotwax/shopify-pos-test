/** Only the combined row-label format observed in POS is supported. Fail closed
 * for new/localized/ambiguous formats instead of guessing an order reference. */
export function readRowReference(label: string | null): string {
  const parts = label?.split(' • ');
  if (!parts || parts.length !== 2 || !parts[0].trim() || !parts[1].trim() || /[\r\n]/.test(parts[0])) {
    throw new Error('Cannot read an unambiguous order reference from the row label; inspect this POS version.');
  }
  return parts[0].trim();
}
