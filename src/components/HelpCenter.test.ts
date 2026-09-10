import { expect, it } from 'vitest';
import { buildSupportMailto } from './HelpCenter';

it('encodes the subject and full message without adding an unintended email recipient', () => {
  const subject = 'Retour & bcc=autre@example.invalid';
  const message = 'Colis égaré ?\nAdresse : 1 rue A & B #3';
  const link = new URL(buildSupportMailto(subject, message, 'Camille — test@example.invalid'));
  expect(link.protocol).toBe('mailto:');
  expect(link.pathname).toBe('direction@delivrex.io');
  expect(link.searchParams.get('subject')).toBe(subject);
  expect(link.searchParams.get('body')).toBe(`${message}\n\nCamille — test@example.invalid`);
  expect(link.searchParams.has('bcc')).toBe(false);
});
