const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const {createRequire} = require('node:module');
const root=require('node:path').resolve(__dirname, '../../..');
const requireProject=createRequire(path.join(root,'package.json'));
const ts=requireProject('typescript');
const sdk=requireProject('firebase/firestore');
const firebase=requireProject('firebase/app');
const app=firebase.initializeApp({projectId:'demo-client-audit-offline'}, 'read-only-client-audit');
const db=sdk.initializeFirestore(app,{});
const results=[];
let updateMode='deny'; let updatePayload; const logged=[];
function loadSource(file,mocks={}){
 const exports={}; const module={exports};
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('exports','module','require','console',compiled)(exports,module,(id)=>Object.hasOwn(mocks,id)?mocks[id]:{},{...console,error:(...args)=>logged.push(args.map(String).join(' '))});
 return module.exports;
}
(async()=>{
 await sdk.disableNetwork(db);
 const clean=loadSource('src/utils/firestore.ts');
 const service=loadSource('src/services/firestore.ts',{
  '../firebaseConfig':{db,storage:{},default:app},
  '../utils/firestore':clean,
  'firebase/firestore':{...sdk, updateDoc:async(ref,payload)=>{updatePayload=payload;if(updateMode==='deny')throw Object.assign(new Error('Synthetic denied write'),{code:'permission-denied'});}},
 });
 const mutation=loadSource('src/utils/clientMutation.ts');
 const phases=[];
 await mutation.runClientMutation({readOnly:false,audit:async(_,phase)=>phases.push(phase)},'Update company',()=>service.updateUserProfile({id:'client-a',firstName:'Alice',companyName:'Demo',companyAddress:'Changed'}));
 assert.deepEqual(phases,['requested','confirmed']);
 assert(logged.some(x=>x.includes('Synthetic denied write')));
 results.push({case:'profile_write_denied',write:'permission-denied',promise:'resolved',audit:phases,defectConfirmed:true});
 const base={companyName:'Demo',createdBy:'client-a',label:'Pharmacy',type:'delivery',address:'1 rue Test',city:'97400 Saint-Denis',contactName:'Pharmacy',contactPhone:'0692000000',createdAt:'',updatedAt:''};
 for(const optionalFields of [{contactEmail:undefined,notes:undefined},{contactEmail:'test@example.invalid',notes:undefined},{contactEmail:undefined,notes:'Code 1234'}]){
  let error;
  try{await service.addSavedAddress({...base,...optionalFields});}catch(e){error=e;}
  assert.equal(error?.code,'invalid-argument');
  assert.match(error.message,/undefined/);
  results.push({case:'manual_recipient_optional_blank',contactEmailSet:!!optionalFields.contactEmail,notesSet:!!optionalFields.notes,error:error.message,defectConfirmed:true});
 }
 updateMode='capture';
 await service.updateSavedAddress({...base,id:'recipient-a',contactEmail:undefined,notes:undefined});
 assert(!Object.hasOwn(updatePayload,'contactEmail')); assert(!Object.hasOwn(updatePayload,'notes'));
 const persistedBefore={...base,contactEmail:'obsolete@example.invalid',notes:'Obsolete gate code'};
 const persistedAfter={...persistedBefore,...updatePayload};
 assert.equal(persistedAfter.notes,'Obsolete gate code');
 results.push({case:'clear_recipient_optional_fields',actualPatchKeys:Object.keys(updatePayload),persistedEmail:persistedAfter.contactEmail,persistedNotes:persistedAfter.notes,defectConfirmed:true});
 let resumeAudit;const state={active:true};const sequence=[];
 const inFlight=mutation.runClientMutation({readOnly:!state.active,audit:async(_,phase)=>{sequence.push(phase);if(phase==='requested')await new Promise(resolve=>resumeAudit=resolve);}},'Add recipient',async()=>{sequence.push('write_after_stop='+!state.active);});
 state.active=false;sequence.push('intervention_stopped');resumeAudit();await inFlight;
 assert(sequence.includes('write_after_stop=true'));
 results.push({case:'end_intervention_while_intent_auditing',sequence,defectConfirmed:true});
 const address=loadSource('functions/src/deliveryAddress.ts');
 const previous={type:'pickup',address:'1 rue Test',city:'97400 Saint-Denis',contactName:'Tenant A',contactPhone:'0692000001'};
 const next={type:'delivery',address:'1 rue Test',city:'97400 Saint-Denis',contactName:'Tenant B',contactPhone:'0692000002'};
 const exists=address.placeKey(previous)===address.placeKey(next);
 assert(exists);assert(![previous].some(a=>a.type==='both'||a.type===next.type));
 results.push({case:'address_saved_but_existing_pickup_or_other_recipient',samePlaceKey:exists,existingContact:previous.contactName,intendedContact:next.contactName,selectableForDelivery:false,defectConfirmed:true});
 await sdk.terminate(db);await firebase.deleteApp(app);
 fs.writeFileSync('/private/tmp/fleet-client-actions-audit.json',JSON.stringify({method:'Current main source transpiled in isolation; actual Firebase serializer, network disabled; updateDoc replaced by deterministic rejection/capture; no production access',results},null,2)+'\n');
 console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
