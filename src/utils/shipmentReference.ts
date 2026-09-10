/** Display only; never use the grouped string as an identity, barcode or lookup key. */
export function displayShipmentReference(reference: string): string {
  return /^CL-\d{42}$/.test(reference) ? `CL-${reference.slice(3).match(/.{1,3}/g)!.join(' ')}` : reference;
}

export async function copyShipmentReference(reference: string, clipboard: Pick<Clipboard, 'writeText'> | undefined = navigator.clipboard): Promise<void> {
  if (!clipboard) throw new Error('La copie automatique n’est pas disponible. Sélectionnez la référence complète ci-dessous.');
  await clipboard.writeText(reference);
}
