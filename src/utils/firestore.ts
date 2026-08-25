/**
 * FIRESTORE HELPERS — source de vérité UNIQUE
 *
 * `cleanUndefined` : Firestore REJETTE toute valeur `undefined` (même imbriquée
 * dans un tableau/objet). On la retire récursivement AVANT tout setDoc/updateDoc.
 * Avant : 3 copies récursives (missionService, pickupService, activityLogService)
 * + 2 variantes « shallow » incomplètes (driverLocationService, firestore.ts) qui
 * laissaient passer les undefined imbriqués. Une seule version ici.
 *
 * NB : `undefined` → retiré ; `null` → conservé (Firestore l'accepte). Les objets
 * spéciaux (Date/Timestamp) doivent être sérialisés AVANT (on n'écrit que des ISO
 * strings côté app), sinon ils seraient réduits par le parcours de clés.
 */
export const cleanUndefined = <T = any>(obj: T): T => {
  if (obj === undefined || obj === null) return null as unknown as T;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => cleanUndefined(v)) as unknown as T;
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    if (value !== undefined) {
      cleaned[key] = cleanUndefined(value);
    }
  }
  return cleaned as T;
};
