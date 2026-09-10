/** Stable codes allow the existing transactional import endpoint to recognize retries. */
export function trackingCodeForRequest(requestId: string, index: number): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) {
    throw new Error('Identifiant de création invalide. Rouvrez le formulaire avant de créer cette expédition.');
  }
  if (!Number.isInteger(index) || index < 1 || index > 50) throw new Error('Nombre de colis invalide.');
  // Keep all 128 bits. An even-length decimal payload lets CODE128 use its
  // compact numeric alphabet instead of encoding each hexadecimal character.
  const identity = BigInt(`0x${requestId.replace(/-/g, '')}`).toString(10).padStart(40, '0');
  return `CL-${identity}${String(index).padStart(2, '0')}`;
}
