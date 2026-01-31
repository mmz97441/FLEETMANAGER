/**
 * UTILITAIRES DE VALIDATION - FleetGenius
 * 
 * Ce fichier centralise toutes les validations pour éviter les erreurs de saisie.
 * Chaque fonction retourne { valid: boolean, error?: string, formatted?: string }
 */

// === TYPES ===
export interface ValidationResult {
  valid: boolean;
  error?: string;
  formatted?: string;  // Valeur corrigée/formatée
  warning?: string;    // Avertissement (non bloquant)
}

// === IMMATRICULATION ===
/**
 * Valide et formate une plaque d'immatriculation française
 * Format attendu: AA-123-AA ou AA123AA
 */
export const validatePlate = (plate: string): ValidationResult => {
  if (!plate || plate.trim().length === 0) {
    return { valid: false, error: "L'immatriculation est obligatoire" };
  }
  
  // Nettoyer: majuscules, supprimer espaces
  let cleaned = plate.toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
  
  // Format nouveau (AB-123-CD) ou ancien (1234 AB 75)
  const newFormat = /^[A-Z]{2}\d{3}[A-Z]{2}$/;
  const oldFormat = /^\d{1,4}[A-Z]{2,3}\d{2}$/;
  
  if (newFormat.test(cleaned)) {
    // Formater avec tirets
    const formatted = `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)}-${cleaned.slice(5)}`;
    return { valid: true, formatted };
  }
  
  if (oldFormat.test(cleaned)) {
    return { valid: true, formatted: cleaned };
  }
  
  // Format DOM-TOM ou spécial
  if (cleaned.length >= 5 && cleaned.length <= 10) {
    return { valid: true, formatted: cleaned, warning: "Format non standard" };
  }
  
  return { 
    valid: false, 
    error: "Format invalide. Ex: AB-123-CD ou AB123CD" 
  };
};

// === EMAIL ===
/**
 * Valide un email professionnel
 */
export const validateEmail = (email: string): ValidationResult => {
  if (!email || email.trim().length === 0) {
    return { valid: false, error: "L'email est obligatoire" };
  }
  
  const cleaned = email.toLowerCase().trim();
  
  // Regex email basique mais robuste
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  
  if (!emailRegex.test(cleaned)) {
    return { valid: false, error: "Format email invalide" };
  }
  
  // Vérifier les domaines jetables courants
  const disposableDomains = ['yopmail.com', 'tempmail.com', 'guerrillamail.com', 'mailinator.com'];
  const domain = cleaned.split('@')[1];
  
  if (disposableDomains.includes(domain)) {
    return { valid: false, error: "Les emails temporaires ne sont pas autorisés" };
  }
  
  return { valid: true, formatted: cleaned };
};

// === TÉLÉPHONE ===
/**
 * Valide et formate un numéro de téléphone français
 */
export const validatePhone = (phone: string): ValidationResult => {
  if (!phone || phone.trim().length === 0) {
    return { valid: true }; // Optionnel
  }
  
  // Nettoyer: garder que les chiffres et le +
  let cleaned = phone.replace(/[\s.-]/g, '');
  
  // Convertir 0033 en +33
  if (cleaned.startsWith('0033')) {
    cleaned = '+33' + cleaned.slice(4);
  }
  
  // Convertir 06... en +336...
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '+33' + cleaned.slice(1);
  }
  
  // Vérifier format français
  const frenchRegex = /^\+33[1-9]\d{8}$/;
  const frenchMobileRegex = /^\+33[67]\d{8}$/;
  
  if (frenchRegex.test(cleaned)) {
    // Formater: +33 6 12 34 56 78
    const formatted = cleaned.replace(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '+33 $1 $2 $3 $4 $5');
    const isMobile = frenchMobileRegex.test(cleaned);
    return { 
      valid: true, 
      formatted,
      warning: !isMobile ? "Ce n'est pas un numéro mobile" : undefined
    };
  }
  
  // Accepter format international
  if (/^\+\d{10,15}$/.test(cleaned)) {
    return { valid: true, formatted: cleaned };
  }
  
  return { 
    valid: false, 
    error: "Format invalide. Ex: 06 12 34 56 78 ou +33 6 12 34 56 78" 
  };
};

// === NOM / PRÉNOM ===
/**
 * Valide et formate un nom ou prénom
 */
export const validateName = (name: string, field: 'prénom' | 'nom' = 'nom'): ValidationResult => {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: `Le ${field} est obligatoire` };
  }
  
  const cleaned = name.trim();
  
  // Min 2 caractères
  if (cleaned.length < 2) {
    return { valid: false, error: `Le ${field} doit contenir au moins 2 caractères` };
  }
  
  // Pas de chiffres
  if (/\d/.test(cleaned)) {
    return { valid: false, error: `Le ${field} ne peut pas contenir de chiffres` };
  }
  
  // Caractères autorisés: lettres, tirets, apostrophes, espaces
  if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(cleaned)) {
    return { valid: false, error: `Le ${field} contient des caractères non autorisés` };
  }
  
  // Formater: Première lettre majuscule
  const formatted = cleaned
    .toLowerCase()
    .split(/[\s-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(cleaned.includes('-') ? '-' : ' ');
  
  return { valid: true, formatted };
};

// === KILOMÉTRAGE ===
/**
 * Valide un kilométrage avec comparaison au dernier relevé
 */
export const validateMileage = (
  mileage: string | number, 
  lastMileage?: number | null,
  maxDifference: number = 1500
): ValidationResult => {
  const value = typeof mileage === 'string' ? Number(mileage) : mileage;
  
  if (isNaN(value) || value < 0) {
    return { valid: false, error: "Le kilométrage doit être un nombre positif" };
  }
  
  // Limite absolue
  if (value > 2000000) {
    return { valid: false, error: "Kilométrage impossible (max 2 000 000 km)" };
  }
  
  // Vérification si on a un relevé précédent
  if (lastMileage !== null && lastMileage !== undefined) {
    if (value < lastMileage) {
      return { 
        valid: false, 
        error: `Le km ne peut pas être inférieur au dernier relevé (${lastMileage.toLocaleString()} km)` 
      };
    }
    
    const diff = value - lastMileage;
    
    if (diff > maxDifference) {
      return { 
        valid: false, 
        error: `Écart trop important: +${diff.toLocaleString()} km (max ${maxDifference.toLocaleString()} km)` 
      };
    }
    
    // Warning si proche de la limite
    if (diff > maxDifference * 0.8) {
      return { 
        valid: true, 
        formatted: value.toString(),
        warning: `Écart élevé: +${diff.toLocaleString()} km` 
      };
    }
  }
  
  return { valid: true, formatted: value.toString() };
};

// === MONTANT / PRIX ===
/**
 * Valide un montant en euros
 */
export const validateAmount = (amount: string | number, min: number = 0, max?: number): ValidationResult => {
  const value = typeof amount === 'string' ? parseFloat(amount.replace(',', '.')) : amount;
  
  if (isNaN(value)) {
    return { valid: false, error: "Montant invalide" };
  }
  
  if (value < min) {
    return { valid: false, error: `Le montant minimum est ${min}€` };
  }
  
  if (max !== undefined && value > max) {
    return { valid: false, error: `Le montant maximum est ${max}€` };
  }
  
  // Formater à 2 décimales
  const formatted = value.toFixed(2);
  
  return { valid: true, formatted };
};

// === VOLUME (Litres) ===
/**
 * Valide un volume de carburant
 */
export const validateVolume = (volume: string | number): ValidationResult => {
  const value = typeof volume === 'string' ? parseFloat(volume.replace(',', '.')) : volume;
  
  if (isNaN(value) || value <= 0) {
    return { valid: false, error: "Le volume doit être supérieur à 0" };
  }
  
  // Réservoir max ~1000L pour les plus gros camions
  if (value > 1000) {
    return { valid: false, error: "Volume trop élevé (max 1000L)" };
  }
  
  // Warning si volume élevé
  if (value > 500) {
    return { 
      valid: true, 
      formatted: value.toFixed(2),
      warning: "Volume élevé, vérifiez la saisie" 
    };
  }
  
  return { valid: true, formatted: value.toFixed(2) };
};

// === DATE ===
/**
 * Valide une date (pas dans le futur pour les relevés)
 */
export const validateDate = (date: string, allowFuture: boolean = false): ValidationResult => {
  if (!date) {
    return { valid: false, error: "La date est obligatoire" };
  }
  
  const parsed = new Date(date);
  
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: "Date invalide" };
  }
  
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  
  if (!allowFuture && parsed > today) {
    return { valid: false, error: "La date ne peut pas être dans le futur" };
  }
  
  // Pas trop ancien (5 ans max)
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  
  if (parsed < fiveYearsAgo) {
    return { valid: false, error: "La date est trop ancienne" };
  }
  
  return { valid: true, formatted: date };
};

// === SIRET ===
/**
 * Valide un numéro SIRET (14 chiffres)
 */
export const validateSiret = (siret: string): ValidationResult => {
  if (!siret || siret.trim().length === 0) {
    return { valid: true }; // Optionnel
  }
  
  const cleaned = siret.replace(/[\s.-]/g, '');
  
  if (!/^\d{14}$/.test(cleaned)) {
    return { valid: false, error: "Le SIRET doit contenir 14 chiffres" };
  }
  
  // Vérification Luhn (algorithme de contrôle)
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = parseInt(cleaned[i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  
  if (sum % 10 !== 0) {
    return { valid: false, error: "Numéro SIRET invalide (erreur de contrôle)" };
  }
  
  // Formater: 123 456 789 00012
  const formatted = `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  
  return { valid: true, formatted };
};

// === VIN (Numéro de châssis) ===
/**
 * Valide un numéro VIN (17 caractères)
 */
export const validateVIN = (vin: string): ValidationResult => {
  if (!vin || vin.trim().length === 0) {
    return { valid: true }; // Optionnel
  }
  
  const cleaned = vin.toUpperCase().replace(/[\s-]/g, '');
  
  if (cleaned.length !== 17) {
    return { valid: false, error: "Le VIN doit contenir exactement 17 caractères" };
  }
  
  // Pas de I, O, Q (confusion avec 1, 0)
  if (/[IOQ]/.test(cleaned)) {
    return { valid: false, error: "Le VIN ne peut pas contenir I, O ou Q" };
  }
  
  // Que des lettres et chiffres
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleaned)) {
    return { valid: false, error: "Caractères non autorisés dans le VIN" };
  }
  
  return { valid: true, formatted: cleaned };
};

// === HELPERS D'AFFICHAGE ===

/**
 * Formate un nombre en format français (espaces comme séparateurs)
 */
export const formatNumber = (num: number): string => {
  return num.toLocaleString('fr-FR');
};

/**
 * Formate un montant en euros
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
};

/**
 * Formate une date en français
 */
export const formatDate = (date: string | Date): string => {
  return new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

/**
 * Formate une date avec heure
 */
export const formatDateTime = (date: string | Date): string => {
  return new Date(date).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
