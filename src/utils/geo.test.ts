import { describe, it, expect } from 'vitest';
import { haversineKm, getCurrentPosition } from './geo';

describe('haversineKm', () => {
  it('distance nulle pour le même point', () => {
    expect(haversineKm({ lat: -20.88, lng: 55.45 }, { lat: -20.88, lng: 55.45 })).toBe(0);
  });

  it('distance St-Denis ↔ St-Pierre (Réunion) ≈ 35 km', () => {
    const stDenis = { lat: -20.8789, lng: 55.4481 };
    const stPierre = { lat: -21.3393, lng: 55.4781 };
    const d = haversineKm(stDenis, stPierre);
    expect(d).toBeGreaterThan(45);
    expect(d).toBeLessThan(60);
  });

  it('symétrique', () => {
    const a = { lat: 48.85, lng: 2.35 };
    const b = { lat: 45.76, lng: 4.83 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe('getCurrentPosition', () => {
  it('rejette proprement quand la géoloc est indisponible', async () => {
    // navigator.geolocation absent dans l'environnement de test node
    await expect(getCurrentPosition()).rejects.toThrow();
  });
});
