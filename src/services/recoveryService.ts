import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Package, PackageStatus, User, UserRole } from '../types';

/** Active work and unqualified legacy returns have no arbitrary history limit. */
export function subscribeToRecoveryPackages(user: User, callback: (packages: Package[]) => void, onError: (error: Error) => void) {
  const office = [UserRole.ADMIN, UserRole.PRESIDENT, UserRole.DIRECTOR, UserRole.SECRETARY].includes(user.role);
  const source = collection(db, 'packages');
  const q = office ? query(source, where('status', 'in', [PackageStatus.PENDING, PackageStatus.COLLECTED, PackageStatus.AT_HUB,
    PackageStatus.SORTED, PackageStatus.IN_TRANSIT, PackageStatus.LOADED, PackageStatus.IN_DELIVERY, PackageStatus.FAILED, PackageStatus.RETURN_REQUESTED, PackageStatus.RETURNED]))
    : query(source, where('currentDriverId', '==', user.id));
  return onSnapshot(q, snapshot => callback(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Package))), onError);
}
