import { readFile, writeFile, mkdir } from 'node:fs/promises';
const output = new URL('../docs/validation/client-corrections-2026-10-14/', import.meta.url); await mkdir(output, { recursive: true });
const [port] = (await readFile('/private/tmp/fleet-client-evidence-browser/DevToolsActivePort','utf8')).trim().split('\n');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let seq=0;const pending=new Map(),checks=[],errors=[];
ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.reject(message.error):p?.resolve(message.result)}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text)};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await pause(100)}throw Error('Timeout '+expression)};
const check=async(name,expression)=>{const pass=!!await ev(expression);checks.push({name,pass});if(!pass)throw Error(name)};
const clickText=async text=>{await ev(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw Error('Missing enabled button');button.click()})()`);await pause(100)};
const capture=async name=>{await pause(300);const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(new URL(name+'.png',output),Buffer.from(r.data,'base64'))};
const navigate=async mode=>{await call('Page.navigate',{url:'http://127.0.0.1:5260/?mode='+mode});await wait("typeof window.setMode==='function'");await pause(300)};
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});await call('Emulation.setTimezoneOverride',{timezoneId:'Europe/Paris'});
try{
 for(const width of [320,390,1280]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await navigate('tracking');
  await check('Tracking preserves delivery without GPS at '+width,"document.body.innerText.includes('1 colis en cours de livraison')&&document.body.innerText.includes('Position temporairement indisponible')&&!document.body.innerText.includes('Aucune livraison en cours')");
  await check('Tracking has no horizontal overflow at '+width,'document.documentElement.scrollWidth<=innerWidth');
  await navigate('pod');await check('Proof shows real references, reserves and Reunion date at '+width,"document.body.innerText.includes('BR-00001')&&document.body.innerText.includes('CLIENT-42')&&document.body.innerText.includes('2 boîtes écrasées')&&document.body.innerText.includes('14/10/2026 00:30')");
  await check('Proof has no horizontal overflow at '+width,'document.documentElement.scrollWidth<=innerWidth');
  if(width===390)await capture('proof-reserves-390');
 }
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});await clickText('Imprimer');
 await check('Printed proof preserves reserve and actual reference',"window.printedHtml.includes('2 boîtes écrasées')&&window.printedHtml.includes('BR-00001')&&window.printedHtml.includes('14/10/2026 00:30')");
 await navigate('analytics');await check('Accessible export controls',"[...document.querySelectorAll('button')].some(b=>b.textContent==='Rapport PDF'&&!b.disabled)&&[...document.querySelectorAll('button')].some(b=>b.textContent==='Exporter Excel'&&!b.disabled)");
 await check('Analytics no horizontal overflow','document.documentElement.scrollWidth<=innerWidth');
 await ev("(()=>{const s=document.querySelector('select');s.value='Pharmacie A';s.dispatchEvent(new Event('change',{bubbles:true}))})()");await pause(100);await clickText('Rapport PDF');
 await wait("window.printedHtml.includes('Rapport de livraison')");await check('Export refreshes server and uses historical recipient A',"window.refreshCalls===1&&window.printedHtml.includes('Pharmacie A')&&!window.printedHtml.includes('Pharmacie B')&&window.printedHtml.includes('Porte fermée')");
 await capture('analytics-historical-filter-390');
 await ev('window.networkFailure=true;window.popupClosed=false');await clickText('Rapport PDF');
 await check('Offline refresh shows error and closes incomplete report',"window.popupClosed&&document.body.innerText.includes('Serveur indisponible')&&!window.printedHtml.includes('Rapport de livraison')");
 await ev('window.networkFailure=false;window.setCache(true)');await pause(100);
 await check('Cached history does not enable exports',"[...document.querySelectorAll('button')].filter(b=>['Rapport PDF','Exporter Excel'].includes(b.textContent)).every(b=>b.disabled)&&document.body.innerText.includes('historique non confirmé')");
 await ev('window.setCache(false);window.popupBlocked=true');await pause(100);const before=await ev('window.refreshCalls');await clickText('Rapport PDF');
 await check('Blocked popup has actionable error and does not fetch',`document.body.innerText.includes('Autorisez les fenêtres')&&window.refreshCalls===${before}`);
 await ev('window.popupBlocked=false;window.holdRefresh=true;window.popupClosed=false');await clickText('Rapport PDF');await wait("typeof window.releaseRefresh==='function'");
 await ev("window.setClientId('another-client')");await pause(100);await ev('window.holdRefresh=false;window.releaseRefresh()');await pause(100);
 await check('Account switch discards delayed export and releases the next account',"window.popupClosed&&!window.printedHtml.includes('Rapport de livraison')&&[...document.querySelectorAll('button')].find(b=>b.textContent==='Rapport PDF').disabled===false");
 if(errors.length)throw Error('Browser exceptions: '+errors.join('\n'));
 await writeFile(new URL('evidence-browser.json',output),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,errors},null,2));
}finally{await call('Page.close');ws.close()}
