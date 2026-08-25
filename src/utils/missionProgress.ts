/**
 * PROGRESSION D'UNE TOURNÉE — source de vérité UNIQUE
 *
 * ⚠️ Il y a DEUX métriques distinctes, à ne PAS confondre (c'était la source de
 * l'incohérence entre écrans) :
 *
 *  1) AVANCEMENT (`getTourProgress`) : « où en est le chauffeur ? ». Compte les
 *     arrêts TRAITÉS = terminés OU échoués OU sautés, sur TOUS les arrêts
 *     (enlèvement inclus). Un échec fait avancer la tournée (le chauffeur est passé).
 *
 *  2) LIVRÉS (`getDeliveryStopStats`) : « combien de livraisons RÉUSSIES ? ».
 *     Compte les arrêts de type DELIVERY au statut COMPLETED, sur le total des
 *     arrêts DELIVERY. Un échec n'est PAS un « livré ».
 *
 * Utiliser getTourProgress pour une barre « avancement », getDeliveryStopStats
 * pour un compteur « X/Y livrés ». Ne jamais réécrire ces calculs à la main.
 */

import { MissionStop, StopStatus } from '../types';

interface StopsHolder { stops?: MissionStop[]; }

/** Un arrêt est « traité » : le chauffeur est passé (terminé, échoué ou sauté). */
export const isStopDone = (s: MissionStop): boolean =>
  s.status === StopStatus.COMPLETED ||
  s.status === StopStatus.FAILED ||
  s.status === StopStatus.SKIPPED;

export interface TourProgress { done: number; total: number; pct: number; }

/** Avancement de la tournée : arrêts traités / total (tous types d'arrêts). */
export const getTourProgress = (mission: StopsHolder): TourProgress => {
  const stops = mission.stops || [];
  const total = stops.length;
  const done = stops.filter(isStopDone).length;
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
};

export interface DeliveryStopStats { delivered: number; total: number; pct: number; }

/** Livraisons réussies : arrêts DELIVERY au statut COMPLETED / total DELIVERY. */
export const getDeliveryStopStats = (mission: StopsHolder): DeliveryStopStats => {
  const deliveryStops = (mission.stops || []).filter((s) => s.type === 'DELIVERY');
  const total = deliveryStops.length;
  const delivered = deliveryStops.filter((s) => s.status === StopStatus.COMPLETED).length;
  return { delivered, total, pct: total > 0 ? Math.round((delivered / total) * 100) : 0 };
};
