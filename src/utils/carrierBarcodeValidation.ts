export function carrierBarcodeError(value: unknown, reference: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return 'Code Boiron numérique : recopiez les 22 chiffres depuis l’étiquette dans une cellule texte.';
  const code = value.trim();
  if (!/^00\d{20}$/.test(code)) return 'Le code Boiron doit contenir exactement 22 chiffres, avec ses zéros initiaux.';
  if (code.slice(2, 10) !== String(reference || '').trim()) return 'Le code Boiron ne correspond pas à la référence de commande.';
  return null;
}
