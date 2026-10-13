import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import '/src/index.css';
import ImportReadiness from '/src/components/ImportReadiness.tsx';import CarrierBarcodeModal from '/src/components/CarrierBarcodeModal.tsx';
import ErrorLogsPanel from '/src/components/ErrorLogsPanel.tsx';import ClaimScanModal from '/src/components/ClaimScanModal.tsx';
window.calls=[];window.associations=[];
const packages=[{id:'p1',externalId:'BR1986',clientName:'Boiron fictif',contactName:'Destinataire fictif',status:'En attente',clientReference:'14085834'},{id:'p2',externalId:'BR1987',clientName:'Boiron fictif',contactName:'Destinataire fictif',status:'En attente',clientReference:'14085834',carrierBarcode:'0014085834301322930202'}];
function App(){const [code,setCode]=useState(null);return <main className="p-3 max-w-5xl mx-auto"><p>Données fictives — aucun accès à la production</p>{location.search.includes('claim')?<ClaimScanModal currentUser={{id:'driver',role:'Chauffeur'}} clients={[{id:'client',role:'Client',companyName:'Boiron fictif'}]} onClose={()=>{}} onDone={()=>{}}/>:location.search.includes('journal')?<ErrorLogsPanel/>:<><ImportReadiness packages={packages} onAssociate={setCode}/>{code!==null&&<CarrierBarcodeModal initialBr={code} onClose={()=>setCode(null)}/>}</>}</main>}
createRoot(document.getElementById('root')).render(<App/>);`;
const mocks = {
  'firebase/firestore': `export const collection=(_db,name)=>({name});export const orderBy=()=>({});export const limit=()=>({});export const query=(ref)=>ref;
  export const onSnapshot=(ref,callback)=>{const rows=ref.name==='import_runs'?[{id:'run',clientName:'Boiron fictif',fileName:'colis.xlsx',status:'Incomplet',expectedCount:3,confirmedCount:2,rejectedRows:1,pendingReferences:['BR1999\\t1']}]:[
  {id:'bad',action:'PACKAGE_SCANNED',userId:'driver',userName:'Chauffeur fictif',targetName:'BR1986',outcome:'failure',description:'BR1986 — Code non retrouvé. Vérifiez son import.',createdAt:'2026-10-13T10:00:00Z',details:{metadata:{scan:'not_found',requestId:'request-fictif'}}},
  {id:'ok',action:'PACKAGE_SCANNED',userId:'driver',userName:'Chauffeur fictif',targetName:'BR1986',outcome:'success',description:'Colis vérifié',createdAt:'2026-10-13T10:05:00Z'}];const timer=setTimeout(()=>callback({docs:rows.map(row=>({id:row.id,data:()=>row}))}),20);return()=>clearTimeout(timer)};`,
  'firebase/functions': `export const getFunctions=()=>({});export const httpsCallable=(_f,name)=>async data=>{window.calls.push({name,data});return{data:{success:true}}};`,
  'firebaseConfig': 'export default {};export const db={};',
  'services/logService': `export const subscribeToErrorLogs=(cb)=>{cb([]);return()=>{}};export const getLocalErrorLogs=()=>[];export const reportError=()=>{};`,
  'services/missionService': `export const findPackageByCode=async code=>({id:'p1',externalId:code,clientReference:'14085834',contactName:'Destinataire fictif',city:'Saint-Denis'});export const createAndClaimPackage=async data=>{window.calls.push({name:'create',data});return{missionId:'tour'}};`,
  'services/scanService': `export const scanPackage=async input=>({accepted:false,outcome:'not_found',packageCode:input.code,message:'Code non retrouvé. Faites vérifier son import par le bureau.'});export const scanReceiptLabel=r=>r.packageCode+' — '+r.message;`,
  'services/activityLogService': 'export const logActivity=async()=>{};',
};
const plugin={name:'scan-reliability-fixture',enforce:'pre',resolveId(id){if(id==='/__scan-reliability.tsx')return id;const key=Object.keys(mocks).find(key=>id===key||id.includes(key));if(key)return '\0fixture-'+key;},load(id){if(id==='/__scan-reliability.tsx')return entry;if(id.startsWith('\0fixture-'))return mocks[id.slice(9)];},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/', '<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/__scan-reliability.tsx"></script></body></html>'));});}};
const server=await createServer({root,plugins:[plugin],cacheDir:'/private/tmp/fleet-scan-import-vite',server:{host:'127.0.0.1',port:5251,strictPort:true}});await server.listen();console.log('Fixture http://127.0.0.1:5251');
