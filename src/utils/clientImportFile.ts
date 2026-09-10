/** CSV exports commonly use UTF-8 without a BOM; legacy Excel files may use Windows-1252. */
export function decodeClientCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}
