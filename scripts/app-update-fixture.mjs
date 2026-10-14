// Real update gate, shared monitor, draft storage and outboxes; synthetic network only.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const entry = `import React,{Suspense,useState}from'react';import{createRoot}from'react-dom/client';import'/src/index.css';
import AppUpdateGate from'/src/components/AppUpdateGate.tsx';import ReturnHubModal from'/src/components/ReturnHubModal.tsx';import UserConnectionStatus from'/src/components/UserConnectionStatus.tsx';
import{useAutoUpdate,getLatestAppUpdateState}from'/src/hooks/useAutoUpdate.ts';import{getUpdateSafetySnapshot}from'/src/services/updateSafety.ts';
import{saveFieldDraft,readFieldDraft,fieldOperations,submitFieldOperation}from'/src/services/fieldOperationsOutbox.ts';import{submitDelivery,pendingDeliveries}from'/src/services/deliveryOutbox.ts';
window.calls=[];window.offline=false;window.holdUpload=false;window.manifestFailure=false;
window.currentVersion={version:__APP_VERSION__,buildId:__BUILD_ID__};window.futureVersion={version:'4.99.0',buildId:'99999999999999999999'};
window.boots=Number(sessionStorage.getItem('fixture.boots')||0)+1;sessionStorage.setItem('fixture.boots',String(window.boots));
window.mode=new URLSearchParams(location.search).get('case')||'plain';
window.target=JSON.parse(sessionStorage.getItem('fixture.target')||'null')||(window.mode==='restore'?window.futureVersion:window.currentVersion);
window.setTarget=value=>{window.target=value;sessionStorage.setItem('fixture.target',JSON.stringify(value))};
Object.defineProperty(navigator,'onLine',{get:()=>!window.offline,configurable:true});
const originalFetch=window.fetch.bind(window);window.fetch=(url,options)=>{if(!String(url).startsWith('/version.json'))return originalFetch(url,options);window.calls.push({name:'manifest'});return window.offline||window.manifestFailure?Promise.reject(Error('offline fixture')):Promise.resolve(new Response(JSON.stringify(window.target),{status:200,headers:{'Content-Type':'application/json'}}))};
window.user={id:'update-fixture-driver',firstName:'Chauffeur',lastName:'Fictif',email:'fictif@example.invalid',role:'Chauffeur',leaveBalance:0};
window.parcel={id:'update-fixture-parcel',externalId:'EXP-RETOUR-001',contactName:'Pharmacie fictive',missionId:'update-fixture-tour',status:'Échec',failureReason:'Destinataire absent'};
window.draftKey='return/'+window.parcel.id+'/'+window.parcel.missionId;
window.upload=async(input,id,kind)=>{window.calls.push({name:'upload',input,id,kind});if(window.holdUpload)await new Promise(resolve=>window.releaseUpload=resolve);return'https://example.invalid/'+kind};
window.getDraft=()=>readFieldDraft(window.draftKey,window.user.id);window.getPending=()=>pendingDeliveries(window.user.id);window.getFieldPending=()=>fieldOperations(window.user.id);window.getSafety=getUpdateSafetySnapshot;window.getVersion=getLatestAppUpdateState;
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WJ0AAAAASUVORK5CYII=';
window.seedPending=async()=>{const timestamp=new Date().toISOString();window.offline=true;try{await submitDelivery({id:'update-proof',userId:window.user.id,kind:'success',createdAt:timestamp,action:{missionId:'proof-tour',stopId:'proof-stop',stopPatch:{status:'Terminé'}},proof:{missionId:'proof-tour',stopId:'proof-stop',packageIds:['proof-parcel'],photosBase64:[photo],signatureBase64:photo,timestamp}})}catch{}finally{window.offline=false}return window.getPending()};
window.startBackground=()=>{window.holdUpload=true;const timestamp=new Date().toISOString();window.background=submitFieldOperation({id:'background-return',userId:window.user.id,missionId:'background-mission',kind:'return',createdAt:timestamp,payload:{packageId:'background-parcel',expectedMissionId:'background-mission',requestId:'background-request',photosBase64:[photo],proof:{packageId:'background-parcel',hubId:'hub-fixture',photoUrls:[],timestamp}}});return true};
if(window.mode==='restore')await saveFieldDraft(window.draftKey,window.user.id,{photos:[photo],hubId:'hub-fixture',requestId:'restored-request'});
const LateReturn=React.lazy(()=>new Promise(resolve=>setTimeout(()=>resolve({default:ReturnHubModal}),250)));
function Fixture(){const update=useAutoUpdate();const[form,setForm]=useState(window.mode==='editing'||window.mode==='restore');window.checkUpdate=update.checkNow;window.showForm=()=>setForm(true);return <main className='p-4 max-w-3xl mx-auto'>
<h1 className='text-lg font-semibold'>Recette de mise à jour — données fictives</h1><AppUpdateGate mandatory={window.mode!=='office'} update={update}/>
<button id='underlying-action' className='ui-button ui-button-primary' onClick={()=>window.calls.push({name:'underlying-action'})}>Action du parcours</button>
<Suspense fallback={<p>Restauration de la saisie…</p>}>{form&&(window.mode==='restore'?<LateReturn pkg={window.parcel} currentUser={window.user} onClose={()=>setForm(false)}/>:<ReturnHubModal pkg={window.parcel} currentUser={window.user} onClose={()=>setForm(false)}/>)}</Suspense>
{window.mode==='office'&&<UserConnectionStatus user={{...window.user,appDevices:[{id:'old-phone',label:'Android',appVersion:'4.32.0',buildId:'123',lastSeenAt:new Date().toISOString()}]}}/>}
</main>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
const custom = {
  subscribeToHubs: 'cb=>{queueMicrotask(()=>cb([{id:"hub-fixture",name:"Dépôt fictif",isActive:true}]));return()=>{}}',
  compressImage: 'async input=>input', uploadProofPhoto: '(...args)=>window.upload(...args)',
  commitStopOutcome: 'async()=>({allDone:true,stops:[]})', uploadAndCreatePOD: 'async()=>({id:"proof"})', uploadFailurePOD: 'async()=>({id:"proof"})',
  reportError: '()=>{}',
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
const actual = new Set(['appUpdate', 'updateSafety', 'confirmationService', 'fieldOperationsOutbox', 'deliveryOutbox']);
const plugin = { name: 'app-update-fixture', enforce: 'pre',
  resolveId(id, importer) {
    if (id === '/__update.tsx') return id;
    if (id === 'firebase/functions') return '\0update-functions';
    if (/firebaseConfig/.test(id)) return '\0update-config';
    if (importer) {
      const path = id.startsWith('/src/') ? root + id : resolve(dirname(importer), id);
      if (path.includes('/src/services/') && !actual.has(path.split('/').pop().replace(/\.ts$/, ''))) return '\0update-service:' + path.replace(/\.ts$/, '') + '.ts';
    }
  },
  load(id) {
    if (id === '/__update.tsx') return entry;
    if (id === '\0update-config') return 'export default {};export const db={},storage={};export const auth={get currentUser(){return {uid:window.user.id}}};';
    if (id === '\0update-functions') return 'export const getFunctions=()=>({});export const httpsCallable=(_f,name)=>async input=>{window.calls.push({name,input});return{data:{success:true}}};';
    if (id.startsWith('\0update-service:')) return mockService(id.slice('\0update-service:'.length));
  },
  configureServer(server) { server.middlewares.use(async(req,res,next) => {
    if (req.url.split('?')[0] !== '/') return next(); res.setHeader('Content-Type','text/html');
    res.end(await server.transformIndexHtml('/', '<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/__update.tsx"></script></body></html>'));
  }); },
};
const server = await createServer({ root, plugins: [plugin], cacheDir: '/private/tmp/fleet-app-update-vite', server: { host: '127.0.0.1', port: 5258, strictPort: true } });
await server.listen(); console.log('App update fixture http://127.0.0.1:5258');
