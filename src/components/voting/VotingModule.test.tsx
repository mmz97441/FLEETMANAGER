import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UserRole, type User } from '../../types';
import VotingModule from './VotingModule';

vi.mock('../../usePermissions', async () => ({
  ...await import('../../permissions'),
  usePermissions: () => ({ hasPermission: () => true, isLoading: false }),
}));
vi.mock('../../services/votingService', () => ({}));

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

it('renders at the application root without a React Router provider', () => {
  // App mounts its views directly and navigates with the browser History API.
  // Adding a Router here would hide a production integration regression.
  const user: User = {
    id: 'employee-fictif', firstName: 'Alice', lastName: 'Fictive',
    email: 'fictif@example.invalid', role: UserRole.DRIVER, leaveBalance: 0,
  };
  const html = renderToString(<React.StrictMode><VotingModule currentUser={user} /></React.StrictMode>);
  expect(html).toContain('Votes des salariés');
  expect(html).toContain('Chargement des scrutins');
});
