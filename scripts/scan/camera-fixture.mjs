import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const realCamera = process.env.SCAN_REAL_CAMERA === '1';
const camera = `
window.cameras=[];window.holdNextCamera=false;window.hangNextStop=false;
export const Html5QrcodeSupportedFormats={DATA_MATRIX:1,QR_CODE:2,CODE_128:3,CODE_39:4,EAN_13:5,PDF_417:6,AZTEC:7};
export class Html5Qrcode {
 constructor(id){this.id=id;this.index=window.cameras.length;window.cameras.push(this);this.active=false;this.track=new EventTarget();this.track.stop=()=>{this.active=false;this.track.readyState='ended'};this.track.readyState='live';}
 async start(config,settings,success){this.success=success;if(window.holdNextCamera){window.holdNextCamera=false;await new Promise(r=>this.release=r)};this.active=true;const video=document.createElement('video');Object.defineProperty(video,'readyState',{value:4});Object.defineProperty(video,'paused',{value:false});Object.defineProperty(video,'srcObject',{value:{getTracks:()=>[this.track],getVideoTracks:()=>[this.track]}});this.video=video;document.getElementById(this.id)?.append(video);}
 async stop(){this.stops=(this.stops||0)+1;this.track.stop();if(window.hangNextStop){window.hangNextStop=false;await new Promise(()=>{})}}
 clear(){document.getElementById(this.id)?.replaceChildren();this.cleared=true;}
 getRunningTrackCameraCapabilities(){return{torchFeature:()=>({isSupported:()=>false})}}
}
`;
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import '/src/index.css';
import Scanner from '/src/components/Scanner.tsx';import ClaimScanModal from '/src/components/ClaimScanModal.tsx';
window.codes=[];window.errors=[];window.calls=[];window.rejectNext=false;window.hold=false;
window.scan=async input=>{window.calls.push(input);if(window.hold)await new Promise(r=>window.releaseScan=r);if(window.rejectNext){window.rejectNext=false;throw Error('network')};return{accepted:true,outcome:'confirmed',message:'Scan confirmé — tournée du jour',packageId:input.code,packageCode:input.code,missionId:'today',missionDate:'2026-09-24',scannedAt:'2026-09-24T04:00:00Z'}};
function Fixture(){const[open,setOpen]=useState(true);const[count,setCount]=useState(0);window.closeScanner=()=>setOpen(false);window.openScanner=()=>setOpen(true);return <><p>Données fictives — aucun accès Firebase</p>{open&&<Scanner title="Scan caméra de test" countLabel={count+' colis conservés'} onScan={code=>{window.codes.push(code);setCount(n=>n+1)}} onClose={()=>setOpen(false)}/>}</>}
function Claim(){return <ClaimScanModal currentUser={{id:'test',firstName:'Chauffeur',lastName:'Fictif',role:'Chauffeur'}} onClose={()=>{}} onDone={()=>{}}/>}
createRoot(document.getElementById('root')).render(<React.StrictMode>{location.search.includes('claim')?<Claim/>:<Fixture/>}</React.StrictMode>);`;
const plugin = {
  name: 'camera-test-fixture', enforce: 'pre',
  resolveId(id) {
    if (id === 'html5-qrcode' && !realCamera) return '\0camera';
    for (const [part, key] of [['services/logService', 'log'], ['services/scanService', 'scan'], ['services/missionService', 'mission'], ['services/activityLogService', 'activity']]) {
      if (id.includes(part)) return '\0' + key;
    }
    if (id === '/__camera.tsx') return id;
  },
  load(id) {
    if (id === '\0camera') return camera;
    if (id === '/__camera.tsx') return entry;
    if (id === '\0log') return 'export const reportError=(context,error)=>window.errors.push({context,message:String(error)});';
    if (id === '\0scan') return 'export const scanPackage=input=>window.scan(input);export const scanReceiptLabel=r=>r.packageCode+" — "+r.message;';
    if (id === '\0mission') return 'export const createAndClaimPackage=()=>{throw Error("Not allowed in this fixture")};';
    if (id === '\0activity') return 'export const logActivity=async()=>{};';
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url.split('?')[0] !== '/') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/__camera.tsx"></script></body></html>'));
    });
  },
};
const port = realCamera ? 5248 : 5247;
const server = await createServer({ root, cacheDir: '/tmp/fleet-camera-vite-' + port, server: { host: '127.0.0.1', port, strictPort: true }, plugins: [plugin] });
await server.listen(); console.log('Camera fixture http://127.0.0.1:' + port);
