import type { DeliveryAttempt, Package, ProofOfDelivery } from '../types';

export function latestDeliveryAttempt(pkg: Package): DeliveryAttempt | undefined {
  return [...(pkg.deliveryAttempts || [])].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0];
}
export function proofForAttempt(pkg: Package, attempt: Pick<DeliveryAttempt, 'id' | 'missionId' | 'stopId'>): ProofOfDelivery | undefined {
  return pkg.deliveryAttempts?.find(item => item.id === attempt.id)?.proof || [pkg.pod, pkg.failurePod].find(proof =>
    proof && (proof.proofId || `${proof.missionId}_${proof.stopId}`) === attempt.id);
}
/** New decisions have an attempt before photos are published. Legacy records without
 * an attempt cannot be described as still synchronizing indefinitely. */
export function hasPendingDeliveryProof(pkg: Package): boolean {
  const attempt = latestDeliveryAttempt(pkg);
  return !!attempt && !proofForAttempt(pkg, attempt);
}
