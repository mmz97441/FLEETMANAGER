import { expect, it } from 'vitest';
import { VehicleStatus } from '../types';
import { mapDbStatusToApp } from './vehicleStatus';

it.each(['Immobilisé', 'Hors service', 'Inactif'])('does not make %s available because it contains service or actif', value => {
  expect(mapDbStatusToApp(value)).toBe(VehicleStatus.IMMOBILIZED);
});
it.each([undefined, '', 'statut inconnu', 'indisponible'])('requires verification for unavailable or unrecognized status %s', value => {
  expect(mapDbStatusToApp(value)).toBe(VehicleStatus.ISSUE);
});
it.each([['En Service', VehicleStatus.ACTIVE], ['active', VehicleStatus.ACTIVE], ['Disponible', VehicleStatus.IDLE], ['En maintenance', VehicleStatus.MAINTENANCE]])('maps known status %s', (value, expected) => {
  expect(mapDbStatusToApp(value)).toBe(expected);
});
