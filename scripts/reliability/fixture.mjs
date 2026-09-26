import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import '/src/index.css';
import {resilientLazy} from '/src/components/ResilientPage.tsx';import CarrierBarcodeModal from '/src/components/CarrierBarcodeModal.tsx';
import StorageRecoveryNotice from '/src/components/StorageRecoveryNotice.tsx';import {noteStorageFailure} from '/src/utils/storageRecovery.ts';
import ConfirmationHost from '/src/components/ConfirmationHost.tsx';import ActivateAccount from '/src/components/ActivateAccount.tsx';
import ImportShipmentsModal from '/src/components/ImportShipmentsModal.tsx';
window.calls=[];window.logged=[];window.loadMode='fail';window.rejectAssociation=false;
window.failStorage=()=>noteStorageFailure(new Error("Attempt to iterate a cursor that doesn't exist"));
const Page=resilientLazy(async()=>{if(window.loadMode==='fail')throw new TypeError('Failed to fetch dynamically imported module: synthetic');return{default:()=> <p>Mission fictive chargée</p>}});
function Fixture(){const[mode,setMode]=useState(new URLSearchParams(location.search).get('case')||'page');return <><nav>Navigation conservée</nav><input aria-label="Brouillon conservé" defaultValue="Saisie en cours"/>{mode==='page'?<Page/>:mode==='carrier'?<CarrierBarcodeModal onClose={()=>setMode('closed')}/>:mode==='activate'?<ActivateAccount token="synthetic"/>:mode==='import'?<ImportShipmentsModal currentUser={{id:'client-test',role:'Client',companyName:'Fictif'}} onClose={()=>setMode('closed')} onImported={()=>{}}/>:null}<StorageRecoveryNotice/><ConfirmationHost/></>}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`;
const mocks = {
  'firebase/functions': `export const getFunctions=()=>({});export const httpsCallable=(_f,name)=>async data=>{window.calls.push({name,data});if(window.rejectAssociation){window.rejectAssociation=false;throw new Error('Confirmation trop longue. Réessayez.')}return{data:{success:true}}};`,
  'firebaseConfig': 'export default {};export const db={};export const auth={currentUser:null};',
  'services/logService': 'export const reportError=(context,error)=>window.logged.push({context,message:String(error)});',
  'services/missionService': `export const findPackageByCode=async code=>({id:'parcel-test',externalId:code,clientReference:'12345678',contactName:'Pharmacie fictive',city:'Ville fictive'});export const createClientShipmentsBatch=async()=>[];export const getPackagesByIds=async()=>[];`,
  'services/cloudFunctions': `export const validateInvitationTokenCF=async()=>({valid:true,invitation:{email:'test@example.invalid',firstName:'Fictif',expiresAt:'2026-10-01'}});export const activateAccountCF=async()=>({success:false,errorCode:'functions/already-exists',message:'Compte existant'});`,
  'services/deliveryService':'export const estimateZoneFromAddress=async()=>null;',
  'services/pickupService':'export const generateBatchLabelsHTML=()=>"";',
  'client/ClientAccessContext':`export const useClientAccess=()=>({readOnly:false,runMutation:async(_label,fn)=>fn()});`,
};
const plugin={name:'reliability-fixture',enforce:'pre',resolveId(id){if(id==='/__reliability.tsx')return id;const match=Object.keys(mocks).find(key=>id===key||id.includes(key));if(match)return '\0fixture-'+match;},load(id){if(id==='/__reliability.tsx')return entry;if(id.startsWith('\0fixture-'))return mocks[id.slice(9)];},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/', '<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/__reliability.tsx"></script></body></html>'));});}};
const server=await createServer({root,plugins:[plugin],cacheDir:'/private/tmp/fleet-reliability-vite',server:{host:'127.0.0.1',port:5250,strictPort:true}});await server.listen();console.log('Fixture fictive http://127.0.0.1:5250');
