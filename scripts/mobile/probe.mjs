import {readFile,writeFile,mkdir} from 'node:fs/promises';
const [port]=(await readFile('/tmp/fleet-mobile-browser/DevToolsActivePort','utf8')).trim().split('\n');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pending=new Map(),checks=[],exceptions=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await pause(100);}throw Error('Timeout: '+expression);};
const check=async(name,expression)=>checks.push({name,pass:!!await ev(expression)});
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});
try {
  for(const width of [320,390,1365]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<640});
    await call('Page.navigate',{url:'http://127.0.0.1:5247/?token=PRIVATE-URL-TOKEN'});await wait(`!!document.querySelector('#draft')&&!!window.opaque`);await pause(100);
    await ev(`document.querySelector('[data-diagnostic-action]').click();for(let i=0;i<23;i++)window.opaque()`);
    await wait(`document.body.innerText.includes('23 occurrences enregistrées')`);
    await check('Repeated opaque errors produce one alert and 23 logs '+width,`document.querySelectorAll('[role=alert]').length===1&&window.logs.length===23`);
    await check('Current form survives and no horizontal overflow '+width,`document.querySelector('#draft').value==='DRAFT-PRIVATE-VALUE'&&document.documentElement.scrollWidth===innerWidth`);
    await check('Original action retained without draft or URL token '+width,`window.logs[0].extra.opaque===true&&window.logs[0].extra.diagnostics.breadcrumbs.some(b=>b.action==='document.open')&&!JSON.stringify(window.logs).includes('DRAFT-PRIVATE-VALUE')&&!JSON.stringify(window.logs).includes('PRIVATE-URL-TOKEN')`);
    await pause(300);await mkdir('docs/validation/mobile-incidents',{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('docs/validation/mobile-incidents/alerts-'+width+'.png',Buffer.from(shot.data,'base64'));
    await ev(`document.querySelector('button[aria-label="Fermer"]').click()`);await pause(100);await ev('window.opaque()');await pause(100);
    await check('Dismissed runtime noise stays dismissed and remains logged '+width,`document.querySelectorAll('[role=alert]').length===0&&window.logs.length===24`);
    await ev(`window.notifyError('Action métier à vérifier')`);await pause(100);
    await check('Business errors are still visible during runtime cooldown '+width,`document.body.innerText.includes('Action métier à vérifier')`);
  }
  await ev(`window.testOnline=false;window.beginDirectory()`);await pause(100);
  await check('Offline directory makes no request and retains self',`window.requests.length===0&&window.received.at(-1)[0].id==='driver-test'`);
  await ev(`window.testOnline=true;window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'))`);await pause(100);
  await check('Wake events produce one directory request',`window.requests.length===1`);
  await ev(`window.scanPromise=window.beginScan();window.opaque()`);await pause(100);
  await check('Opaque error records pending directory and scan without parcel code',`window.logs.at(-1).extra.diagnostics.pendingOperations.length===2&&!JSON.stringify(window.logs).includes('PRIVATE-PARCEL-CODE')`);
  await ev(`window.requests.find(r=>r.name==='getTeamDirectory').resolve({data:{users:[{id:'colleague-test',firstName:'Fictif'}]}});window.requests.find(r=>r.name==='scanPackage').resolve({data:{accepted:true,outcome:'confirmed',missionId:'tour-test',missionDate:'2026-09-17'}});window.scanPromise`);
  await check('Confirmed requests clear pending operations',`window.received.at(-1).length===2&&window.diagnostics().pendingOperations.length===0`);
  await ev(`const script=document.createElement('script');script.setAttribute('src','https://app.invalid/assets/missing.js?secret=PRIVATE-RESOURCE-TOKEN');const event=new Event('error');Object.defineProperty(event,'target',{value:script});window.dispatchEvent(event)`);
  await check('Resource failure is logged with a sanitized asset URL',`window.logs.at(-1).context==='resource.load'&&window.logs.at(-1).extra.resource==='https://app.invalid/assets/missing.js'&&!JSON.stringify(window.logs).includes('PRIVATE-RESOURCE-TOKEN')`);
  checks.push({name:'No unexpected runtime exception',pass:exceptions.length===0});
  await writeFile('docs/validation/mobile-incidents/browser.json',JSON.stringify({checks,exceptions},null,2));console.log(JSON.stringify({checks,exceptions},null,2));if(checks.some(c=>!c.pass))process.exitCode=1;
} finally {await call('Page.close');ws.close();}
