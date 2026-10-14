import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { Package, PackageStatus, ProofOfDelivery, Zone } from '../types';
import ClientKPIs from './ClientKPIs';
import MissionKPIs from './MissionKPIs';
import PODViewer from './PODViewer';

afterEach(() => vi.useRealTimers());

it('shows the same success rate in customer and office dashboards for decided attempts', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T08:00:00Z'));
  const packages = [PackageStatus.DELIVERED, PackageStatus.RETURNED, PackageStatus.RETURNED, PackageStatus.IN_DELIVERY, PackageStatus.PENDING]
    .map((status, i) => ({ id: String(i), status, createdAt: '2026-10-12T05:00:00Z', zone: Zone.NORD,
      movements: i < 3 ? [{ action: i ? 'RETURNED' : 'DELIVERED', timestamp: '2026-10-14T05:00:00Z' }] : [],
    })) as Package[];
  for (const component of [<ClientKPIs packages={packages} />, <MissionKPIs packages={packages} missions={[]} users={[]} selectedDate="2026-10-14" />]) {
    const html = renderToStaticMarkup(component);
    expect(html).toContain('33%');
    expect(html).toContain('Succès des tentatives');
    expect(html).toContain('toutes dates');
  }
});

it('renders a failed attempt as non-delivered and supports missing GPS', () => {
  const proof = { type: 'FAILURE', packageId: 'p', missionId: 'm', stopId: 's', driverName: 'Chauffeur',
    timestamp: '2026-10-14T05:00:00Z', coordinates: null, photoUrls: ['https://storage.test/photo'],
    failureReason: 'Destinataire absent', failureNotes: 'Porte fermée',
  } as ProofOfDelivery;
  const html = renderToStaticMarkup(<PODViewer pod={proof} onClose={() => {}} />);
  expect(html).toContain('Preuve de tentative non aboutie');
  expect(html).toContain('Colis non remis');
  expect(html).toContain('Destinataire absent');
  expect(html).toContain('Position non disponible');
  expect(html).not.toContain('Livré avec succès');
  expect(html).not.toContain('Réceptionné par');
});

it('shows the historical recipient snapshot instead of a subsequently corrected delivery address', () => {
  const proof = { type: 'FAILURE', packageId: 'p', missionId: 'm', stopId: 's', driverId: 'd', driverName: 'Chauffeur', vehicleId: 'v', vehiclePlate: 'TEST', photoUrls: [], coordinates: null,
    timestamp: '2026-10-14T05:00:00Z', destination: { contactName: 'Ancien destinataire', address: '1 rue Ancienne', city: 'Saint-Denis', postalCode: '97400', floor: 2 },
  } as ProofOfDelivery;
  const current = { orderNumber: 'REF', contactName: 'Nouveau destinataire', address: '2 rue Nouvelle', city: 'Saint-Paul' };
  const historical = renderToStaticMarkup(<PODViewer pod={proof} packageInfo={current} onClose={() => {}} />);
  expect(historical).toContain('1 rue Ancienne');
  expect(historical).not.toContain('2 rue Nouvelle');
  expect(historical).toContain('Adresse lors de la tentative');
  const legacy = renderToStaticMarkup(<PODViewer pod={{ ...proof, destination: undefined }} packageInfo={current} onClose={() => {}} />);
  expect(legacy).toContain('Adresse actuelle (preuve historique sans adresse figée)');
});
