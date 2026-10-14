import {readFile,writeFile,mkdir} from'node:fs/promises';
const out='/private/tmp/fleet-client-audit';await mkdir(out,{recursive:true});
const [port]=(await readFile('/private/tmp/fleet-client-audit-browser/DevToolsActivePort','utf8')).split('\n');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)});
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async expression=>{for(let n=0;n<100;n++){if(await ev(expression))return;await pause(100)}throw Error('Timeout '+expression+' errors='+JSON.stringify(errors))};
const capture=async name=>{const s=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(out+'/'+name+'.png',Buffer.from(s.data,'base64'))};
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
try{
 await call('Page.navigate',{url:'http://127.0.0.1:5259/'});await wait("document.body?.innerText.includes('Destinataire fictif')");
 const initial=await ev("({text:document.body.innerText,groupBadge:[...document.querySelectorAll('[data-client-shipment-group] [title]')].map(e=>({text:e.textContent,title:e.title,classes:e.className})),historyLoads:window.audit.loadAll,overflow:document.documentElement.scrollWidth>innerWidth+1})");await capture('initial-mixed-group');
 await ev("document.querySelector('[aria-label=\"Afficher les colis du destinataire\"]').click()");await wait("document.body.innerText.includes('COMMANDE-CLIENT-42')");
 const expanded=await ev("({text:document.body.innerText,visibleReferences:document.querySelectorAll('[data-shipment-reference]').length})");await capture('expanded-two-parcels');
 await ev("document.querySelector('[aria-label=\"Afficher le suivi du colis\"]').click()");await wait("location.search.includes('package=')");
 const details=await ev("({text:document.body.innerText,visibleReferences:document.querySelectorAll('[data-shipment-reference]').length,historyLoads:window.audit.loadAll})");await capture('detail-hides-sibling');
 await call('Page.navigate',{url:'http://127.0.0.1:5259/'});await wait("!!document.querySelector('input[type=search]') && document.body?.innerText.includes('Destinataire fictif')");
 const term='COMMANDE-CLIENT-42';for(let i=1;i<=term.length;i++){await ev(`(()=>{const input=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(term.slice(0,i))});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(35)}
 await pause(100);const search=await ev("({text:document.body.innerText,historyLoads:window.audit.loadAll,visibleGroups:document.querySelectorAll('[data-client-shipment-group]').length,query:document.querySelector('input[type=search]').value})");await capture('own-reference-not-found');
 const result={fixture:'Real ClientPortal with synthetic parcel feed, heavy child screens stubbed, external Firebase endpoints blocked',initial,expanded,details,search,errors};await writeFile(out+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(errors.length)process.exitCode=1;
}finally{await call('Page.close');ws.close()}
