import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = `
import React from 'react';import{createRoot}from'react-dom/client';import'/src/index.css';
import ToastHost from '/src/components/ToastHost.tsx';
import{subscribeToTeamDirectory}from'/src/services/teamDirectoryService.ts';
import{scanPackage}from'/src/services/scanService.ts';
import{reportError,notifyError,setLogUser}from'/src/services/logService.ts';
import{captureRuntimeDiagnostics}from'/src/utils/runtimeDiagnostics.ts';
window.logs=[];window.requests=[];window.received=[];window.testOnline=true;window.testVisible=true;
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.testOnline});
Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.testVisible?'visible':'hidden'});
window.call=(name,data)=>new Promise((resolve,reject)=>window.requests.push({name,data,resolve,reject}));
window.beginDirectory=()=>{window.stopDirectory?.();window.stopDirectory=subscribeToTeamDirectory({id:'driver-test',firstName:'Chauffeur',lastName:'Fictif',role:'Chauffeur'},users=>window.received.push(users));};
window.beginScan=()=>scanPackage({driverId:'driver-test',source:'driver-claim',code:'PRIVATE-PARCEL-CODE'});
window.opaque=()=>window.dispatchEvent(new ErrorEvent('error',{message:'Script error.',filename:'',lineno:0,colno:0,error:null}));
window.reportError=reportError;window.notifyError=notifyError;window.diagnostics=captureRuntimeDiagnostics;
setLogUser({id:'driver-test',firstName:'Chauffeur',lastName:'Fictif',role:'Chauffeur'});
createRoot(document.getElementById('root')).render(<main style={{padding:"280px 16px 16px",maxWidth:560,margin:"auto"}}><h1 className="font-bold text-lg">Validation des incidents mobiles</h1><p>Données fictives — aucun accès Firebase</p><label htmlFor="draft" className="block mt-4">Saisie en cours</label><input id="draft" className="ui-input w-full" defaultValue="DRAFT-PRIVATE-VALUE"/><button type="button" data-diagnostic-action="document.open" className="ui-button ui-button-primary mt-4">Ouvrir un document fictif</button><ToastHost/></main>);
`;
const mock = {
  name: 'mobile-fixture', enforce: 'pre',
  resolveId(id) {
    if (id.includes('firebaseConfig')) return '\0fixture-config';
    if (id === 'firebase/firestore') return '\0fixture-firestore';
    if (id === 'firebase/functions') return '\0fixture-functions';
    if (id === '/__mobile-entry.tsx') return id;
  },
  load(id) {
    if (id === '\0fixture-config') return 'export const db={};export default {};';
    if (id === '\0fixture-firestore') return 'export const collection=()=>({});export const addDoc=async(_ref,entry)=>{window.logs.push(JSON.parse(JSON.stringify(entry)));return{id:entry.referenceId};};export const query=()=>({});export const orderBy=()=>({});export const limit=()=>({});export const onSnapshot=()=>()=>{};';
    if (id === '\0fixture-functions') return 'export const getFunctions=()=>({});export const httpsCallable=(_functions,name)=>data=>window.call(name,data);';
    if (id === '/__mobile-entry.tsx') return entry;
  },
  configureServer(server) {
    server.middlewares.use(async (req,res,next) => {
      if (req.url.split('?')[0] !== '/') return next();
      res.setHeader('Content-Type','text/html');
      res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/__mobile-entry.tsx"></script></body></html>'));
    });
  },
};
const server = await createServer({ root, cacheDir:'/tmp/fleet-mobile-vite', server:{host:'127.0.0.1',port:5247,strictPort:true}, plugins:[mock] });
await server.listen();console.log('Mobile incident fixture http://127.0.0.1:5247');
