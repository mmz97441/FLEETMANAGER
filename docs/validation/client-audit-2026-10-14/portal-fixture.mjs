import { createServer } from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../', import.meta.url));
const entry=`import React from'react';import{createRoot}from'react-dom/client';import'/src/index.css';import ClientPortal from'/src/components/ClientPortal.tsx';
window.audit={loadAll:0};
const common={clientId:'client-test',clientName:'Expéditeur fictif',contactName:'Destinataire fictif',address:'1 rue de Test',city:'Saint-Denis',postalCode:'97400',contactPhone:'0262000000',createdAt:'2026-10-14T08:00:00+04:00',movements:[]};
window.parcels=[{...common,id:'parcel-first',externalId:'BR-AUDIT-001',orderNumber:'ORD-AUTO-001',clientReference:'COMMANDE-CLIENT-42',status:'Livré',createdAt:'2026-10-14T09:00:00+04:00'}, {...common,id:'parcel-second',externalId:'BR-AUDIT-002',orderNumber:'ORD-AUTO-002',status:'En attente',pickupMissing:{recordedAt:'2026-10-14T10:00:00+04:00'}}];
createRoot(document.getElementById('root')).render(<main className='p-3'><ClientPortal activeView='client_shipments' currentUser={{id:'client-test',firstName:'Client',lastName:'Fictif',companyName:'Expéditeur fictif',companyAddress:'10 rue Test, 97400 Saint-Denis',role:'Client',email:'client@example.invalid'}} quotes={[]} companyUsers={[]} onAddQuote={()=>{}} onUpdateQuoteStatus={()=>{}}/></main>);`;
const mocks={
'clientPackageSubscription':`export function subscribeClientParcelFeed(client,callback,onError,onCoverage){const coverage={activeReady:true,historyComplete:true,historyLoading:false,historyCount:1,activeCount:1,hasMore:false};queueMicrotask(()=>callback(window.parcels,coverage));return {loadMore:async()=>{},loadAll:async()=>{window.audit.loadAll++;return window.parcels},unsubscribe:()=>{}}}`,
'emailService':`export const sendUserInvitationEmail=async()=>{};`,
'invitationService':`export const createInvitation=async()=>({});export const getActivationUrl=()=>'';export const resendInvitation=async()=>{};`,
'firestore':`export const subscribeToSavedAddresses=(company,callback)=>{queueMicrotask(()=>callback([]));return ()=>{}};export const addSavedAddress=async()=>'';export const incrementAddressUsage=async()=>{};export const updateUserProfile=async()=>{};export const updateSavedAddress=async()=>{};export const deleteSavedAddress=async()=>{};`,
'deliveryService':`export const getDeliveryScheduleConfig=async()=>({slots:[]});export const getAvailableSlotsForZone=()=>[];export const estimateZoneFromAddress=async()=>null;`,
'podService':`export const getPODByPackage=async()=>null;export const getPackageProofs=()=>[];`,
'missionService':`export const subscribeToClientPackages=()=>()=>{};`,
'pickupService':`export const generateBatchLabelsHTML=()=>'';`,
'logService':`export const notifySuccess=()=>{};export const notifyWarning=()=>{};export const notifyInfo=()=>{};`,
'accountService':`export const changePassword=async()=>{};`,
};
const stubs=['ShippingLabel','PODViewer','CreateShipmentModal','ImportShipmentsModal','ImportRecipientsModal','AccountHub','ClientAnalytics','RecipientsManager','ClientLiveTracking','ClientHelp','PackageTimeline'];
const plugin={name:'audit-client-portal',enforce:'pre',resolveId(id){if(id==='/__audit-client.tsx')return id;if(/services\//.test(id)){const key=id.split('/').pop().replace(/\.tsx?$/,'');if(mocks[key])return '\0audit:'+key;}const name=id.split('/').pop().replace(/\.tsx?$/,'');if(stubs.includes(name))return '\0stub:'+name;if(id.endsWith('/utils/deliveryNote'))return '\0deliveryNote';},load(id){if(id==='/__audit-client.tsx')return entry;if(id.startsWith('\0audit:'))return mocks[id.slice(7)];if(id.startsWith('\0stub:'))return 'export default function Stub(){return null} export const quoteToLabelData=()=>({});';if(id==='\0deliveryNote')return 'export const openDeliveryNote=()=>{};';},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/','<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/__audit-client.tsx"></script></body></html>'));});}};
const server=await createServer({root,plugins:[plugin],cacheDir:'/private/tmp/fleet-client-audit-vite',server:{host:'127.0.0.1',port:5259,strictPort:true}});await server.listen();console.log('Client portal fixture http://127.0.0.1:5259');
