import {readFile,writeFile,mkdir}from'node:fs/promises';
const [port]=(await readFile('/tmp/fleet-scan-browser/DevToolsActivePort','utf8')).trim().split('\n');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map(),checks=[],errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)});
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async expr=>{for(let i=0;i<80;i++){if(await ev(expr))return;await pause(100)}throw Error('Timeout '+expr)};
const check=async(name,expr)=>checks.push({name,pass:!!(await ev(expr))});
const click=async text=>{await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)})?.click()`);await pause(100)};
const type=async(text,selector='input')=>{await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);await call('Input.insertText',{text});await pause(30)};
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});
try{
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await call('Page.navigate',{url:'http://127.0.0.1:5246/'});await wait(`document.body.innerText.includes('Scanner des colis')`);
await click('Scanner des colis');await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Récupérer des colis'))?.click()`);await wait(`!!document.querySelector('input')`);
await type('BR-FIRST');await click('OK');await wait(`document.body.innerText.includes('1 colis confirmés')`);
await check('First tour snapshot does not unmount the claim scanner',`window.missions.length===1 && document.body.innerText.includes('1 colis confirmés')`);
await type('BR-SECOND');await click('OK');await wait(`document.body.innerText.includes('2 colis confirmés')`);
await check('Second scan survives first tour creation with both receipts',`window.scanCount===2&&window.parcels.length===2&&document.body.innerText.includes('BR-FIRST')&&document.body.innerText.includes('BR-SECOND')`);
const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('docs/validation/scans/driver-first-tour.png',Buffer.from(shot.data,'base64'));
await click('Commencer ma tournée (2)');await wait(`document.body.innerText.includes('1 rue Fictive')`);
await check('Done opens the actual server tour, not a guessed DLV identifier',`!document.body.innerText.includes('2 colis confirmés')&&document.body.innerText.includes('1 rue Fictive')&&!document.body.innerText.includes('Aucune tournée')`);
checks.push({name:'No runtime exception',pass:errors.length===0});await writeFile('docs/validation/scans/driver-first-tour.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await call('Page.close');ws.close()}
