import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
/**
 * DELIVERY SERVICE
 * 
 * Gestion des créneaux de livraison et conversion devis → colis/mission.
 * 
 * Workflow : Client demande course → Dispatch envoie devis → Client accepte
 *          → Colis créé automatiquement → Intégré au prochain dispatch
 */

import {
  QuoteRequest, QuoteStatus, Package, PackageStatus, PackageMovement,
  Zone, DeliveryTimeSlot, DeliveryScheduleConfig, User
} from '../types';
import { todayISO } from '../utils/date';
import {
  getZoneFromPostalCode,
  extractPostalCodeFromAddress,
  addPackage,
  getHubByZone
} from './missionService';
// @ts-ignore
import { doc, getDoc, setDoc, collection, onSnapshot } from 'firebase/firestore';
// @ts-ignore
import { db } from '../firebaseConfig';

const SCHEDULE_DOC = 'delivery_schedule_config';
const SETTINGS_COLLECTION = 'settings';

// ============================================================================
// CRÉNEAUX PAR DÉFAUT (La Réunion)
// ============================================================================

export const DEFAULT_DELIVERY_SLOTS: DeliveryTimeSlot[] = [
  {
    id: 'slot-matin',
    label: 'Matin',
    start: '07:00',
    end: '12:00',
    zones: [Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST],
    isActive: true,
    sortOrder: 1
  },
  {
    id: 'slot-aprem',
    label: 'Après-midi',
    start: '13:00',
    end: '17:00',
    zones: [Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST],
    isActive: true,
    sortOrder: 2
  },
  {
    id: 'slot-express-matin',
    label: 'Express matin (avant 10h)',
    start: '07:00',
    end: '10:00',
    zones: [Zone.NORD, Zone.OUEST],
    isActive: true,
    sortOrder: 3
  },
  {
    id: 'slot-express-aprem',
    label: 'Express après-midi (avant 15h)',
    start: '13:00',
    end: '15:00',
    zones: [Zone.NORD, Zone.OUEST],
    isActive: true,
    sortOrder: 4
  }
];

export const DEFAULT_SCHEDULE_CONFIG: Omit<DeliveryScheduleConfig, 'id' | 'updatedAt' | 'updatedBy'> = {
  slots: DEFAULT_DELIVERY_SLOTS,
  cutoffHours: 2,
  sameDayEnabled: true,
  sameDayCutoff: '10:00',
  weekendEnabled: false,
  holidays: []
};

// ============================================================================
// GESTION CONFIGURATION CRÉNEAUX
// ============================================================================

/**
 * Charge la configuration des créneaux depuis Firestore
 */
export const getDeliveryScheduleConfig = async (): Promise<DeliveryScheduleConfig> => {
  try {
    const docRef = doc(db, SETTINGS_COLLECTION, SCHEDULE_DOC);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as DeliveryScheduleConfig;
    }
  } catch (e) {
    /* silenced */
  }

  // Retourner la config par défaut si pas encore configuré
  return {
    id: SCHEDULE_DOC,
    ...DEFAULT_SCHEDULE_CONFIG,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system'
  };
};

/**
 * Sauvegarde la configuration des créneaux
 */
export const saveDeliveryScheduleConfig = async (
  config: DeliveryScheduleConfig,
  updatedBy: string
): Promise<void> => {
  const docRef = doc(db, SETTINGS_COLLECTION, SCHEDULE_DOC);
  await setDoc(docRef, {
    ...config,
    updatedAt: new Date().toISOString(),
    updatedBy
  });
};

/**
 * S'abonner aux changements de configuration
 */
export const subscribeToScheduleConfig = (
  callback: (config: DeliveryScheduleConfig) => void
) => {
  const docRef = doc(db, SETTINGS_COLLECTION, SCHEDULE_DOC);
  return onSnapshot(docRef, (docSnap: any) => {
    if (docSnap.exists()) {
      callback({ id: docSnap.id, ...docSnap.data() } as DeliveryScheduleConfig);
    } else {
      callback({
        id: SCHEDULE_DOC,
        ...DEFAULT_SCHEDULE_CONFIG,
        updatedAt: new Date().toISOString(),
        updatedBy: 'system'
      });
    }
  });
};

/**
 * Retourne les créneaux disponibles pour une zone et une date données
 */
export const getAvailableSlotsForZone = (
  config: DeliveryScheduleConfig,
  zone: Zone,
  date: string  // "YYYY-MM-DD"
): DeliveryTimeSlot[] => {
  const dateObj = new Date(date + 'T00:00:00');
  const dayOfWeek = dateObj.getDay(); // 0=dim, 6=sam

  // Weekend check
  if (!config.weekendEnabled && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return [];
  }

  // Holiday check
  if (config.holidays.includes(date)) {
    return [];
  }

  // Filtrer les créneaux actifs pour cette zone
  let slots = config.slots
    .filter(s => s.isActive && s.zones.includes(zone))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Si même jour, filtrer les créneaux passés (cutoff)
  const today = todayISO();
  if (date === today) {
    if (!config.sameDayEnabled) return [];

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const cutoffMinutes = config.cutoffHours * 60;

    // Créneau dispo si l'heure de début - cutoff > maintenant
    slots = slots.filter(s => {
      const [h, m] = s.start.split(':').map(Number);
      return (h * 60 + m - cutoffMinutes) > nowMinutes;
    });

    // Cutoff jour même
    if (config.sameDayCutoff) {
      const [cutH, cutM] = config.sameDayCutoff.split(':').map(Number);
      if (nowMinutes > cutH * 60 + cutM) return [];
    }
  }

  return slots;
};

// ============================================================================
// CONVERSION DEVIS → COLIS
// ============================================================================

/**
 * Convertit un devis accepté en colis prêt pour dispatch.
 * Appelé automatiquement quand QuoteStatus passe à ACCEPTED.
 * 
 * Retourne l'ID du colis créé, ou null si échec.
 */
export const convertQuoteToPackage = async (
  quote: QuoteRequest,
  convertedBy: User
): Promise<{ packageId: string; zone: Zone } | null> => {
  const call = httpsCallable<{quoteId: string}, {packageId: string; zone: Zone}>(getFunctions(app, 'europe-west1'), 'acceptQuote');
  return (await call({quoteId: quote.id})).data;
};

/**
 * Vérifie si une adresse de destination est dans une zone connue
 * (utile pour afficher la zone estimée au client dans le formulaire)
 */
export const estimateZoneFromAddress = async (
  address: string
): Promise<{ zone: Zone; postalCode: string } | null> => {
  const postalCode = extractPostalCodeFromAddress(address);
  if (!postalCode) return null;

  const zone = await getZoneFromPostalCode(postalCode);
  if (!zone) return null;

  return { zone, postalCode };
};
