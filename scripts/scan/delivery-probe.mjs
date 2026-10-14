import {readFile,writeFile,mkdir} from 'node:fs/promises';
const output=process.env.DELIVERY_PROBE_OUTPUT||'/private/tmp/fleet-delivery-batch-ui';await mkdir(output,{recursive:true});
const [port]=(await readFile((process.env.DELIVERY_BROWSER_DIR||'/private/tmp/fleet-delivery-batch-browser')+'/DevToolsActivePort','utf8')).trim().split('\n');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seq=0;const pending=new Map(),checks=[],errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result);}if(m.method==='Page.javascriptDialogOpening')void call('Page.handleJavaScriptDialog',{accept:true});if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)});
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++seq,{resolve,reject});ws.send(JSON.stringify({id:seq,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await pause(100);}throw Error('Timeout '+expression)};
const click=async label=>{await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.replace(/\\s+/g,' ').trim()===${JSON.stringify(label)});if(!b)throw Error('Button missing: '+${JSON.stringify(label)});if(b.disabled)throw Error('Button disabled: '+${JSON.stringify(label)});b.click();})()`);await pause(100)};
const check=async(name,expression)=>{const pass=!!await ev(expression);checks.push({name,pass});if(!pass)throw Error(name)};
const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(output+'/'+name+'.png',Buffer.from(r.data,'base64'));};
await call('Browser.grantPermissions',{origin:'http://127.0.0.1:5252',permissions:['geolocation']});await call('Emulation.setGeolocationOverride',{latitude:-20.9,longitude:55.5,accuracy:5});
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});
try {
  for(const width of (process.env.DELIVERY_PROBE_FOCUSED?[]:[320,390,1365])) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<500});
    await call('Page.navigate',{url:'http://127.0.0.1:5252/'});
    await wait("document.body.innerText.includes('BR1002')");
    await check(`All three BRs visible before arrival at ${width}`,"(()=>{const t=document.querySelector('section[aria-label=\"Colis à prendre pour cet arrêt\"]').innerText;return ['BR1000','BR1001','BR1002','3 colis à prendre'].every(v=>t.includes(v))&&!t.includes('BR1003')&&!t.includes('GFL-INTERNAL')})()");
    await check(`No horizontal overflow at ${width}`,"document.documentElement.scrollWidth<=innerWidth+1");
    if(width===390)await shot('before-arrival-390');
  }
  for (const scenario of (process.env.DELIVERY_PROBE_SCENARIOS?process.env.DELIVERY_PROBE_SCENARIOS.split(','):process.env.DELIVERY_PROBE_FOCUSED?['final-success','final-upload-failure','final-offline','final-storage-failure','final-failure','final-late-photo','final-external-completion']:[1,3,10,'mixed','final-success','final-upload-failure','final-offline','final-storage-failure','final-failure','final-late-photo','final-external-completion'])) {
  const final=String(scenario).startsWith('final-'),mixed=scenario==='mixed',count=final?1:mixed?3:scenario;
  const codes=mixed?['BR1000','EXP-A/0042','000012345678','EXP-WRONG/99']:Array.from({length:count+1},(_,i)=>'BR'+(1000+i));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Page.navigate',{url:'http://127.0.0.1:5252/?count='+count+(mixed?'&mixed':'')+(final?'&final':'' )});
  await wait(`document.body.innerText.includes('${count} colis à prendre')`);
  if(mixed) {
    await wait("document.body.innerText.includes('000012345678')");
    await check('Mixed sender references and names visible before arrival', "(()=>{const text=document.querySelector('section[aria-label=\"Colis à prendre pour cet arrêt\"]').innerText;return ['BR1000','EXP-A/0042','000012345678','Boiron','Expéditeur Alpha','Expéditeur Beta'].every(value=>text.includes(value))&&!text.includes('Repérez ces BR')})()");
    await shot('mixed-before-arrival');
  }
  await click('Je suis arrivé');
  const scanLabel=count===1?'Scanner ce colis':`Scanner les ${count} colis`;
  await wait(`document.body.innerText.includes(${JSON.stringify(scanLabel)})`);
  await check(`${count} parcels prepared as one visit`, `window.missions[0].stops.length===${final?1:2}&&window.missions[0].stops[0].packageIds.length===${count}`);
  await click(scanLabel);await wait("window.cameras?.some(c=>c.active)");
  await ev(`window.cameras.find(c=>c.active).success(${JSON.stringify(codes[count])})`);
  await wait("!!document.querySelector('[data-scan-feedback=error]')");
  await check(`${count}: red cross identifies wrong client, no parcel counted`, `(()=>{const b=document.querySelector('[data-scan-feedback=error]');return b?.getAttribute('role')==='alert'&&b.classList.contains('bg-red-700')&&!!b.querySelector('.lucide-xcircle')&&b.innerText.includes('Mauvais colis')&&b.innerText.includes('Ne pas remettre à Pharmacie du Centre')&&b.innerText.includes('Destiné à Pharmacie du Port')&&document.body.innerText.includes('0/${count}')&&window.cameras.filter(c=>c.active).length===1})()`);
  if(count===10)await shot('wrong-client-10');
  await check(`${count}: scanner fits mobile viewport`, 'document.documentElement.scrollWidth<=innerWidth+1');
  // Check that a first, still unconfirmed read cannot turn green.
  await ev("window.scanDelay=650;window.cameras.find(c=>c.active).success('BR1000')");
  await pause(150);
  await check(`${count}: no green before server confirmation`, `!document.querySelector('[data-scan-feedback=ok]')&&document.body.innerText.includes('0/${count}')`);
  await wait("!!document.querySelector('[data-scan-feedback=ok]')");
  await check(`${count}: correct parcel has green check and recipient`, `(()=>{const b=document.querySelector('[data-scan-feedback=ok]');return b.classList.contains('bg-green-700')&&!!b.querySelector('.lucide-check-circle')&&b.innerText.includes('Bon colis pour Pharmacie du Centre')&&document.body.innerText.includes('1/${count}')})()`);
  await ev('window.scanDelay=200');
  if(count>1) {
    // Camera accepts a burst; server confirmations stay queued and count distinct BRs.
    await ev(`for(let i=1;i<${count-1};i++)window.cameras.find(c=>c.active).success(${JSON.stringify(codes)}[i]);window.cameras.find(c=>c.active).success('BR1000')`);
    await wait(`document.body.innerText.includes('${count-1}/${count}')`);
    await check(`${count}: repeat stays uncounted in one camera session`, "window.cameras.length===1&&window.cameras[0].active&&window.calls.filter(c=>c.name==='scan'&&c.code==='BR1000').length===1");
    await ev(`window.cameras.find(c=>c.active).success(${JSON.stringify(codes[count-1])})`);
    await wait(`document.body.innerText.includes('${count}/${count}')`);
  }
  await check(`${count}: last green confirmation is visible before auto advance`, "!!document.querySelector('[data-scan-feedback=ok]')&&window.cameras.some(c=>c.active)");
  if(count===1||count===10)await shot('all-confirmed-'+count);
  await wait("document.body.innerText.includes('Oui, bon état')");
  await click('Oui, bon état');await wait("!!document.querySelector('#delivery-recipient')");
  await ev("document.querySelector('#delivery-recipient').focus()");await call('Input.insertText',{text:'Réceptionnaire fictif'});
  await click('C’est bon');
  await wait(`document.body.innerText.includes(${JSON.stringify(count===1?'Une photo et une signature pour ce colis':`Une photo et une signature pour les ${count} colis`)})`);
  await ev(`(()=>{const input=document.querySelector('input[type=file][capture]');const canvas=document.createElement('canvas');canvas.width=10;canvas.height=10;canvas.getContext('2d').fillRect(0,0,10,10);return new Promise(resolve=>canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'preuve-fictive.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));resolve(true)}));})()`);
  await wait("document.body.innerText.includes('Ajouter une autre photo (1/5)')");
  await click('Capturer la signature *');await wait("!!document.querySelector('canvas[aria-label]')");
  await ev("document.querySelector('canvas[aria-label]').scrollIntoView({block:'center'})");await pause(200);
  const rect=await ev("(()=>{const r=document.querySelector('canvas[aria-label]').getBoundingClientRect();return{x:r.x,y:r.y}})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x+20,y:rect.y+50,button:'left',clickCount:1});
  for(let i=1;i<5;i++)await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+20+i*30,y:rect.y+50+(i%2)*30,button:'left',buttons:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+140,y:rect.y+50,button:'left',clickCount:1});
  await click('Valider signature');
  if(scenario==='final-success'||scenario==='final-late-photo') {
    await ev(`(()=>{const original=FileReader.prototype.readAsDataURL;window.heldPhoto=null;FileReader.prototype.readAsDataURL=function(file){window.heldPhoto=()=>original.call(this,file);};const input=document.querySelector('input[type=file][capture]');const transfer=new DataTransfer();transfer.items.add(new File(['held-photo'],'seconde.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));FileReader.prototype.readAsDataURL=original;})()`);
    await pause(100);
    await check(scenario+': photo in progress blocks progression and reload', `window.updateSafety().busy&&[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='Continuer'&&b.disabled)&&window.deliveries.length===0`);
    if(scenario==='final-late-photo') {
      await ev(`(()=>{const old=window.missions[0].stops[0];window.missions[0].stops=[{...old,id:'replacement',packageIds:['p1'],contactName:'Autre pharmacie'}];window.emit();})()`);
      await pause(200);await ev('window.heldPhoto()');await pause(250);
      await check('Late photo cannot contaminate another visit or leave busy stuck', `!window.updateSafety().dirty&&!window.updateSafety().busy&&!document.body.innerText.includes('Signature enregistrée')&&!document.querySelector('img[alt^="Photo"]')`);
      continue;
    }
    await ev('window.heldPhoto()');await wait("!window.updateSafety().busy");
  }
  await click('Continuer');
  const confirmLabel=count===1?'Confirmer la livraison de ce colis':`Confirmer la livraison de ces ${count} colis`;
  await wait(`document.body.innerText.includes(${JSON.stringify(confirmLabel)})`);await shot('common-proof-'+scenario);
  if(scenario==='final-external-completion') {
    await ev("window.missions[0].stops[0].status='Terminé';window.emit()");await pause(200);
    await check('External completion keeps the unsaved photo, signature and recipient accessible', `window.updateSafety().dirty&&!!document.querySelector('section[aria-label="Saisie non enregistrée de cet arrêt"] img[alt="Signature non enregistrée"]')&&!!document.querySelector('img[alt="Photo non enregistrée 1"]')&&document.querySelector('section[aria-label="Saisie non enregistrée de cet arrêt"]').innerText.includes('Réceptionnaire fictif')&&window.deliveries.length===0&&!document.body.innerText.includes('Confirmer la livraison de ce colis')`);
    await ev('window.acceptAbandon=true');await click('Abandonner cette saisie non enregistrée');await pause(100);
    await check('Explicit confirmed abandonment releases the update without sending another delivery', `!window.updateSafety().dirty&&!window.updateSafety().busy&&!window.updateSafety().active&&window.deliveries.length===0&&window.confirmations.some(r=>r?.options?.danger||r?.danger)`);
    continue;
  }
  if(scenario==='final-failure') {
    await click('Signaler un échec de livraison');
    await wait("document.body.innerText.includes('Déclarer un échec de livraison')");
    await ev(`(()=>{const original=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(file){window.heldPhoto=()=>original.call(this,file);};const input=[...document.querySelectorAll('input[type=file][capture]')].at(-1);const transfer=new DataTransfer();transfer.items.add(new File(['failure'],'echec.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));FileReader.prototype.readAsDataURL=original;})()`);
    await pause(100);
    await check('Failure photo in progress blocks confirmation and closing', `window.updateSafety().busy&&[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.innerText.trim()==='Photo requise').every(b=>b.disabled)&&!!document.querySelector('[role=dialog] button[aria-label="Fermer"]:disabled')`);
    await ev('window.heldPhoto()');await wait("document.body.innerText.includes('Confirmer échec')");await click('Confirmer échec');
  } else {
    await ev(`window.uploadFailure=${scenario==='final-upload-failure'};window.offlineSubmit=${scenario==='final-offline'};window.storageFailure=${scenario==='final-storage-failure'}`);
    await click(confirmLabel);
  }
  if(scenario==='final-storage-failure') {
    await wait("document.body.innerText.includes('Stockage local indisponible')");
    await check('Failed local write keeps the full editable draft and blocks update', `window.deliveries.length===0&&window.pending.length===0&&window.updateSafety().dirty&&window.updateSafety().active&&!![...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Confirmer la livraison de ce colis'&&!b.disabled)`);
    continue;
  }
  await wait('window.deliveries.length===1');
  if(scenario!=='final-failure')await check(`${scenario}: one submission with all photos, recipient and signature`, `(()=>{const p=window.deliveries[0];return p.action.packageOutcomes.length===${count}&&p.proof.packageIds.length===${count}&&p.proof.photosBase64.length===${scenario==='final-success'?2:1}&&p.proof.recipientName==='Réceptionnaire fictif'&&!!p.proof.signatureBase64})()`);
  if(final) {
    await wait('!window.updateSafety().busy');
    await check(scenario+': last visit leaves no invisible draft or active lock', '!window.updateSafety().dirty&&!window.updateSafety().active');
    if(scenario==='final-upload-failure'||scenario==='final-offline') {
      await check(scenario+': exact photo and signature remain in durable intent', `window.pending.length===1&&window.pending[0].proof.photosBase64.length===1&&!!window.pending[0].proof.signatureBase64`);
      if(scenario==='final-offline')await check('Offline queued visit is explicit and cannot be submitted twice', `document.body.innerText.includes('Validation et preuves conservées sur ce téléphone')&&!document.body.innerText.includes('Confirmer la livraison de ce colis')&&window.missions[0].stops[0].status==='Arrivé'`);
      await ev('window.replay()');await pause(150);
      await check(scenario+': background replay finishes without an invisible reload blocker', `window.pending.length===0&&!window.updateSafety().dirty&&!window.updateSafety().busy&&!window.updateSafety().active&&window.deliveries.length===1`);
    }
  } else {
    await wait(`document.body.innerText.includes(${JSON.stringify(codes[count])})`);
    await check(`${count}: next client has no inherited proof`,"!document.body.innerText.includes('BR1000')&&!document.body.innerText.includes('Signature enregistrée')&&window.deliveries.length===1");
  }
  }
  if(!process.env.DELIVERY_PROBE_FOCUSED) {
  await call('Page.navigate',{url:'http://127.0.0.1:5252/?load-error'});await wait("document.body.innerText.includes('Impossible de charger les références')");
  await check('Failed load preserves expected parcel count',"document.body.innerText.includes('3 colis à prendre')&&!document.body.innerText.includes('0 colis à prendre')");
  await click('Recharger les références');await wait("document.body.innerText.includes('BR1002')");
  await check('References can be reloaded without a refresh or duplicate preparation',"window.calls.length===0&&!document.body.innerText.includes('Impossible de charger les références')");
  await call('Page.navigate',{url:'http://127.0.0.1:5252/?count=1'});
  await wait("document.body.innerText.includes('BR1000')");await click('Je suis arrivé');
  await wait("document.body.innerText.includes('Scanner ce colis')");await click('Scanner ce colis');
  await wait('window.cameras?.some(c=>c.active)');
  await ev("window.failNextScan=true;window.cameras.find(c=>c.active).success('BR1000')");
  await wait("document.querySelector('[data-scan-feedback=error]')?.innerText.includes('Connexion interrompue')");
  await check('Failed request never confirms the parcel', "document.body.innerText.includes('0/1')&&!document.querySelector('[data-scan-feedback=ok]')&&window.cameras.some(c=>c.active)");
  await pause(3100);
  await ev("window.cameras.find(c=>c.active).success('BR1000');window.cameras.find(c=>c.active).success('BR1001')");
  await wait("document.querySelector('[data-scan-feedback=error]')?.innerText.includes('Mauvais colis')");
  await pause(1500);
  await check('A wrong parcel after the last good one keeps its red warning visible', "window.cameras.some(c=>c.active)&&!!document.querySelector('[data-scan-feedback=error]')&&document.body.innerText.includes('1/1')&&!document.body.innerText.includes('Oui, bon état')&&!document.body.innerText.includes('Retour à la livraison…')");
  await click('Saisie manuelle');await wait("!!document.querySelector('#manual-barcode')");
  await check('Manual entry keeps the same red cross and explanation', "!!document.querySelector('[data-scan-feedback=error] .lucide-xcircle')&&document.body.innerText.includes('Ne pas remettre à Pharmacie du Centre')");
  await ev("document.querySelector('#manual-barcode').focus()");await call('Input.insertText',{text:'BR1000'});await click('OK');
  await wait("document.querySelector('[data-scan-feedback=ok]')?.innerText.includes('Déjà vérifié')");
  await check('Rescanning a confirmed parcel clears red without recounting or another request', "!document.querySelector('[data-scan-feedback=error]')&&window.calls.filter(c=>c.name==='scan'&&c.code==='BR1000').length===2&&document.body.innerText.includes('Colis vérifiés : 1/1')");
  }
  checks.push({name:'No uncaught browser exception',pass:errors.length===0});
} catch(error) { await shot('failure');await writeFile(output+'/failure.txt',await ev('document.body.innerText'));throw error;
} finally {await writeFile(output+'/results.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));await call('Page.close');ws.close();}
if(checks.some(c=>!c.pass)||errors.length)process.exitCode=1;
