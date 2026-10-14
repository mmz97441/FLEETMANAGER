// Real DispatchManager with synthetic optimization and an idempotent lost-response server.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import'/src/index.css';import DispatchManager from'/src/components/DispatchManager.tsx';
window.calls=[];window.receipts=new Map();window.created=[];window.completed=0;window.optimizations=0;
const hub={id:'dispatch-hub',name:'Dépôt fictif',city:'Saint-Denis',zone:'Nord',isActive:true};
const driver={id:'dispatch-driver',firstName:'Chauffeur',lastName:'Fictif',role:'Chauffeur',zone:'Nord'};
const user={id:'dispatch-office',firstName:'Bureau',lastName:'Fictif',role:'President'};
window.parcels=[{id:'dispatch-parcel',externalId:'EXP-DISPATCH-0001',status:'Au hub',currentHubId:hub.id,zone:'Nord',contactName:'Pharmacie fictive',address:'1 rue Fictive',city:'Saint-Denis',postalCode:'97400',floor:0,serviceTime:5}];
const stop={id:'dispatch-stop',type:'DELIVERY',status:'En attente',sequence:1,packageIds:['dispatch-parcel'],packageCount:1,serviceTime:5,contactName:'Pharmacie fictive',address:'1 rue Fictive',city:'Saint-Denis',postalCode:'97400',floor:0};
window.optimize=async()=>{window.optimizations++;return{success:true,method:'gmpro',totalDistance:1000,totalDuration:600,totalPackages:1,skippedShipments:0,tours:[{driverId:driver.id,driverName:'Chauffeur Fictif',stops:[stop],packageCount:1,totalDistance:1000,estimatedDuration:600}]}};
window.dispatch=async input=>{
 const request=structuredClone(input);window.calls.push(request);const fingerprint=JSON.stringify(request);
 const known=window.receipts.get(request.requestId);
 if(known){if(known.fingerprint!==fingerprint)throw Error('Payload changed during retry');return known.result}
 const result={missionIds:['only-server-mission'],packageCount:1};window.receipts.set(request.requestId,{fingerprint,result});window.created.push(...request.missions);
 window.parcels=window.parcels.map(p=>({...p,status:'En livraison',missionId:'only-server-mission',stopId:stop.id,currentDriverId:driver.id}));window.updateParcels(window.parcels);
 await new Promise(resolve=>setTimeout(resolve,50));const error=new Error('Réponse réseau perdue après affectation');error.code='functions/unavailable';throw error;
};
function Fixture(){const[parcels,setParcels]=useState(window.parcels);window.updateParcels=setParcels;return <main className='p-4'><p>Données fictives — aucun accès à la production</p><DispatchManager packages={parcels} hubs={[hub]} users={[driver]} vehicles={[]} currentUser={user} selectedDate='2030-01-15' onMissionCreated={()=>{window.completed++}}/></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const mocks = {
  'services/gmproService': `export const optimizeMultiVehicle=(...args)=>window.optimize(...args);export const isGMPROConfigured=()=>true;export const getGoogleMapsApiKey=()=>null;export const groupPackagesByStop=packages=>packages.length?[{packages}]:[];`,
  'services/cloudFunctions': `export const dispatchMissionsCF=input=>window.dispatch(input);`,
  'services/confirmationService': `export const confirmAction=async()=>true;`,
};
const plugin = { name: 'logistics-dispatch-fixture', enforce: 'pre',
  resolveId(id) { if (id === '/__dispatch.tsx') return id; const key = Object.keys(mocks).find(key => id.includes(key)); if (key) return '\0dispatch-' + key; },
  load(id) { if (id === '/__dispatch.tsx') return entry; if (id.startsWith('\0dispatch-')) return mocks[id.slice(10)]; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (req.url.split('?')[0] !== '/') return next(); res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml('/', '<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/__dispatch.tsx"></script></body></html>'));
  }); },
};
const server = await createServer({ root, plugins: [plugin], cacheDir: '/private/tmp/fleet-dispatch-retry-vite', server: { host: '127.0.0.1', port: 5256, strictPort: true } });
await server.listen(); console.log('Dispatch retry fixture http://127.0.0.1:5256');
