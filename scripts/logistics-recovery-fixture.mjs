import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const entry = `import React from'react';import{createRoot}from'react-dom/client';import'/src/index.css';
import DriverMissionView from'/src/components/DriverMissionView.tsx';import ReturnHubModal from'/src/components/ReturnHubModal.tsx';import RecoveryPanel from'/src/components/RecoveryPanel.tsx';import PendingSyncBanner from'/src/components/PendingSyncBanner.tsx';
window.calls=[];window.listeners=[];window.offline=false;Object.defineProperty(navigator,'onLine',{get:()=>!window.offline,configurable:true});window.mode=new URLSearchParams(location.search).get('case')||'pickup';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Indian/Reunion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
window.user={id:'recovery-driver',firstName:'Chauffeur',lastName:'Fictif',role:'Chauffeur'};
window.parcels=[0,1].map(i=>({id:'pickup-'+i,externalId:'EXP-000'+i,barcode:'UNIQUE-'+i,status:'En attente',missionId:'pickup-tour',stopId:'pickup-stop',currentDriverId:window.user.id,contactName:'Pharmacie fictive',address:'1 rue Destination',postalCode:'97400',city:'Saint Denis',movements:[]}));
window.missions=[{id:'pickup-tour',driverId:window.user.id,status:'En cours',date:today,type:'Collecte',zone:'Nord',stops:[{id:'pickup-stop',type:'PICKUP',status:'Arrivé',sequence:1,contactName:'Expéditeur fictif',address:'2 rue Collecte',postalCode:'97400',city:'Saint Denis',packageIds:window.parcels.map(p=>p.id),packageCount:2}]}];
window.emit=()=>window.listeners.forEach(cb=>cb(structuredClone(window.missions)));
window.commit=async input=>{window.missions[0].stops=window.missions[0].stops.map(s=>s.id===input.stopId?{...s,...input.stopPatch}:s);window.emit();return{allDone:true,stops:window.missions[0].stops}};
window.scan=async input=>{const p=window.parcels.find(p=>[p.externalId,p.barcode].includes(input.code));return{accepted:!!p,outcome:p?'verified':'wrong_stop',packageId:p?.id,packageCode:input.code,contactName:p?.contactName,message:p?'Colis vérifié':'Mauvais colis',missionId:'pickup-tour',stopId:'pickup-stop',scannedAt:new Date().toISOString()}};
window.pickup=async input=>{window.calls.push({name:'finalizePickup',input});if(window.failNext){window.failNext=false;throw Error('Connexion interrompue')}await window.commit({stopId:'pickup-stop',stopPatch:{status:'Terminé'}});return{id:'pickup-tour_pickup-stop'}};
window.returned={...window.parcels[0],id:'returned',externalId:'EXP-RETOUR-0001',status:'Échec',returnReason:'Destinataire absent',missionId:'old-tour'};
window.recovery=[window.returned,{...window.returned,id:'legacy',status:'Retourné',missionId:null,currentDriverId:null},{...window.returned,id:'missing',status:'En attente',missionId:null,currentDriverId:null,pickupMissing:{missionId:'old',stopId:'pickup',driverId:window.user.id,recordedAt:'2026-10-01'}}];
function Fixture(){const [,render]=React.useReducer(v=>v+1,0);window.switchUser=id=>{window.user={...window.user,id};render()};window.switchMission=id=>{window.returned={...window.returned,missionId:id};render()};if(window.mode==='reset')return <p>Initialisation du test</p>;return <div className='p-3 max-w-lg mx-auto'><PendingSyncBanner userId={window.user.id}/>{window.mode==='return'?<ReturnHubModal pkg={window.returned} currentUser={window.user} onClose={()=>{document.getElementById('closed').textContent='Retour confirmé'}}/>:window.mode==='recovery'?<RecoveryPanel currentUser={{...window.user,role:'Admin'}} onReturn={()=>window.calls.push({name:'openReturn'})}/>:<DriverMissionView currentUser={window.user}/>}<div id='closed'/></div>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const custom = {
  subscribeToMissions: 'cb=>{window.listeners.push(cb);queueMicrotask(()=>cb(structuredClone(window.missions)));return()=>{window.listeners=window.listeners.filter(c=>c!==cb)}}',
  subscribeToPackages: 'cb=>{queueMicrotask(()=>cb([]));return()=>{}}',
  subscribeToRecoveryPackages: '(_u,cb)=>{queueMicrotask(()=>cb(window.mode===\'recovery\'?window.recovery:[]));return()=>{}}',
  subscribeToHubs: 'cb=>{queueMicrotask(()=>cb([{id:"hub-north",name:"Dépôt Nord",isActive:true},{id:"hub-south",name:"Dépôt Sud",isActive:true}]));return()=>{}}',
  subscribeToUsers: '(_u,cb)=>{queueMicrotask(()=>cb([window.user]));return()=>{}}',
  getPackagesByIds: 'async ids=>window.parcels.filter(p=>ids.includes(p.id))',
  commitStopOutcome: 'input=>window.commit(input)', getGoogleMapsApiKey: '()=>null', getCurrentPosition: 'async()=>({lat:-20.9,lng:55.5})',
  pendingDeliveries: 'async()=>[]', outboxChangeEvent: JSON.stringify('fixture-delivery-outbox'),
  finalizePickup: 'input=>window.pickup(input)', compressImage: 'async input=>{if(window.delayCompress){await new Promise(r=>window.releaseCompression=r)}return input}',
  uploadProofPhoto: 'async(input,id,kind)=>{window.calls.push({name:"upload",id,kind});return "https://example.invalid/"+kind}',
  reportError: '()=>{}', addIssueToFirestore: 'async input=>{window.calls.push({name:"issue",input});return "issue"}',
};
function mockService(file) {
  const source = readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), out = [];
  for (const node of ast.statements) {
    if (!node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isEnumDeclaration(node)) { out.push(ts.transpile(node.getText(ast), { module: ts.ModuleKind.ESNext })); continue; }
    const names = ts.isFunctionDeclaration(node) && node.name ? [node.name.text] : ts.isVariableStatement(node) ? node.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : [];
    for (const name of names) out.push('export const ' + name + '=' + (custom[name] || 'async()=>[]') + ';');
  }
  return out.join('\n') + '\nexport default {};';
}
const camera = `window.cameras=[];export const Html5QrcodeSupportedFormats={DATA_MATRIX:1,QR_CODE:2,CODE_128:3,CODE_39:4,EAN_13:5,PDF_417:6,AZTEC:7};export class Html5Qrcode{constructor(id){this.id=id;window.cameras.push(this)}async start(_c,_s,success){this.success=success;this.active=true;const video=document.createElement('video');const track=new EventTarget();track.readyState='live';track.stop=()=>{};Object.defineProperty(video,'readyState',{value:4});Object.defineProperty(video,'paused',{value:false});Object.defineProperty(video,'srcObject',{value:{getTracks:()=>[track],getVideoTracks:()=>[track]}});document.getElementById(this.id)?.append(video)}async stop(){this.active=false}clear(){document.getElementById(this.id)?.replaceChildren()}getRunningTrackCameraCapabilities(){return{torchFeature:()=>({isSupported:()=>false})}}}`;
const plugin = { name: 'logistics-recovery-fixture', enforce: 'pre',
  resolveId(id, importer) {
    if (id === '/__fixture.tsx') return id;
    if (id === 'html5-qrcode') return '\0camera';
    if (id === 'firebase/functions') return '\0functions';
    if (/firebaseConfig/.test(id)) return '\0config';
    if (id.includes('scanService')) return '\0scan';
    if (importer && !id.includes('fieldOperationsOutbox') && !id.includes('confirmationService')) {
      const path = id.startsWith('/src/') ? root + id : resolve(dirname(importer), id);
      if (path.includes('/src/services/')) return '\0service:' + path.replace(/\.ts$/, '') + '.ts';
    }
  },
  load(id) {
    if (id === '/__fixture.tsx') return entry;
    if (id === '\0camera') return camera;
    if (id === '\0config') return 'export default {};export const db={},storage={};export const auth={get currentUser(){return {uid:window.user.id}}};';
    if (id === '\0functions') return 'export const getFunctions=()=>({});export const httpsCallable=(_f,name)=>async input=>{window.calls.push({name,input});if(window.failNext){window.failNext=false;throw Error("Connexion interrompue")}return {data:{success:true,missionId:"new-collection"}}};';
    if (id === '\0scan') return 'export const scanPackage=input=>window.scan(input);export const rememberScanMission=()=>{};export const scanReceiptLabel=r=>r.message;';
    if (id.startsWith('\0service:')) return mockService(id.slice(9));
  },
  configureServer(server) { server.middlewares.use(async(req,res,next) => { if (req.url.split('?')[0] !== '/') return next(); res.setHeader('Content-Type','text/html'); res.end(await server.transformIndexHtml('/', '<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/__fixture.tsx"></script></body></html>')); }); },
};
const server = await createServer({ root, plugins: [plugin], cacheDir: '/private/tmp/fleet-logistics-recovery-vite', server: { host: '127.0.0.1', port: 5254, strictPort: true } });
await server.listen(); console.log('Recovery fixture http://127.0.0.1:5254');
