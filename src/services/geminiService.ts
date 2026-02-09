
import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../firebaseConfig";
import { Vehicle, User, FuelLog, MaintenanceLog } from '../types';

// Cloud Function proxy (clé API côté serveur uniquement)
const functions = getFunctions(app, "europe-west1");

export const askFleetGenius = async (
  userPrompt: string,
  context: {
    vehicles: Vehicle[],
    users: User[],
    logs: FuelLog[],
    maintenanceLogs: MaintenanceLog[]
  }
): Promise<string> => {
  try {
    const { vehicles, users, logs, maintenanceLogs } = context;

    const askAI = httpsCallable<
      {
        userPrompt: string;
        vehiclesSummary: Array<{ id: string; model: string; status: string; km: number }>;
        fuelLogsSummary: FuelLog[];
        maintenanceLogsSummary: MaintenanceLog[];
        usersCount: number;
      },
      { text: string }
    >(functions, "askFleetGenius");

    const result = await askAI({
      userPrompt,
      vehiclesSummary: vehicles.map(v => ({
        id: v.plate,
        model: v.model,
        status: v.status,
        km: v.currentMileage,
      })),
      fuelLogsSummary: logs.slice(0, 10),
      maintenanceLogsSummary: maintenanceLogs.slice(0, 5),
      usersCount: users.length,
    });

    return result.data.text;
  } catch (error: any) {
    console.error("Gemini API Error:", error);

    if (error.code === "functions/permission-denied") {
      return "Vous n'avez pas les droits pour utiliser l'assistant IA.";
    }
    if (error.code === "functions/unauthenticated") {
      return "Vous devez être connecté pour utiliser l'assistant IA.";
    }
    if (error.code === "functions/failed-precondition") {
      return "Le service d'intelligence artificielle n'est pas configuré (Clé API manquante côté serveur).";
    }

    return "Une erreur de connexion avec le module IA est survenue. Veuillez réessayer plus tard.";
  }
};
