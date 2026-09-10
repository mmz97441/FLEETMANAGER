import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Package, PackageStatus } from '../types';
import { reportError } from './logService';
const PACKAGES_COLLECTION = 'packages';

export const listenClientPackages = (
  client: { id: string; companyName?: string },
  callback: (packages: Package[]) => void,
  onError?: (error: Error) => void
) => {
  const company = (client.companyName || '').trim();
  let idReady = false;
  let nameReady = !company;
  let stopped = false;
  let failed = false;
  const trackingById = new Map<string, any[]>();
  let byId: Package[] = [];
  let byName: Package[] = [];
  const parcelError = (error: Error) => {
    if (stopped) return;
    failed = true;
    if (onError) onError(error);
    else reportError('clientPackages.subscribe', error, { userMessage: 'Les colis ne peuvent pas être chargés. Réessayez dans quelques instants.' });
  };
  const emit = () => {
    // Tracking can arrive first. Never call an incomplete parcel union a ready list.
    if (stopped || failed || !idReady || !nameReady) return;
    const map = new Map<string, Package>();
    [...byId, ...byName].forEach(p => map.set(p.id, p));
    const merged = Array.from(map.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const tracks = Array.from(trackingById.values()).flat();
    callback(merged.map(pkg => {
      if (pkg.status !== PackageStatus.IN_DELIVERY) return pkg;
      const track = tracks.find(t=>t.missionId===pkg.missionId && t.ranks?.[pkg.id]!==undefined);
      return track ? {...pkg,liveDriver:track.liveDriver,remainingBeforeMine:track.ranks[pkg.id]} : pkg;
    }));
  };

  const qId = query(collection(db, PACKAGES_COLLECTION), where('clientId', '==', client.id));
  const unsub1 = onSnapshot(qId, snap => {
    byId = snap.docs.map(d => ({ id: d.id, ...d.data() } as Package));
    idReady = true;
    emit();
  }, parcelError);

  let unsub2: () => void = () => {};
  if (company) {
    const qName = query(collection(db, PACKAGES_COLLECTION), where('clientName', '==', company));
    unsub2 = onSnapshot(qName, snap => {
      byName = snap.docs.map(d => ({ id: d.id, ...d.data() } as Package));
      nameReady = true;
      emit();
    }, parcelError);
  }

  const trackingQueries = [query(collection(db,'client_tracking'),where('clientId','==',client.id))];
  if (company) trackingQueries.push(query(collection(db,'client_tracking'),where('clientName','==',company)));
  const trackingUnsubs = trackingQueries.map((q,i)=>onSnapshot(q,snap=>{
    trackingById.set(String(i),snap.docs.map(d=>d.data())); emit();
  },error=>{
    trackingById.delete(String(i));
    emit();
    reportError('tracking.subscribe',error,{silent:true});
  }));
  return () => { stopped = true; unsub1(); unsub2(); trackingUnsubs.forEach(unsub=>unsub()); };
};
