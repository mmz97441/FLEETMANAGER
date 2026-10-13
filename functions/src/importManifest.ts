export interface ImportManifest {
  clientId: string;
  references: string[];
  fileName?: string;
  rejectedRows?: number;
}
export function importReference(row: { externalId?: unknown; orderNumber?: unknown; barcode?: unknown; packageIndex?: unknown }): string {
  return `${String(row.externalId || row.orderNumber || row.barcode || '').trim().toUpperCase()}\t${String(row.packageIndex || '')}`;
}
export function validateImportManifest(manifest: ImportManifest, rows: any[]): ImportManifest {
  if (!manifest || typeof manifest.clientId !== 'string' || !manifest.clientId ||
      !Array.isArray(manifest.references) || !manifest.references.length || manifest.references.length > 10000 || JSON.stringify(manifest.references).length > 200000 ||
      manifest.references.some(r => typeof r !== 'string' || !r.trim() || r.length > 300) ||
      !Number.isSafeInteger(manifest.rejectedRows ?? 0) || (manifest.rejectedRows ?? 0) < 0 ||
      (manifest.fileName != null && (typeof manifest.fileName !== 'string' || manifest.fileName.length > 250)))
    throw new Error('Liste des colis attendus invalide. Relisez le fichier avant de reprendre.');
  const references = [...new Set(manifest.references)].sort();
  const expected = new Set(references);
  if (rows.some(row => row.clientId !== manifest.clientId || !expected.has(importReference(row))))
    throw new Error('Ce lot ne correspond pas à la liste des colis attendus.');
  return { clientId: manifest.clientId, references, fileName: manifest.fileName || '', rejectedRows: manifest.rejectedRows || 0 };
}
