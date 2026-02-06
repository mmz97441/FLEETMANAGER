
import { GoogleGenAI } from "@google/genai";
import { Vehicle, User, FuelLog, MaintenanceLog } from '../types';

// NOTE: process.env.API_KEY is populated via vite.config.ts define for Vercel deployment compatibility
// In Vercel Project Settings, add env var: VITE_GEMINI_API_KEY
const apiKey = process.env.API_KEY;

let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
} else {
  // Gemini API Key is missing - AI features will be disabled
}

export const askFleetGenius = async (
  userPrompt: string, 
  context: { 
    vehicles: Vehicle[], 
    users: User[], 
    logs: FuelLog[], 
    maintenanceLogs: MaintenanceLog[] 
  }
): Promise<string> => {
  if (!ai) {
    return "Le service d'intelligence artificielle n'est pas configuré (Clé API manquante).";
  }

  try {
    const { vehicles, users, logs, maintenanceLogs } = context;

    const SYSTEM_INSTRUCTION = `
You are FleetGenius, an expert AI transport logistics assistant.
Your goal is to help the CEO make decisions to optimize costs, improve safety, and manage maintenance.

Data Context:
- Vehicles: ${JSON.stringify(vehicles.map(v => ({ id: v.plate, model: v.model, status: v.status, km: v.currentMileage })))}
- Recent Fuel Logs (Last 10): ${JSON.stringify(logs.slice(0, 10))}
- Recent Maintenance (Last 5): ${JSON.stringify(maintenanceLogs.slice(0, 5))}
- Users count: ${users.length}

Rules:
1. Be concise, professional, and actionable.
2. If asked about "problems", check vehicles with status 'ISSUE' or 'MAINTENANCE'.
3. Use Markdown formatting.
4. Reply in French.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: userPrompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      }
    });

    return response.text || "Désolé, je n'ai pas pu analyser les données pour le moment.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Une erreur de connexion avec le module IA est survenue. Veuillez réessayer plus tard.";
  }
};
