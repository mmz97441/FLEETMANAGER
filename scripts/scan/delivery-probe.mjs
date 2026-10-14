import {readFile,writeFile,mkdir} from 'node:fs/promises';
const output=process.env.DELIVERY_PROBE_OUTPUT||'/private/tmp/fleet-delivery-batch-ui';await mkdir(output,{recursive:true});
const [port]=(await readFile((process.env.DELIVERY_BROWSER_DIR||'/private/tmp/fleet-delivery-batch-browser')+'/DevToolsActivePort','utf8')).trim().split('\n');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seq=0;const pending=new Map(),checks=[],errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)});
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
  for(const width of [320,390,1365]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<500});
    await call('Page.navigate',{url:'http://127.0.0.1:5252/'});
    await wait("document.body.innerText.includes('BR1002')");
    await check(`All three BRs visible before arrival at ${width}`,"(()=>{const t=document.querySelector('section[aria-label=\"Colis à prendre pour cet arrêt\"]').innerText;return ['BR1000','BR1001','BR1002','3 colis à prendre'].every(v=>t.includes(v))&&!t.includes('BR1003')&&!t.includes('GFL-INTERNAL')})()");
    await check(`No horizontal overflow at ${width}`,"document.documentElement.scrollWidth<=innerWidth+1");
    if(width===390)await shot('before-arrival-390');
  }
  for (const count of [1,3,10]) {
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Page.navigate',{url:'http://127.0.0.1:5252/?count='+count});
  await wait(`document.body.innerText.includes('${count} colis à prendre')`);
  await click('Je suis arrivé');
  const scanLabel=count===1?'Scanner ce colis':`Scanner les ${count} colis`;
  await wait(`document.body.innerText.includes(${JSON.stringify(scanLabel)})`);
  await check(`${count} parcels prepared as one visit`, `window.missions[0].stops.length===2&&window.missions[0].stops[0].packageIds.length===${count}`);
  await click(scanLabel);await wait("window.cameras?.some(c=>c.active)");
  await ev(`window.cameras.find(c=>c.active).success('BR${1000+count}')`);
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
    await ev(`for(let i=1;i<${count-1};i++)window.cameras.find(c=>c.active).success('BR'+(1000+i));window.cameras.find(c=>c.active).success('BR1000')`);
    await wait(`document.body.innerText.includes('${count-1}/${count}')`);
    await check(`${count}: repeat stays uncounted in one camera session`, "window.cameras.length===1&&window.cameras[0].active&&window.calls.filter(c=>c.name==='scan'&&c.code==='BR1000').length===1");
    await ev(`window.cameras.find(c=>c.active).success('BR${999+count}')`);
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
  await click('Valider signature');await click('Continuer');
  const confirmLabel=count===1?'Confirmer la livraison de ce colis':`Confirmer la livraison de ces ${count} colis`;
  await wait(`document.body.innerText.includes(${JSON.stringify(confirmLabel)})`);await shot('common-proof-'+count);
  await click(confirmLabel);await wait('window.deliveries.length===1');
  await check(`${count}: one submission with one photo, recipient and signature`, `(()=>{const p=window.deliveries[0];return p.action.packageOutcomes.length===${count}&&p.proof.packageIds.length===${count}&&p.proof.photosBase64.length===1&&p.proof.recipientName==='Réceptionnaire fictif'&&!!p.proof.signatureBase64})()`);
  await wait(`document.body.innerText.includes('BR${1000+count}')`);
  await check(`${count}: next client has no inherited proof`,"!document.body.innerText.includes('BR1000')&&!document.body.innerText.includes('Signature enregistrée')&&window.deliveries.length===1");
  }
  await call('Page.navigate',{url:'http://127.0.0.1:5252/?load-error'});await wait("document.body.innerText.includes('Impossible de charger les BR')");
  await check('Failed load preserves expected parcel count',"document.body.innerText.includes('3 colis à prendre')&&!document.body.innerText.includes('0 colis à prendre')");
  await click('Recharger les BR');await wait("document.body.innerText.includes('BR1002')");
  await check('References can be reloaded without a refresh or duplicate preparation',"window.calls.length===0&&!document.body.innerText.includes('Impossible de charger les BR')");
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
  checks.push({name:'No uncaught browser exception',pass:errors.length===0});
} catch(error) { await shot('failure');await writeFile(output+'/failure.txt',await ev('document.body.innerText'));throw error;
} finally {await writeFile(output+'/results.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));await call('Page.close');ws.close();}
if(checks.some(c=>!c.pass)||errors.length)process.exitCode=1;
