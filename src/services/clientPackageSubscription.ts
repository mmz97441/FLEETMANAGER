import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Package, PackageStatus } from '../types';
import { reportError } from './logService';
import { subscribeParcelFeed, type ParcelCoverage, type ParcelFeedController } from './parcelFeed';

export function subscribeClientParcelFeed(
  client: { id: string; companyName?: string },
  callback: (packages: Package[], coverage: ParcelCoverage) => void,
  onError?: (error: Error) => void,
  onCoverage?: (coverage: ParcelCoverage) => void,
): ParcelFeedController {
  const company = (client.companyName || '').trim();
  const scopes = [{ field: 'clientId' as const, value: client.id }, ...(company ? [{ field: 'clientName' as const, value: company }] : [])];
  const trackingById = new Map<string, any[]>();
  let stopped = false, parcels: Package[] | undefined, coverage: ParcelCoverage | undefined;
  const withTracking = (packages: Package[]) => {
    const tracks = [...trackingById.values()].flat();
    return packages.map(pkg => {
      if (pkg.status !== PackageStatus.IN_DELIVERY) return pkg;
      const track = tracks.find(t => t.missionId === pkg.missionId && t.ranks?.[pkg.id] !== undefined);
      return track ? { ...pkg, liveDriver: track.liveDriver, remainingBeforeMine: track.ranks[pkg.id] } : pkg;
    });
  };
  const emit = () => { if (!stopped && parcels && coverage?.activeReady && !coverage.error) callback(withTracking(parcels), coverage); };
  const feed = subscribeParcelFeed({ scopes, onChange: (items, state) => { parcels = items; coverage = state; emit(); },
    onCoverage: state => { coverage = state; onCoverage?.(state); },
    onError: error => { if (onError) onError(error); else reportError('clientPackages.subscribe', error, { userMessage: 'Les colis ne peuvent pas être chargés. Réessayez dans quelques instants.' }); } });
  const trackingUnsubs = scopes.map((scope, i) => onSnapshot(query(collection(db, 'client_tracking'), where(scope.field, '==', scope.value)), snapshot => {
    trackingById.set(String(i), snapshot.docs.map(doc => doc.data())); emit();
  }, error => { trackingById.delete(String(i)); emit(); reportError('tracking.subscribe', error, { silent: true }); }));
  return { loadMore: () => feed.loadMore(), loadAll: async () => withTracking(await feed.loadAll()),
    unsubscribe: () => { stopped = true; feed.unsubscribe(); trackingUnsubs.forEach(unsub => unsub()); } };
}

/** Compatibility for consumers requiring the complete history. Interactive lists
 * should use subscribeClientParcelFeed and expose its explicit coverage. */
export const listenClientPackages = (
  client: { id: string; companyName?: string }, callback: (packages: Package[]) => void, onError?: (error: Error) => void,
) => {
  let loading = false, stopped = false;
  let feed: ParcelFeedController;
  feed = subscribeClientParcelFeed(client, (packages, coverage) => {
    if (stopped) return;
    if (coverage.historyComplete) callback(packages);
    else if (!loading && !coverage.historyLoading) {
      loading = true;
      void feed.loadAll().then(complete => { if (!stopped) callback(complete); }).catch(() => {}).finally(() => { loading = false; });
    }
  }, onError);
  return () => { stopped = true; feed.unsubscribe(); };
};
