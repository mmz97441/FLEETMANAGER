import { MissionStatus, PackageStatus, StopStatus } from '../types';

/** Display vocabulary only. Persisted statuses and lifecycle checks stay unchanged. */
export const missionStatusLabel = (status: MissionStatus | string): string => ({
  [MissionStatus.DRAFT]: 'En préparation',
  [MissionStatus.OPTIMIZED]: 'Ordre optimisé',
  [MissionStatus.DISPATCHED]: 'Affectée au chauffeur',
  [MissionStatus.IN_PROGRESS]: 'En cours',
  [MissionStatus.COMPLETED]: 'Terminée',
  [MissionStatus.CANCELLED]: 'Annulée',
}[status] || status);

export const packageStatusLabel = (status: PackageStatus | string): string => ({
  [PackageStatus.COLLECTED]: 'Pris en charge',
  [PackageStatus.FAILED]: 'Livraison en difficulté',
  [PackageStatus.RETURN_REQUESTED]: 'Retour à remettre',
  [PackageStatus.RETURNED]: 'Retour reçu',
}[status] || status);

export const stopStatusLabel = (status: StopStatus | string): string => ({
  [StopStatus.PENDING]: 'À traiter',
  [StopStatus.ARRIVED]: 'Sur place',
  [StopStatus.COMPLETED]: 'Terminé',
  [StopStatus.SKIPPED]: 'Non effectué',
  [StopStatus.FAILED]: 'En difficulté',
}[status] || status);
