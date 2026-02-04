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
    console.warn('Erreur lecture config créneaux:', e);
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
  const today = new Date().toISOString().split('T')[0];
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
  try {
    // Extraire le code postal de l'adresse de destination
    const destAddress = quote.destinationAddress || quote.destination;
    const postalCode = extractPostalCodeFromAddress(destAddress);

    if (!postalCode) {
      console.error(`[convertQuoteToPackage] Code postal non trouvé dans: ${destAddress}`);
      return null;
    }

    // Détecter la zone
    const zone = await getZoneFromPostalCode(postalCode);
    if (!zone) {
      console.error(`[convertQuoteToPackage] Zone non trouvée pour CP: ${postalCode}`);
      return null;
    }

    // Parsing adresse
    const addressParts = destAddress.split(',').map((p: string) => p.trim());
    const address = addressParts[0] || destAddress;
    const city = addressParts.length >= 3 ? addressParts[2] : addressParts[1] || '';

    // Créneau horaire
    const timeWindowStart = quote.deliveryTimeWindow?.start || undefined;
    const timeWindowEnd = quote.deliveryTimeWindow?.end || undefined;

    // Mouvement initial
    const initialMovement: PackageMovement = {
      timestamp: new Date().toISOString(),
      action: 'IMPORTED',
      driverId: convertedBy.id,
      driverName: `${convertedBy.firstName} ${convertedBy.lastName}`,
      notes: `Créé depuis devis accepté #${quote.id.slice(-6)}`
    };

    // Construire le colis
    const pkg: Omit<Package, 'id' | 'createdAt' | 'updatedAt'> = {
      clientId: quote.clientId,
      clientName: quote.clientName,
      importBatchId: `QUOTE-${quote.id}`,
      externalId: quote.id,
      orderNumber: `Q${quote.id.slice(-6)}`,
      barcode: `Q${quote.id.slice(-6)}`,
      address,
      city,
      postalCode,
      zone,
      contactName: quote.destinationContact?.name || quote.clientName,
      contactPhone: quote.destinationContact?.phone || undefined,
      timeWindowStart,
      timeWindowEnd,
      serviceTime: 10,  // 10 min par défaut pour course client
      comment: [
        quote.goodsDescription,
        quote.clientNotes ? `Note client: ${quote.clientNotes}` : '',
        quote.priceOffer ? `Devis: ${quote.priceOffer}€` : ''
      ].filter(Boolean).join(' | '),
      volume: quote.volume || undefined,
      weight: quote.weight || undefined,
      status: PackageStatus.PENDING,
      movements: [initialMovement]
    };

    // Créer en base
    const packageId = await addPackage(pkg);

    return { packageId, zone };
  } catch (err) {
    console.error('[convertQuoteToPackage] Erreur:', err);
    return null;
  }
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
