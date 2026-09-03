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

// Initialisation de Firebase
const app = initializeApp(firebaseConfig);

// Firestore avec CACHE LOCAL PERSISTANT (IndexedDB) : l'app fonctionne
// hors-ligne (scan, prise en charge, validation de livraison) et synchronise
// automatiquement au retour du réseau. Essentiel pour les chauffeurs en zone
// blanche (les hauts, Cilaos, Salazie…). Repli sur getFirestore si IndexedDB
// est indisponible (mode privé strict, très vieux navigateur).
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