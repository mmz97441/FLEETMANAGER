import { pathToView } from '../routes';

const screens: Record<string, string> = {
  dashboard: 'Accueil', missions: 'Tournées et colis', driver_tour: 'Ma tournée',
  hub: 'Hub', vehicles: 'Véhicules', issues: 'Incidents', maintenance: 'Atelier',
  client_portal: 'Espace client', help: 'Aide', drivers: 'Chauffeurs', fuel: 'Carburant',
};

export interface SupportContext {
  version: string;
  screen: string;
  capturedAt: string;
  errorReference?: string;
}

let lastError: SupportContext | null = null;

const currentScreen = () => {
  if (typeof window === 'undefined') return 'Application';
  const key = pathToView(window.location.pathname);
  if (key.startsWith('client_')) return 'Espace client';
  return screens[key] || 'Application';
};

/** No message, query, identity or business data is retained. Memory is cleared on reload. */
export function recordSupportErrorReference(referenceId: string): void {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(referenceId)) return;
  lastError = { ...captureSupportContext(false), errorReference: referenceId };
}

export function captureSupportContext(includeLastError = true): SupportContext {
  if (includeLastError && lastError) return { ...lastError };
  return {
    version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'inconnue',
    screen: currentScreen(),
    capturedAt: new Date().toISOString(),
  };
}

export function formatSupportContext(context: SupportContext): string {
  return `Version : ${context.version}\nÉcran : ${context.screen}\nHeure : ${context.capturedAt}\nRéférence d’erreur : ${context.errorReference || 'aucune erreur référencée dans cette session'}`;
}

export function buildContextualSupportDraft(message: string, context?: SupportContext): string {
  return `${message.trim()}${context ? `\n\nContexte technique\n${formatSupportContext(context)}` : ''}`;
}

export const contextualSupportMailto = (subject: string, body: string) =>
  `mailto:direction@delivrex.io?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
