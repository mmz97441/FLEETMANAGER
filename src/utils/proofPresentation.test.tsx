import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { presentProof, buildProofPrintHTML } from './proofPresentation';
import PODViewer from '../components/PODViewer';
import PackageTimeline from '../components/PackageTimeline';
import { clientParcelGroups } from './clientParcelView';
import { buildDeliveryNoteHTML, packagesAtSamePoint } from './deliveryNote';
import { Package, PackageStatus, ProofOfDelivery, Zone } from '../types';
const info = { orderNumber: 'ORDER-42', parcelReference: 'BR-00001', clientReference: 'CLIENT-42', contactName: 'Pharmacie', address: '1 rue Ici', city: 'Saint-Denis' };
const proof: ProofOfDelivery = { packageId: 'firestore-id', missionId: 'm', stopId: 's', driverId: 'd', driverName: 'Conducteur', vehicleId: 'v', vehiclePlate: 'TEST', type: 'SUCCESS',
  timestamp: '2026-10-13T20:30:00Z', photoUrls: ['https://storage.test/photo?alt=media&token=abc'], coordinates: null, recipientName: 'Mme Réception', merchandiseGoodCondition: false, reservesNote: '2 boîtes écrasées <test>', destination: { ...info, postalCode: '97400', floor: 2, timeWindowStart: '08:00', timeWindowEnd: '10:00' } };
const pkg = (id: string, patch: Partial<Package> = {}): Package => ({ id, ...info, externalId: id, postalCode: '97400', zone: Zone.NORD, clientId: 'c', clientName: 'Client', importBatchId: 'batch', status: PackageStatus.DELIVERED,
  createdAt: '2026-10-13T20:30:00Z', updatedAt: proof.timestamp, movements: [], serviceTime: 5, timeWindowStart: '08:00', timeWindowEnd: '10:00', ...patch });
it('renders and prints the same reserves, real references, historical address and Reunion time', () => {
  const screen = renderToStaticMarkup(<PODViewer pod={proof} packageInfo={info} showDriverInfo={false} onClose={() => {}} />);
  const print = buildProofPrintHTML(presentProof(proof, info, false));
  for (const html of [screen, print]) {
    for (const text of ['BR-00001', 'ORDER-42', 'CLIENT-42', '2 boîtes écrasées &lt;test&gt;', '14/10/2026 00:30', 'Adresse lors de la tentative', '08:00 – 10:00']) expect(html).toContain(text);
    expect(html).not.toContain('firestore-id'); expect(html).not.toContain('Conducteur'); expect(html).toContain('alt=media&amp;token=abc'); expect(html).not.toContain('&amp;amp;');
  }
  expect(print).toContain('document.images'); expect(print).toContain('Une image de preuve ne peut pas être chargée');
});
it('never assigns the first parcel proof to the remaining cartons on a delivery note', () => {
  const html = buildDeliveryNoteHTML([pkg('BR-ONE', { pod: { ...proof, packageId: 'BR-ONE' } }), pkg('EXP-TWO', { status: PackageStatus.PENDING, comment: 'Sonner au portail' })], {});
  expect(html.match(/Mme Réception/g)).toHaveLength(1);
  expect(html).toContain('Colis BR-ONE — preuves propres à ce colis'); expect(html).toContain('Colis EXP-TWO — preuves propres à ce colis');
  expect(html).toContain('Aucune preuve de remise enregistrée pour ce colis.'); expect(html).toContain('2 boîtes écrasées &lt;test&gt;'); expect(html).toContain('Sonner au portail');
  expect(html).not.toContain('atteste la remise des colis listés'); expect(html).not.toContain('checked');
});
it('preserves the GPS map action in the viewer and print while rejecting invalid coordinates', () => {
  const located = { ...proof, coordinates: { lat: -21.1, lng: 55.5 } };
  for (const html of [renderToStaticMarkup(<PODViewer pod={located} packageInfo={info} onClose={() => {}} />), buildProofPrintHTML(presentProof(located, info))]) {
    expect(html).toContain('https://www.google.com/maps?q=-21.1,55.5'); expect(html).toContain('Voir sur la carte');
  }
  expect(presentProof({ ...proof, coordinates: { lat: Number.NaN, lng: 55.5 } }, info).facts.find(f => f.label === 'Position GPS')?.href).toBeUndefined();
});
it('includes the entire recipient/Reunion-day group, preserving different visit constraints', () => {
  const first = pkg('first');
  const all = [first, pkg('same'), pkg('other-name', { contactName: 'Autre pharmacie' }), pkg('other-floor', { floor: 2 }), pkg('other-day', { createdAt: '2026-10-13T19:59:00Z' }), pkg('other-time', { timeWindowStart: '14:00', timeWindowEnd: '16:00', createdAt: '2026-10-14T06:00:00Z' }), pkg('other-date', { requestedDeliveryDate: '2026-10-16', requestedDeliveryTime: '10:30' })];
  const group = packagesAtSamePoint(first, all);
  expect(group.map(p => p.id)).toEqual(['first', 'same', 'other-time', 'other-date']);
  expect(group.map(p => p.id).sort()).toEqual(clientParcelGroups(all, 'all').find(g => g.packages.some(p => p.id === first.id))!.packages.map(p => p.id).sort());
  const html = buildDeliveryNoteHTML(group, {});
  expect(html).toContain('14:00 – 16:00'); expect(html).toContain('Date demandée : 2026-10-16 à 10:30 (La Réunion)');
  expect(packagesAtSamePoint(pkg('missing', { postalCode: '' }), [pkg('also-missing', { postalCode: '' })]).map(p => p.id)).toEqual(['missing']);
});
it('labels the final sender return without renaming an older hub return, and explains a pending proof', () => {
  const at = '2026-10-14T05:00:00Z';
  const html = renderToStaticMarkup(<PackageTimeline movements={[{ action: 'RETURNED', timestamp: '2026-10-10T05:00:00Z' }, { action: 'RETURNED', timestamp: at }]}
    returnDisposition="SENDER_RETURNED" returnDecision={{ decision: 'SENDER_RETURNED', at, by: 'bureau' }} proofPending />);
  expect(html.match(/Retourné au centre/g)).toHaveLength(1); expect(html.match(/Retourné à l’expéditeur/g)).toHaveLength(1);
  expect(html).toContain('preuve en cours de transmission');
});
