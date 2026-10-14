/** Start client-portal-fixture.mjs first. This probe owns its temporary Chrome profile. */
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as XLSX from 'xlsx';
const output = new URL('../docs/validation/client-corrections-2026-10-14/', import.meta.url);
await mkdir(output,{recursive:true});
const profile=await mkdtemp(tmpdir()+'/fleet-client-portal-');
const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let port;for(let i=0;i<100;i++){try{[port]=(await readFile(profile+'/DevToolsActivePort','utf8')).split('\n');break}catch{await pause(100)}}
if(!port)throw Error('Chrome debug port unavailable');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let sequence=0;const pending=new Map(),checks=[],errors=[],snapshots=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(new Error(m.error.message)):p?.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
const wait=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await pause(100)}throw Error('Timeout '+expression+'; '+errors.join('\n'))};
const check=async(name,expression)=>{const result=await ev(expression),pass=!!result;checks.push({name,pass});if(!pass)throw Error(name+' '+JSON.stringify(result))};
const capture=async name=>{await pause(120);const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(new URL('portal-'+name+'.png',output),Buffer.from(r.data,'base64'));snapshots.push('portal-'+name+'.png')};
const click=async(text,root='document')=>{await ev(`(()=>{const b=[...${root}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing enabled button: '+${JSON.stringify(text)});b.click()})()`);await pause(80)};
const fill=async(selector,value)=>{await ev(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing input '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(40)};
const navigate=async(scenario='shipments',readonly=false)=>{await call('Page.navigate',{url:'http://127.0.0.1:5259/?scenario='+scenario+(readonly?'&readonly=1':'')});await pause(300);await wait("typeof window.fixtureNavigate==='function'&&!!document.querySelector('main')");await pause(180)};
const dialog="document.querySelector('[role=alertdialog], [role=dialog]')";
const overflow='document.documentElement.scrollWidth<=innerWidth+1';
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});await call('Emulation.setTimezoneOverride',{timezoneId:'Europe/Paris'});
let failure;
try{
for(const width of [320,390,1440]){
 await call('Emulation.setDeviceMetricsOverride',{width,height:900,mobile:width<768,deviceScaleFactor:1});
 await navigate();await wait("document.querySelectorAll('[data-client-shipment-group]').length===2");
 await check('Separate recipients at same address; mixed group not all delivered '+width,"document.querySelectorAll('[data-client-shipment-group]').length===2&&[...document.querySelectorAll('[data-client-shipment-group]')].find(g=>g.innerText.includes('Pharmacie fictive')).innerText.includes('10 colis')&&![...document.querySelectorAll('[data-client-shipment-group]')].find(g=>g.innerText.includes('Pharmacie fictive')).innerText.includes('Tous livrés')");
 await check('Shipment list fits viewport '+width,overflow);
 await ev("[...document.querySelectorAll('[data-client-shipment-group]')].find(g=>g.innerText.includes('Pharmacie fictive')).querySelector('button').click()");await wait("document.querySelectorAll('[data-client-parcel]').length===10");
 await ev("document.querySelector('[aria-label=\"Afficher le suivi du colis\"]').click()");await wait('window.audit.loadAll===1&&!document.body.innerText.includes("historique en cours de vérification")');
 await check('Detail retains ten cartons and missing pickup '+width,"document.querySelectorAll('[data-client-parcel]').length===10&&document.body.innerText.includes('Absent à l’enlèvement')&&window.audit.watchParcel.includes('parcel-0')");
 await check('Expanded shipment list fits viewport '+width,overflow);await capture('group-detail-'+width);
 await navigate();const term='REF-CLIENT-0000042';
 for(let i=1;i<=term.length;i++)await fill('input[type=search]',term.slice(0,i));await pause(250);
 await check('Eighteen search keystrokes load full history once '+width,`window.audit.loadAll===1&&document.querySelector('input[type=search]').value===${JSON.stringify(term)}&&document.querySelectorAll('[data-client-shipment-group]').length===1&&[...document.querySelectorAll('[data-client-shipment-group]')].find(g=>g.innerText.includes('Pharmacie fictive')).innerText.includes('10 colis')`);
 await navigate('quotes');await click("Accepter l'offre");await wait(`${dialog}!==null`);
 await check('Offer confirmation includes price, route, Reunion date, window and conditions '+width,`${dialog}.innerText.includes('123,45')&&${dialog}.innerText.includes('1 rue Livraison')&&${dialog}.innerText.includes('16/10/2026')&&${dialog}.innerText.includes('11:00')&&${dialog}.innerText.includes('10:00')&&${dialog}.innerText.includes('12:00')&&${dialog}.innerText.includes('Hayon inclus')`);
 await check('Offer modal fits viewport '+width,overflow);await capture('offer-conditions-'+width);
 await ev('window.changeOffer()');await pause(90);
 await check('Open confirmation remains frozen after remote offer changes '+width,`${dialog}.innerText.includes('123,45')&&!${dialog}.innerText.includes('234,56')&&${dialog}.innerText.includes('Hayon inclus')`);
 await click('Confirmer',dialog);await wait(`${dialog}.innerText.includes('L’offre a changé')`);
 await check('Changed offer rejects old snapshot without accepting new price '+width,"window.audit.offerCalls.length===1&&window.audit.offerCalls[0].expectedOffer.priceOffer===123.45&&window.audit.offerCalls[0].expectedOffer.request.deliveryTimeWindow.start==='10:00'&&window.audit.mutations===0");await capture('offer-changed-'+width);
 await navigate('company');await fill('input[id$="companyPhone"]','0692999999');await click('Enregistrer');await wait("document.body.innerText.includes('Connexion interrompue')");
 await check('Profile failure keeps editable input and has no success message '+width,"document.querySelector('input[id$=companyPhone]').value==='0692999999'&&!document.querySelector('input[id$=companyPhone]').disabled&&window.audit.profileCalls.length===1&&!document.body.innerText.includes('Infos entreprise enregistrées')");
 await check('Profile fits viewport '+width,overflow);await capture('profile-failure-'+width);
 await navigate('shipments',true);await wait("document.body.innerText.includes('Pharmacie fictive')");
 await check('Read-only create/import controls disabled '+width,"[...document.querySelectorAll('button')].filter(b=>['Créer une expédition','Importer des expéditions','Importer des destinataires'].includes(b.textContent.trim())).length===3&&[...document.querySelectorAll('button')].filter(b=>['Créer une expédition','Importer des expéditions','Importer des destinataires'].includes(b.textContent.trim())).every(b=>b.disabled)");
 await ev("[...document.querySelectorAll('[data-client-shipment-group]')].find(g=>g.innerText.includes('Pharmacie fictive')).querySelector('button').click()");await wait("document.querySelectorAll('[data-client-parcel]').length===10");
 await check('Read-only operational requests disabled '+width,"[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Contacter l’exploitation').length===10&&[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Contacter l’exploitation').every(b=>b.disabled)");
 await check('Read-only list fits viewport '+width,overflow);await capture('readonly-'+width);
 await ev("window.fixtureNavigate('client_company')");await pause(100);await check('Read-only profile mutation disabled '+width,"document.querySelector('input[id$=companyPhone]').disabled&&[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Enregistrer').disabled");
 await ev("window.fixtureNavigate('client_list')");await pause(100);await check('Read-only quote acceptance absent; no mutations '+width,"![...document.querySelectorAll('button')].some(b=>b.textContent.trim()===\"Accepter l'offre\")&&window.audit.mutations===0&&window.audit.offerCalls.length===0&&window.audit.profileCalls.length===0");
 await navigate();await ev('localStorage.clear()');await click('Créer une expédition');await click('Choisir dans mon carnet');await click('Pharmacie carnet2 rue du Carnet · 97400 Saint-Denis');
 await check('Saved recipient carries editable instructions '+width,"document.querySelector('#shipment-postalCode').value==='97400'&&document.querySelector('#shipment-city').value==='Saint-Denis'&&document.querySelector('textarea').value==='Digicode 2468 ; accueil arrière avant midi.'&&!document.querySelector('textarea').disabled");
 await check('Creation form fits viewport '+width,overflow);await capture('saved-instructions-'+width);
 await fill('textarea','');await click('Créer l’expédition');await wait('window.audit.created.length===1');
 await check('Clearing shipment instructions preserves address book '+width,"!window.audit.created[0].comment&&window.savedAddresses[0].notes==='Digicode 2468 ; accueil arrière avant midi.'&&window.audit.created[0].recipient.postalCode==='97400'");
}
await call('Emulation.setDeviceMetricsOverride',{width:390,height:900,mobile:true,deviceScaleFactor:1});await navigate('dates');await click('Demander un devis');
await check('Quote pickup minimum uses Reunion working hours despite Paris browser',"document.querySelectorAll('input[type=datetime-local]')[0].min==='2026-10-15T08:00'&&document.querySelectorAll('input[type=datetime-local]')[1].disabled");
await fill('input[type=datetime-local]','2026-10-14T08:00');
await check('Past pickup choice is blocked by the real form constraint',"document.querySelectorAll('input[type=datetime-local]')[0].validity.rangeUnderflow");
await fill('input[type=datetime-local]','2026-10-15T08:00');
await check('Valid pickup opens delivery with Reunion minimum three hours later',"!document.querySelectorAll('input[type=datetime-local]')[0].validity.rangeUnderflow&&!document.querySelectorAll('input[type=datetime-local]')[1].disabled&&document.querySelectorAll('input[type=datetime-local]')[1].min==='2026-10-15T11:00'");
await capture('quote-dates-390');
// A real workbook crosses the 75-row transaction boundary. Backend behaviour is injected.
await call('Emulation.setDeviceMetricsOverride',{width:390,height:900,mobile:true,deviceScaleFactor:1});await navigate();
await ev("document.querySelector('details').open=true");await click('Importer des expéditions');
const rows=Array.from({length:76},(_,i)=>({'Numéro de colis':'GEN-'+String(i+1).padStart(4,'0'),Destinataire:'Pharmacie import',Adresse:'3 rue Import 97400 Saint-Denis',Téléphone:'0262000000','Date de livraison':i===0?'2026-10-18':'2026-10-19',Start:'09:00',End:'11:00',Service_Time:10,Étage:0,'Colonne inconnue':'à signaler'}));
rows.push({'Numéro de colis':'GEN-INVALID',Destinataire:'Adresse incomplète',Adresse:'4 rue Sans Ville',Téléphone:'0262000000'});
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),'Expéditions');const file=profile+'/shipment-fixture.xlsx';await writeFile(file,Buffer.from(XLSX.write(book,{bookType:'xlsx',type:'buffer'})));
const dom=await call('DOM.getDocument');const input=await call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[type=file]'});await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[file]});await wait("document.body.innerText.includes('Importer 76 expéditions valides')");
await check('Workbook identifies ignored column and invalid row before import',"document.body.innerText.includes('Colonne inconnue')&&document.body.innerText.includes('Ligne 78')&&document.body.innerText.includes('code postal')");await capture('import-validation-390');
await click('Importer 76 expéditions valides');await wait("document.body.innerText.includes('Import interrompu')");
await check('Partial import shows 75 confirmed and one uncertain',"document.body.innerText.includes('75 confirmées')&&document.body.innerText.includes('1 non confirmée')&&document.body.innerText.includes('Résultat inconnu')&&Object.keys(window.audit.stored).length===75");
await check('Imported row dates, windows, service time and ground floor are preserved',"window.audit.imports[0].rows[0].requestedDeliveryDate==='2026-10-18'&&window.audit.imports[0].rows[1].requestedDeliveryDate==='2026-10-19'&&window.audit.imports[0].rows[0].timeWindowStart==='09:00'&&window.audit.imports[0].rows[0].timeWindowEnd==='11:00'&&window.audit.imports[0].rows[0].serviceTime===10&&window.audit.imports[0].rows[0].floor===0");
await capture('import-interrupted-390');await click('Reprendre 1 ligne non confirmée');await wait("document.body.innerText.includes('Import partiel — lignes à vérifier')");
await check('Retry sends only unconfirmed reference and reports invalid row',"window.audit.imports.length===2&&window.audit.imports[1].rows.length===1&&window.audit.imports[1].rows[0].colisNumber==='GEN-0076'&&Object.keys(window.audit.stored).length===76&&document.body.innerText.includes('76 confirmées')&&document.body.innerText.includes('1 rejetée')");
await check('Import result fits mobile viewport',overflow);await capture('import-resumed-390');
if(errors.length)throw Error('Browser exceptions: '+errors.join('\n'));
}catch(e){failure=String(e?.stack||e);try{await capture('failure');await writeFile(new URL('portal-failure-dom.txt',output),await ev('document.body.innerText'))}catch{}process.exitCode=1}
finally{await writeFile(new URL('portal-browser.json',output),JSON.stringify({fixture:'Real ClientPortal, ClientShipments, CreateShipmentModal, ImportShipmentsModal and PackageTimeline. Mock service boundaries and synthetic records; external Firebase endpoints blocked. Browser timezone Europe/Paris.',widths:[320,390,1440],checks,errors,snapshots,failure},null,2));console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass),errors,failure},null,2));try{await call('Page.close')}catch{}ws.close();chrome.kill();await pause(100);await rm(profile,{recursive:true,force:true})}
