/**
 * SERVICE POSITION CHAUFFEURS (live)
 * ==================================
 * Chaque chauffeur connecté publie sa position (~toutes les 30s) dans la
 * collection 'driverLocations' (doc id = driverId). Le dispatch s'y abonne
 * pour voir la flotte en temps réel sur une carte.
 */
import { db } from '../firebaseConfig';
import { collection, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { DriverLocation } from '../types';
import { cleanUndefined } from '../utils/firestore';
import { reportError } from './logService';

const COLLECTION = 'driverLocations';

/** Publie/actualise la position d'un chauffeur (upsert). */
export const publishDriverLocation = async (
  loc: Omit<DriverLocation, 'updatedAt'>
): Promise<void> => {
  const payload: DriverLocation = {
    ...loc,
    updatedAt: new Date().toISOString(),
  };
  // On retire les champs undefined (Firestore les refuse), en profondeur.
  const clean = cleanUndefined(payload);
  await setDoc(doc(db, COLLECTION, loc.driverId), clean, { merge: true });
};

/** Abonnement temps réel à toutes les positions chauffeurs. */
export const subscribeToDriverLocations = (
  callback: (locations: DriverLocation[]) => void,
  onError?: (error: unknown) => void,
  onSource?: (source: 'cache' | 'live') => void,
): (() => void) => {
  return onSnapshot(collection(db, COLLECTION), { includeMetadataChanges: true }, (snap) => {
    onSource?.(snap.metadata.fromCache ? 'cache' : 'live');
    callback(snap.docs.map(d => ({ ...d.data(), driverId: d.id } as DriverLocation)));
  }, error => {
    reportError('drivers.locations.load', error, { silent: true });
    onError?.(error);
  });
};
