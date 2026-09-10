import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
import { Vehicle,User,FuelLog,MaintenanceLog } from '../types';
export const askFleetGenius=async(userPrompt:string,_context:{vehicles:Vehicle[];users:User[];logs:FuelLog[];maintenanceLogs:MaintenanceLog[]}):Promise<string>=>{
 try{const call=httpsCallable<{prompt:string},{text:string}>(getFunctions(app,'europe-west1'),'askFleetGenius');return (await call({prompt:userPrompt})).data.text;}
 catch(error){return error instanceof Error?error.message:'Le conseiller IA est indisponible.';}
};
