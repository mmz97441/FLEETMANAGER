import {readFile,writeFile,mkdir}from'node:fs/promises';
const output=process.env.SCAN_PROBE_OUTPUT || '/private/tmp/fleet-scan-recovery-results';
const [port]=(await readFile((process.env.SCAN_BROWSER_DIR || '/private/tmp/fleet-scan-recovery-browser')+'/DevToolsActivePort','utf8')).trim().split('\n');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map(),checks=[],errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)});
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async expr=>{for(let i=0;i<220;i++){if(await ev(expr))return;await pause(100)}throw Error('Timeout '+expr)};
const check=async(name,expr)=>checks.push({name,pass:!!(await ev(expr))});
const click=async text=>{await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)})?.click()`);await pause(100)};
const type=async(text,selector='input')=>{await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);await call('Input.insertText',{text});await pause(30)};
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});

const active = `window.cameras?.filter(c=>c.active).at(-1)`;
const ready = async () => wait(`!!(${active}) && document.body.innerText.includes('Visez le code')`);
try {
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await call('Page.navigate',{url:'http://127.0.0.1:5247/'});await ready();
await ev(`(${active}).success('BR-FIRST');(${active}).success('BR-FIRST')`);await pause(50);
await check('Same-frame duplicate callbacks enqueue one physical scan',`window.codes.length===1`);
await ev(`window.dispatchEvent(new Event('pagehide'))`);await wait(`window.cameras.every(c=>!c.active)`);
await ev(`window.dispatchEvent(new Event('pageshow'))`);await ready();
await check('Returning to page restarts camera and preserves scans',`window.cameras.length>=2&&window.codes.length===1&&document.body.innerText.includes('1 colis conservés')`);
await ev(`window.previousCamera=(${active});window.previousCamera.track.dispatchEvent(new Event('ended'))`);await ready();
await wait(`(${active}).index>window.previousCamera.index`);
await check('Interrupted video track recovers without login',`window.previousCamera.stops===1&&!!(${active})`);
await ev(`window.previousCamera=(${active})`);await click('Relancer la caméra');await ready();
await check('Manual camera restart preserves scans',`window.previousCamera.stops===1&&window.codes.length===1`);
await ev('window.holdNextCamera=true;window.heldIndex=window.cameras.length');await click('Relancer la caméra');
await wait(`!!window.cameras[window.heldIndex]?.release`);await click('Saisie manuelle');await wait(`!!document.querySelector('#manual-barcode')`);
await click('Retour caméra');await ready();await ev(`window.newCamera=(${active});window.cameras[window.heldIndex].release()`);await pause(300);
await ev(`window.cameras[window.heldIndex].success('STALE-CODE')`);
await check('Late old startup cannot clear the new camera or send a stale scan',`window.newCamera.active&&!window.newCamera.stops&&document.getElementById(window.newCamera.id)&&!window.codes.includes('STALE-CODE')`);
await ev(`window.hangNextStop=true;window.closeScanner()`);await pause(1700);await ev('window.openScanner()');await ready();
await check('A hung stop cannot prevent closing and reopening',`!!(${active})&&window.codes.length===1`);
await ev(`window.holdNextCamera=true;window.timeoutIndex=window.cameras.length`);await click('Relancer la caméra');
await wait(`!!document.querySelector('#manual-barcode')`);
await check('Camera startup has a visible deadline and manual fallback',`window.errors.some(e=>e.context==='scanner.camera.start')&&document.body.innerText.includes('sans vous déconnecter')`);
await type('BR-MANUAL','#manual-barcode');await click('OK');
await check('Manual scan remains usable after hung camera',`window.codes.includes('BR-MANUAL')`);
await click('Retour caméra');await ready();await ev(`window.cameras[window.timeoutIndex].release()`);await pause(300);
await check('Retry after camera timeout preserves earlier scans',`window.codes.length===2&&!!(${active})`);
await mkdir(output,{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(output+'/camera-recovered-390.png',Buffer.from(shot.data,'base64'));

// Loading deadline must not swap a camera over an in-progress manual entry.
const held=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused')held.push(m.params.requestId)});
await call('Network.setCacheDisabled',{cacheDisabled:true});
await call('Fetch.enable',{patterns:[{urlPattern:'*components/BarcodeScanner.tsx*',requestStage:'Request'}]});
await call('Page.navigate',{url:'http://127.0.0.1:5247/?delayed-module'});
for(let n=0;n<50&&!held.length;n++)await pause(100);
if(!held.length)throw Error('Camera module request was not intercepted');
await wait(`!!document.querySelector('#fallback-scan-code')`);await type('BR-DRAFT','#fallback-scan-code');
for(const requestId of held)await call('Fetch.continueRequest',{requestId});await call('Fetch.disable');await pause(700);
await check('Delayed camera module does not discard manual draft',`document.querySelector('#fallback-scan-code')?.value==='BR-DRAFT'`);
await click('Réessayer la caméra');await ready();
await check('Camera module can recover in same session without reload',`!!(${active})`);

// A failing call pauses the burst queue and retains every pending code.
await call('Page.navigate',{url:'http://127.0.0.1:5247/?claim'});await wait(`!!document.querySelector('input')`);
await ev('window.hold=true');await type('BR-QUEUE');await click('OK');
await type('BR-QUEUE');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await pause(50);
await type('BR-NEXT');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await pause(50);
await ev('window.rejectNext=true;window.hold=false;window.releaseScan()');await wait(`document.body.innerText.includes('Réessayer BR-NEXT')`);
await check('Queue failure keeps both codes and does not retry duplicate frames in a loop',`window.calls.length===1&&document.body.innerText.includes('Réessayer BR-QUEUE')&&[...document.querySelectorAll('button')].filter(b=>b.innerText.startsWith('Réessayer BR')).every(b=>!b.disabled)`);
await click('Réessayer BR-NEXT');await wait(`document.body.innerText.includes('1 colis confirmés')`);await click('Réessayer BR-QUEUE');await wait(`document.body.innerText.includes('2 colis confirmés')`);
await check('Burst queue resumes without logout and confirms each carton once',`window.calls.length===3&&document.body.innerText.includes('2 colis confirmés')`);
checks.push({name:'No uncaught runtime exception',pass:errors.length===0});
await writeFile(output+'/recovery.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await call('Page.close');ws.close()}
