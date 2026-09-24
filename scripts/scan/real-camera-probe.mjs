import {readFile,writeFile,mkdir}from'node:fs/promises';
const output=process.env.SCAN_PROBE_OUTPUT || '/private/tmp/fleet-real-scanner-results';
const [port]=(await readFile((process.env.SCAN_BROWSER_DIR || '/private/tmp/fleet-real-scanner-browser')+'/DevToolsActivePort','utf8')).trim().split('\n');
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


const ready = async () => wait(`!!document.querySelector('video') && !document.querySelector('video').paused && document.querySelector('video').readyState>=2 && document.body.innerText.includes('Visez le code')`);
try {
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await call('Page.navigate',{url:'http://127.0.0.1:5248/'});await ready();
await check('Real html5-qrcode receives video frames',`document.querySelector('video').videoWidth>0&&document.querySelector('video').srcObject.getVideoTracks()[0].readyState==='live'`);
await ev('window.oldVideo=document.querySelector("video");window.oldTrack=window.oldVideo.srcObject.getVideoTracks()[0]');
await click('Relancer la caméra');await ready();
await check('Real camera restart releases old track',`window.oldTrack.readyState==='ended'&&document.querySelector('video')!==window.oldVideo`);
await ev(`window.dispatchEvent(new Event('pagehide'))`);await wait(`!document.querySelector('video')`);
await ev(`window.dispatchEvent(new Event('pageshow'))`);await ready();
await check('Real camera resumes on page return',`document.querySelector('video').srcObject.getVideoTracks()[0].readyState==='live'`);
await click('Saisie manuelle');await wait(`!!document.querySelector('#manual-barcode')`);await type('BR-REAL-MANUAL','#manual-barcode');await click('OK');
await click('Retour caméra');await ready();
await check('Mode switch preserves scan history with actual reader',`window.codes.includes('BR-REAL-MANUAL')&&document.querySelector('video').videoHeight>0`);
await ev('window.closeScanner()');await wait(`!document.querySelector('video')`);await ev('window.openScanner()');await ready();
await check('Actual reader reopens after component unmount',`document.querySelectorAll('video').length===1`);
await mkdir(output,{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(output+'/real-camera-390.png',Buffer.from(shot.data,'base64'));
checks.push({name:'No uncaught runtime exception',pass:errors.length===0});await writeFile(output+'/real-camera.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));if(checks.some(c=>!c.pass))process.exitCode=1;
}catch(e){console.log(JSON.stringify(await ev(`({text:document.body.innerText,logs:window.errors,video:[...document.querySelectorAll('video')].map(v=>({ready:v.readyState,paused:v.paused,width:v.videoWidth,height:v.videoHeight,tracks:v.srcObject?.getTracks().map(t=>({state:t.readyState,muted:t.muted}))}))})`)));console.log(JSON.stringify({checks,errors}));throw e;}finally{await call('Page.close');ws.close()}
