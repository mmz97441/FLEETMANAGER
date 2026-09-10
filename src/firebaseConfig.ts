// @ts-ignore
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager
} from "firebase/firestore";
// @ts-ignore
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

// Use explicit any cast to avoid type errors if vite/client types are missing in the context
const env = (import.meta as any).env;

// Configuration sécurisée via Variables d'Environnement
// Ces variables doivent être définies dans .env (local) et dans Vercel (production)
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

for (const key of ['apiKey','authDomain','projectId','storageBucket','appId'] as const) {
  if (!firebaseConfig[key]) throw new Error(`Configuration Firebase manquante : ${key}. Vérifiez les variables du déploiement.`);
}

// Initialisation de Firebase
const app = initializeApp(firebaseConfig);

// Cache persistant pour les lectures déjà chargées. Les transactions exigent le
// réseau. Les validations de livraison et leurs médias ont une file IndexedDB
// dédiée (deliveryOutbox), rejouée explicitement au retour de la connexion.
//
// MONO-ONGLET (persistentSingleTabManager) et NON multi-onglets : le gestionnaire
// multi-onglets déclenche « FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state »
// sur Safari/iPhone (coordination inter-onglets via IndexedDB buggée sur WebKit) —
// observé en prod : un chauffeur en boucle de crash/reconnexion, incapable de
// travailler. Les livreurs utilisent un seul onglet mobile → aucun intérêt au
// multi-onglets. On garde tout le hors-ligne.
//
// experimentalAutoDetectLongPolling : bascule automatiquement sur le long-polling
// quand le canal temps-réel (WebChannel) ne passe pas (Safari mobile, proxys,
// réseaux capricieux) — autre cause fréquente de la même assertion.
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) }),
    experimentalAutoDetectLongPolling: true
  });
} catch (e) {
  console.warn("Persistance Firestore indisponible, mode en ligne uniquement:", e);
  _db = getFirestore(app);
}
export const db = _db;
export const auth = getAuth(app);
export const storage = getStorage(app);

export default app;