import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');
const entry=`import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '/src/index.css';
import Login from '/src/components/Login.tsx';
import ToastHost from '/src/components/ToastHost.tsx';
import App from '/src/App.tsx';
import Modal from '/src/components/shared/Modal.tsx';
import ConfirmModal from '/src/components/shared/ConfirmModal.tsx';
import ConfirmationHost from '/src/components/ConfirmationHost.tsx';
import {FormInput} from '/src/components/shared/FormInput.tsx';
import {UserRole} from '/src/types.ts';
window.__fixtureUser={id:'UX-ADMIN',firstName:'Camille',lastName:'Test UX',role:UserRole.ADMIN,email:'ux@example.invalid'};
window.__authCalls=[];
const mode=sessionStorage.getItem('fixtureMode')||new URLSearchParams(location.search).get('fixture')||'login';
sessionStorage.setItem('fixtureMode',mode);
function Dialogs(){const [open,setOpen]=useState(false),[nested,setNested]=useState(false),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[value,setValue]=useState('');return <main className="p-4 space-y-3"><button id="opener" onClick={()=>setOpen(true)}>Ouvrir formulaire</button><button id="busy-opener" onClick={()=>{setBusy(true);setConfirm(true)}}>Confirmation occupée</button><button id="error-opener" onClick={()=>{setBusy(false);setConfirm(true)}}>Confirmation erreur</button><Modal isOpen={open} onClose={()=>setOpen(false)} dirty={!!value} title="Formulaire de démonstration"><FormInput id="demo-input" label="Référence" value={value} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();window.__inputEscape=true;}}}/><button id="nested-opener" className="min-h-11" onClick={()=>setNested(true)}>Signer</button><Modal isOpen={nested} onClose={()=>setNested(false)} title="Signature imbriquée"><button id="signature-done" onClick={()=>setNested(false)}>Terminer signature</button></Modal></Modal><ConfirmModal isOpen={confirm} isLoading={busy} onClose={()=>setConfirm(false)} onConfirm={async()=>{throw new Error('Erreur de démonstration')}} title="Confirmation de démonstration" message="Aucune opération réelle."/><button id="enable-confirm" onClick={()=>setBusy(false)}>Libérer</button></main>}
createRoot(document.getElementById('root')).render(<React.StrictMode><ConfirmationHost/><ToastHost/>{mode==='dialogs'?<Dialogs/>:mode==='app'?<App/>:<Login/>}</React.StrictMode>);`;
const custom={
 getUserProfile:'async()=>window.__fixtureUser',subscribeToUserProfile:'(id,cb)=>{const t=setTimeout(()=>cb(window.__fixtureUser),20);return()=>clearTimeout(t)}',
 onUserMessage:'cb=>{window.__toast=cb;return()=>{if(window.__toast===cb)window.__toast=null}}',recordUserLogin:'()=>{}',setLogUser:'()=>{}',reportError:'()=>{}',logActivity:'async()=>{}',
 pendingDeliveries:'async()=>[]',syncDeliveries:'async()=>[]',outboxChangeEvent:JSON.stringify('fixture-outbox'),
 subscribeToNotifications:'(id,cb)=>{const t=setTimeout(()=>cb([]),20);return()=>clearTimeout(t)}',
 calculateMissionStats:'()=>({})',getGoogleMapsApiKey:'()=>null'
};
custom.subscribeToNotifications='(id,cb)=>{const t=setTimeout(()=>cb(window.__notifications||[]),20);return()=>clearTimeout(t)}';
custom.markAsRead='async id=>{window.__marks=(window.__marks||[]).concat(id)}';
const plugin={name:'shared-fixture',enforce:'pre',resolveId(id,importer){
 if(/(?:^|\/)useMissionStats(?:\.tsx?)?$/.test(id))return '\0stats';
 if(id==='firebase/auth')return '\0auth';
 if(/(?:^|\/)firebaseConfig(?:\.tsx?)?$/.test(id))return '\0config';
 if(/(?:^|\/)usePermissions(?:\.tsx?)?$/.test(id))return '\0permissions';
 if(importer?.endsWith('/src/App.tsx')&&['Dashboard','MissionManager','DriverMissionView','HelpCenter'].some(n=>id==='./components/'+n))return '\0view:'+id.split('/').pop();
 if(importer&&/services\//.test(id)&&!id.includes('confirmationService')){const file=id.startsWith('/src/')?root+id:new URL(id,'file://'+importer).pathname;if(file.startsWith(root+'/src/services/'))return '\0service:'+file.replace(/\.ts$/,'');}
},load(id){
 if(id==='\0stats')return `export const useMissionStats=()=>({loading:false,error:null,tasks:[],totalMissions:0,packagesAvailable:false,retry:()=>{},activeMissions:[]});`;
 if(id==='\0auth')return `export const onAuthStateChanged=(auth,cb)=>{const t=setTimeout(()=>cb({uid:'UX-ADMIN',email:'ux@example.invalid',metadata:{lastSignInTime:new Date().toISOString()}}),10);return()=>clearTimeout(t)};export const signOut=async()=>{};export const signInWithEmailAndPassword=async(...args)=>{window.__authCalls.push('login');throw {code:window.__loginError||'auth/invalid-credential'}};export const sendPasswordResetEmail=async()=>{window.__authCalls.push('reset')};`;
 if(id==='\0config')return 'export const auth={},db={},storage={},functions={};';
 if(id==='\0permissions')return `export {Permission} from '/src/permissions.ts';export const PermissionsProvider=({children})=>children;export const usePermissions=()=>({hasPermission:()=>true,hasAnyPermission:()=>true,isLoading:false});`;
 if(id==='\0view:MissionManager')return `import React,{useState} from 'react';import Modal from '/src/components/shared/Modal.tsx';import {FormInput} from '/src/components/shared/FormInput.tsx';export default()=>{const [open,setOpen]=useState(false),[value,setValue]=useState(''),[busy,setBusy]=useState(false);return React.createElement('main',{},React.createElement('p',{},'Fixture de navigation — composants Modal et App réels — données fictives'),React.createElement('button',{id:'draft-opener',onClick:()=>setOpen(true)},'Ouvrir le brouillon'),React.createElement(Modal,{isOpen:open,onClose:()=>setOpen(false),dirty:!!value,busy,title:'Brouillon de démonstration'},React.createElement(FormInput,{id:'navigation-draft',label:'Référence de test',value,onChange:e=>setValue(e.target.value)}),React.createElement('button',{id:'busy-action',onClick:()=>setBusy(!busy)},busy?'Terminer attente fictive':'Simuler un envoi')))};`;
 if(id.startsWith('\0view:'))return `import React,{useState,useEffect} from 'react';export default()=>{const [ready,setReady]=useState(false);useEffect(()=>{const t=setTimeout(()=>setReady(true),300);return()=>clearTimeout(t)},[]);return React.createElement('div',{style:{minHeight:ready?1800:100}},'Vue fictive ${id.slice(6)} — aucun accès données')};`;
 if(!id.startsWith('\0service:'))return;const filename=id.slice(9)+'.ts';const source=readFileSync(filename,'utf8');const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);const code=[];
 for(const node of ast.statements){if(!node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))continue;
 if(ts.isEnumDeclaration(node)){code.push(ts.transpile(node.getText(ast),{module:ts.ModuleKind.ESNext}));continue;}
 const names=ts.isFunctionDeclaration(node)&&node.name?[node.name.text]:ts.isVariableStatement(node)?node.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)).map(d=>d.name.text):[];
 for(const name of names){if(name==='NOTIFICATION_CONFIG'){code.push(ts.transpile(node.getText(ast),{module:ts.ModuleKind.ESNext}));continue;}const fallback=name.startsWith('subscribeTo')?'(...args)=>{const cb=args.find(a=>typeof a==="function");const t=setTimeout(()=>cb?.([]),20);return()=>clearTimeout(t)}':`(...args)=>{throw new Error('Service ${name} neutralisé')}`;code.push('export const '+name+' = '+(custom[name]||fallback)+';');}}
 return code.join('\n')+'\nexport default {};';
}};
const server=await createServer({root,cacheDir:join(tmpdir(),'fleet-ui18-root-vite'),server:{host:'127.0.0.1',port:5244,strictPort:true},plugins:[plugin,{name:'entry',resolveId(id){if(id==='/__gallery.tsx'||id==='/__shared.tsx')return id},load(id){if(id==='/__gallery.tsx')return readFileSync(new URL('./gallery.tsx',import.meta.url),'utf8');if(id==='/__shared.tsx')return entry},configureServer(s){s.middlewares.use(async(req,res,next)=>{if(new URL(req.url,'http://localhost').pathname==='/__gallery'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/__gallery.tsx"></script></body></html>'));return;}if(!['/','/missions','/help','/dashboard','/driver_tour'].includes(new URL(req.url,'http://localhost').pathname))return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/__shared.tsx"></script></body></html>'))})}}]});await server.listen();console.log('Shared fixture on5244');
