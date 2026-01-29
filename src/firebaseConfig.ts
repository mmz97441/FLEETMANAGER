// @ts-ignore
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
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

// Export des services pour utilisation dans l'app
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

export default app;