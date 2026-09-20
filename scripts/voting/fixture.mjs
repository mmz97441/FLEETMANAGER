import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import '/src/index.css';
import VotingModule from '/src/components/voting/VotingModule.tsx';import ConfirmationHost from '/src/components/ConfirmationHost.tsx';
const config=new URLSearchParams(location.search);window.direction=config.get('role')==='manager';window.manager=['manager','secretary'].includes(config.get('role'));window.calls=[];window.downloads=[];
window.people=[{id:'employee-a',name:'Alice Fictive',role:'Chauffeur'},{id:'employee-b',name:'Bruno Fictif',role:'Mécanicien'},{id:'observer',name:'Camille Fictive',role:'Stagiaire'}];
const now=Date.now();window.poll={id:'fixture-vote',title:'Choisir notre réunion d’équipe',purpose:'Choisir ensemble le créneau de la réunion hebdomadaire. Les salariés peuvent consulter la note explicative avant de voter.',question:'Quel créneau préférez-vous ?',kind:'consultation',privacy:config.get('privacy')||'secret',status:config.get('scenario')==='draft'?'draft':config.get('scenario')==='closed'?'closed':'published',revision:2,createdAt:new Date(now-3600000).toISOString(),updatedAt:new Date(now).toISOString(),opensAt:new Date(now-60000).toISOString(),closesAt:new Date(now+3600000).toISOString(),maxChoices:1,allowBlank:true,quorumPercent:50,participantIds:window.people.map(p=>p.id),voterIds:['employee-a','employee-b'],participants:window.people,voters:window.people.slice(0,2),participantCount:3,voterCount:2,options:[{id:'morning',label:'Le matin'},{id:'afternoon',label:'L’après-midi'}],documents:[],canManage:window.manager,canViewResults:window.direction,isElector:config.get('role')==='employee',canVote:config.get('role')==='employee',hasVoted:false};
if(config.get('scenario')==='scheduled'){window.poll.opensAt=new Date(now+1000).toISOString();window.poll.canVote=false;const interval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>interval(fn,ms===15000?100:ms,...args);}
window.results={eligible:2,cast:1,blank:0,expressed:1,abstentions:1,turnout:50,quorumRequired:1,quorumMet:true,rows:[{id:'morning',label:'Le matin',votes:1,percent:100},{id:'afternoon',label:'L’après-midi',votes:0,percent:0}],leaders:['Le matin'],tied:false};
window.parts=window.people.slice(0,2).map((p,i)=>({...p,voted:i===0,...(i===0?{castAt:new Date(now).toISOString(),choices:['morning']}:{} )}));
window.makeClosed=()=>{window.poll.status='closed';window.poll.closedAt=new Date().toISOString();window.poll.results=window.results;window.poll.canVote=false;};
if(window.poll.status==='closed')window.makeClosed();
if(config.get('finalized'))window.poll.minutes={chair:'Alice Fictive',secretary:'Bruno Fictif',place:'La Réunion',observations:'Dépouillement de démonstration. Tous les noms et chiffres sont fictifs.',finalizedAt:new Date().toISOString(),finalizedBy:'Direction fictive',digest:'a'.repeat(64)};
window.empty=config.get('scenario')==='empty';window.detail=()=>({poll:structuredClone(window.poll),...(window.manager&&window.poll.status==='closed'?{participation:window.parts}:{} )});
const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download&&this.href.startsWith('blob:')){const name=this.download;fetch(this.href).then(r=>r.blob()).then(async b=>{const bytes=new Uint8Array(await b.arrayBuffer());window.downloads.push({name,type:b.type,size:b.size,base64:btoa(Array.from(bytes,x=>String.fromCharCode(x)).join(''))});});}else click.call(this);};
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/votes'+(config.has('direct')?'?vote=fixture-vote':'')]}><main className="p-4 max-w-6xl mx-auto"><p className="text-sm text-slate-500 mb-4">Validation locale — données fictives</p><VotingModule currentUser={{id:window.manager?'manager':'employee-a',firstName:'Alice',lastName:'Fictive',role:window.direction?'Directeur Exploitation':config.get('role')==='secretary'?'Secrétariat':'Chauffeur',email:'fictif@example.invalid',leaveBalance:0}}/><ConfirmationHost/></main></MemoryRouter>);
`;
const service = `
const record=(action,extra={})=>window.calls.push({action,...structuredClone(extra)});
export const listVotes=async()=>({polls:window.empty?[]:[window.detail().poll],nextCursor:null,canManage:window.manager});
export const getVote=async id=>{record('get',{id});return window.detail();};
export const getVotingEmployees=async()=>({employees:window.people});
export const saveVote=async(id,revision,draft,requestId)=>{record('save',{draft,requestId});window.poll={...window.poll,...draft,id,status:'draft',revision:revision+1,canManage:true,canVote:false,participants:window.people.filter(p=>draft.participantIds.includes(p.id)),voters:window.people.filter(p=>draft.voterIds.includes(p.id)),voterCount:draft.voterIds.length,participantCount:draft.participantIds.length,documents:[]};window.empty=false;return window.detail();};
export const castVote=async(id,choices,requestId)=>{record('cast',{id,choices,requestId});if(window.holdCast)await new Promise(r=>window.releaseCast=r);window.poll.hasVoted=true;window.poll.canVote=false;window.poll.receipt={code:'confirmation-fictive',castAt:new Date().toISOString()};return{recorded:true,alreadyVoted:false,receipt:window.poll.receipt};};
export const manageVote=async(id,action,extra)=>{record(action,extra);if(action==='publish')window.poll.status='published';if(action==='close')window.makeClosed();if(action==='cancel')window.poll.status='cancelled';if(action==='remove_document')window.poll.documents=window.poll.documents.filter(d=>d.id!==extra.documentId);if(action==='finalize_minutes')window.poll.minutes={...extra.minutes,finalizedAt:new Date().toISOString(),finalizedBy:'Direction fictive',digest:'a'.repeat(64)};window.poll.revision++;return window.detail();};
export const attachVoteDocument=async(id,file,visibility,kind)=>{record('attach',{name:file.name,visibility,kind});window.poll.documents.push({id:'doc-fixture',name:file.name,size:file.size,contentType:file.type,visibility,kind,addedAt:new Date().toISOString()});return window.detail();};
export const downloadVoteDocument=async()=>({blob:new Blob(['Document fictif'],{type:'application/pdf'}),name:'document-fictif.pdf'});
`;
const mock = {
  name: "voting-fixture",
  enforce: "pre",
  resolveId(id) {
    if (id.includes("votingService")) return "\0voting-service";
    if (id.includes("usePermissions")) return "\0voting-permissions";
    if (id === "/__voting-entry.tsx") return id;
  },
  load(id) {
    if (id === "\0voting-service") return service;
    if (id === "\0voting-permissions")
      return "export {Permission} from '/src/permissions.ts';export const usePermissions=()=>({hasPermission:()=>true,isLoading:false});";
    if (id === "/__voting-entry.tsx") return entry;
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url.split("?")[0] !== "/") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(
        await server.transformIndexHtml(
          req.url,
          '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/__voting-entry.tsx"></script></body></html>',
        ),
      );
    });
  },
};
const server = await createServer({
  root,
  cacheDir: "/tmp/fleet-voting-vite",
  server: { host: "127.0.0.1", port: 5249, strictPort: true },
  plugins: [mock],
});
await server.listen();
console.log("Voting fixture: http://127.0.0.1:5249");
