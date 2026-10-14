/* Real callable transactions and rules; unique fixture namespace, no shared wipe. */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8189';
process.env.GCLOUD_PROJECT ||= 'demo-fleet-production-audit';
const req = createRequire(path.resolve('functions/package.json'));
const { getFirestore } = req('firebase-admin/firestore');
const api = require('../functions/lib/index.js');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const clientSDK = require('firebase/firestore');
const db = getFirestore(), prefix = 'client-actions-' + Date.now();
const client = prefix + '-a', other = prefix + '-b', staff = prefix + '-admin';
const company = prefix + '-company', otherCompany = prefix + '-foreign';
const ctx = uid => ({ auth: { uid, token: { email_verified: true, auth_time: Math.floor(Date.now()/1000) } } });
const call = (name, data, uid = client) => api[name].run(data, ctx(uid));
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
async function rejected(promise, code) { await assert.rejects(promise, error => error.code === code); checks++; }
(async () => {
  await Promise.all([
    db.collection('users').doc(client).set({role:'Client',companyName:company,firstName:'Client',lastName:'Audit',email:client+'@example.invalid'}),
    db.collection('users').doc(other).set({role:'Client',companyName:otherCompany,firstName:'Autre',email:other+'@example.invalid'}),
    db.collection('users').doc(staff).set({role:'Admin',firstName:'Bureau',lastName:'Audit',email:staff+'@example.invalid'}),
  ]);
  const base = { companyName: company, type:'pickup', address:'1 rue Test',city:'97400 Saint-Denis',contactName:'Pharmacie A',contactPhone:'0692000000',label:'Pharmacie A' };
  const first = await call('saveClientAddress',{address:base});
  const repeat = await call('saveClientAddress',{address:{...base,type:'delivery'}});
  check(first.id === repeat.id && repeat.outcome === 'usage_extended','Same recipient gains both usages');
  check((await db.collection('savedAddresses').doc(first.id).get()).data().type === 'both','Both usage persisted');
  const different = await call('saveClientAddress',{address:{...base,contactName:'Pharmacie B'}});
  check(different.id !== first.id,'Different recipient at same place preserved');
  const concurrent = await Promise.all([1,2].map(() => call('saveClientAddress',{address:{...base,contactName:'Pharmacie concurrente'}})));
  check(concurrent[0].id === concurrent[1].id,'Concurrent recipient creation is unique');
  await db.collection('savedAddresses').doc(first.id).update({notes:'Ancien digicode',contactEmail:'old@example.invalid',usageCount:9,isFavorite:true});
  await call('updateClientAddress',{id:first.id,fields:{...base,notes:'',contactEmail:''}});
  const cleared = (await db.collection('savedAddresses').doc(first.id).get()).data();
  check(cleared.notes === '' && cleared.contactEmail === '' && cleared.usageCount === 9 && cleared.isFavorite,'Clearing fields preserves counters and favorites');
  await rejected(call('updateClientAddress',{id:first.id,fields:{...base,contactName:'Pharmacie B'}}),'already-exists');
  await rejected(call('updateClientAddress',{id:first.id,fields:base},other),'permission-denied');
  for (const [index,optional] of [{},{contactEmail:'new@example.invalid'},{notes:'Code portail'},{contactEmail:'new@example.invalid',notes:'Code portail'}].entries()) {
    const result = await call('saveClientAddress',{address:{...base,contactName:'Option '+index,...optional}});
    check(!!result.id,'Every optional-field combination is accepted');
  }
  await rejected(call('saveClientAddress',{address:{...base,city:'Saint-Denis'}}),'invalid-argument');
  const legacyId=prefix+'-legacy-address';
  await db.collection('savedAddresses').doc(legacyId).set({...base,companyName:company,contactName:'Legacy',city:'Saint-Denis',notes:'Ancienne consigne'});
  await call('updateClientAddress',{id:legacyId,fields:{...base,contactName:'Legacy',city:'Saint-Denis',notes:''}});
  check((await db.collection('savedAddresses').doc(legacyId).get()).data().notes === '', 'Legacy incomplete municipality permits clearing notes without changing identity');
  await rejected(call('updateClientAddress',{id:legacyId,fields:{...base,contactName:'Changed legacy',city:'Saint-Denis'}}),'invalid-argument');
  const email=prefix+'-invite@example.invalid';
  const invitation={requestId:prefix+'-invite-one',email,firstName:'Camille',lastName:'Audit'};
  const team = await Promise.all([call('inviteClientTeamMember',invitation),call('inviteClientTeamMember',{...invitation,requestId:prefix+'-invite-two'})]);
  check(team[0].userId === team[1].userId && team.filter(x=>x.outcome==='INVITED').length === 1,'Concurrent invitations create one profile');
  check((await db.collection('users').where('email','==',email).get()).size === 1,'Unique email persisted');
  check((await db.collection('mail').where('to','==',email).get()).size === 1,'Exactly one invitation email queued');
  await call('inviteClientTeamMember',invitation);
  check((await db.collection('mail').where('to','==',email).get()).size === 1,'Invite replay never queues another email');
  await rejected(call('inviteClientTeamMember',{...invitation,firstName:'Changed'}),'failed-precondition');
  await rejected(call('inviteClientTeamMember',{...invitation,requestId:prefix+'-foreign-invite'},other),'permission-denied');
  const resend={email,userId:team[0].userId,requestId:prefix+'-resend'};
  const sent=await call('createInvitation',resend); const resent=await call('createInvitation',resend);
  check(sent.token === resent.token && (await db.collection('mail').where('to','==',email).get()).size === 2,'Resend replay reuses its token and queued email');
  await rejected(call('createInvitation',{...resend,userId:'wrong-user'}),'failed-precondition');
  const duplicateEmail=prefix+'-duplicate@example.invalid';
  await Promise.all(['old1','old2'].map(id=>db.collection('users').doc(prefix+id).set({role:'Client',companyName:company,email:duplicateEmail})));
  await rejected(call('createInvitation',{email:duplicateEmail,userId:prefix+'old1',requestId:prefix+'-duplicate-resend'}),'failed-precondition');
  await db.collection('users').doc(team[0].userId).update({activatedAt:'2026-10-14T00:00:00Z'});
  const existing=await call('inviteClientTeamMember',{...invitation,requestId:prefix+'-existing'});
  check(existing.outcome === 'EXISTING','An activated collaborator is returned for inspection');

  const parcelId=prefix+'-parcel', parcel={clientId:client,clientName:company,status:'Échec',externalId:prefix+'-BR-01',contactName:'Pharmacie',address:'1 rue Test',city:'Saint-Denis',postalCode:'97400',movements:[{action:'FAILED',timestamp:'2026-10-14T00:00:00Z'}],deliveryAttempts:[{id:'attempt-1',outcome:'FAILURE'}]};
  await db.collection('packages').doc(parcelId).set(parcel);
  const request={requestId:prefix+'-request',packageId:parcelId,clientId:client,kind:'MISSING',message:'Le colis attendu est introuvable.'};
  const created=await call('createClientRequest',request), replayed=await call('createClientRequest',request);
  check(created.id === replayed.id && created.reference === replayed.reference,'Request receipt is idempotent');
  check((await db.collection('client_requests').where('packageId','==',parcelId).get()).size === 1,'One request persisted');
  await rejected(call('createClientRequest',{...request,requestId:prefix+'-duplicate-request'}),'already-exists');
  await rejected(call('createClientRequest',{...request,requestId:prefix+'-foreign-request',clientId:other},other),'permission-denied');
  await rejected(call('createClientRequest',{...request,requestId:prefix+'-impersonate',clientId:other}),'permission-denied');
  await rejected(call('createClientRequest',{...request,requestId:prefix+'-past',kind:'REDELIVERY',requestedDate:'2000-01-01'}),'invalid-argument');
  await rejected(call('createClientRequest',{...request,requestId:prefix+'-bad-date',kind:'REDELIVERY',requestedDate:'2026-02-30'}),'invalid-argument');
  const correction=await call('createClientRequest',{...request,requestId:prefix+'-address',kind:'ADDRESS',requestedAddress:{contactName:'Pharmacie',address:'2 rue Test',city:'Paris',postalCode:'75001',contactPhone:'0102030405'}});
  check(!!correction.id,'Address proposal accepts any structurally valid five-digit postcode');
  const progress={id:created.id,operationId:prefix+'-progress',expectedVersion:1,status:'IN_PROGRESS',response:''};
  await rejected(call('updateClientRequest',progress),'permission-denied');
  await call('updateClientRequest',progress,staff); await call('updateClientRequest',progress,staff);
  check((await db.collection('client_requests').doc(created.id).get()).data().history.length === 2,'Progress replay has one history event');
  await rejected(call('updateClientRequest',{...progress,operationId:prefix+'-stale',status:'RESOLVED',response:'Votre demande a été contrôlée.'},staff),'failed-precondition');
  const close={...progress,operationId:prefix+'-close',expectedVersion:2,status:'RESOLVED',response:'La recherche est terminée, le colis a été localisé.'};
  await call('updateClientRequest',close,staff); await call('updateClientRequest',close,staff);
  const resolved=(await db.collection('client_requests').doc(created.id).get()).data();
  check(resolved.status === 'RESOLVED' && resolved.version === 3 && resolved.history.length === 3,'Office result and replay preserve one response');
  assert.deepEqual((await db.collection('packages').doc(parcelId).get()).data(),parcel);checks++;
  await db.collection('packages').doc(parcelId).update({status:'Livré'});
  check((await call('createClientRequest',request)).id === created.id,'Existing request replays after parcel status changes');
  await rejected(call('createClientRequest',{...request,requestId:prefix+'-terminal',kind:'CANCELLATION'}),'failed-precondition');

  const env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{host:'127.0.0.1',port:8189}});
  try {
    const own=env.authenticatedContext(client).firestore(), foreign=env.authenticatedContext(other).firestore(), manager=env.authenticatedContext(staff).firestore();
    await assertSucceeds(clientSDK.getDoc(clientSDK.doc(own,'client_requests',created.id)));checks++;
    await assertSucceeds(clientSDK.getDoc(clientSDK.doc(manager,'client_requests',created.id)));checks++;
    await assertFails(clientSDK.getDoc(clientSDK.doc(foreign,'client_requests',created.id)));checks++;
    await assertFails(clientSDK.updateDoc(clientSDK.doc(own,'client_requests',created.id),{status:'RESOLVED'}));checks++;
    await assertFails(clientSDK.setDoc(clientSDK.doc(own,'client_requests',prefix+'-fake'),{clientId:client,companyName:company}));checks++;
    await assertFails(clientSDK.setDoc(clientSDK.doc(own,'users',prefix+'-legacy'),{role:'Client',companyName:company,email:prefix+'@example.invalid',leaveBalance:0}));checks++;
    await assertFails(clientSDK.setDoc(clientSDK.doc(own,'savedAddresses',prefix+'-raw'),{...base,companyName:company}));checks++;
    await assertFails(clientSDK.updateDoc(clientSDK.doc(own,'savedAddresses',first.id),{contactName:'Forged'}));checks++;
    await assertSucceeds(clientSDK.updateDoc(clientSDK.doc(own,'savedAddresses',first.id),{isFavorite:false}));checks++;
    await assertFails(clientSDK.updateDoc(clientSDK.doc(own,'users',team[0].userId),{email:'changed@example.invalid'}));checks++;
  } finally { await env.cleanup(); }
  console.log(JSON.stringify({suite:'client-actions',namespace:prefix,checks,success:true}));
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
