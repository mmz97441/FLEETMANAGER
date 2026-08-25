import { describe, it, expect } from 'vitest';
import { getTourProgress, getDeliveryStopStats, isStopDone } from './missionProgress';
import { StopStatus, MissionStop } from '../types';

const stop = (type: 'PICKUP' | 'DELIVERY', status: StopStatus): MissionStop =>
  ({ id: Math.random().toString(), sequence: 1, type, status, packageIds: [], packageCount: 0 } as unknown as MissionStop);

describe('isStopDone', () => {
  it('traité = terminé, échoué ou sauté', () => {
    expect(isStopDone(stop('DELIVERY', StopStatus.COMPLETED))).toBe(true);
    expect(isStopDone(stop('DELIVERY', StopStatus.FAILED))).toBe(true);
    expect(isStopDone(stop('DELIVERY', StopStatus.SKIPPED))).toBe(true);
    expect(isStopDone(stop('DELIVERY', StopStatus.PENDING))).toBe(false);
    expect(isStopDone(stop('DELIVERY', StopStatus.ARRIVED))).toBe(false);
  });
});

describe('getTourProgress (avancement)', () => {
  it('compte les arrêts traités sur TOUS les arrêts (échec/saut inclus)', () => {
    const m = { stops: [
      stop('PICKUP', StopStatus.COMPLETED),
      stop('DELIVERY', StopStatus.COMPLETED),
      stop('DELIVERY', StopStatus.FAILED),
      stop('DELIVERY', StopStatus.PENDING),
    ]};
    expect(getTourProgress(m)).toEqual({ done: 3, total: 4, pct: 75 });
  });
  it('0 arrêt → pct 0 sans division par zéro', () => {
    expect(getTourProgress({ stops: [] })).toEqual({ done: 0, total: 0, pct: 0 });
    expect(getTourProgress({})).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe('getDeliveryStopStats (livrés)', () => {
  it('ne compte QUE les DELIVERY COMPLETED, ignore pickup et échecs', () => {
    const m = { stops: [
      stop('PICKUP', StopStatus.COMPLETED),   // ignoré (pas DELIVERY)
      stop('DELIVERY', StopStatus.COMPLETED), // livré
      stop('DELIVERY', StopStatus.FAILED),    // pas livré
      stop('DELIVERY', StopStatus.PENDING),   // pas livré
    ]};
    expect(getDeliveryStopStats(m)).toEqual({ delivered: 1, total: 3, pct: 33 });
  });
});
