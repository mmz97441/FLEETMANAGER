import {readFile,writeFile,mkdir}from'node:fs/promises';
const output=process.env.SCAN_PROBE_OUTPUT || 'docs/validation/scans';
const [port]=(await readFile((process.env.SCAN_BROWSER_DIR || '/tmp/fleet-scan-browser')+'/DevToolsActivePort','utf8')).trim().split('\n');
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
for(const width of [320,390,1365]){
await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<640});await call('Page.navigate',{url:'http://127.0.0.1:5245/'});await wait(`!!document.querySelector('input')`);
await ev('window.hold=true');await type('BR-DEMO');await click('OK');
await check('No false confirmation while server pending '+width,`!document.body.innerText.includes('colis confirmés') && [...document.querySelectorAll('button')].filter(b=>b.innerText.includes('Chargement')).every(b=>b.disabled)`);
await ev('window.hold=false;window.release()');await wait(`document.body.innerText.includes('1 colis confirmés')`);
await check('Current tour, scan time visible '+width,`document.body.innerText.includes('17/09/2026')&&document.body.innerText.includes('09:12:30')&&document.body.innerText.includes('tour-demo-17-septembre')`);
await type('BR-DEMO');await click('OK');await wait(`document.body.innerText.includes('Déjà scanné')`);
await check('Duplicate confirmed without duplicate parcel '+width,`window.calls.length===2&&document.body.innerText.includes('1 colis confirmés')&&!document.body.innerText.includes('2 colis confirmés')`);
await ev('window.rejectNext=true');await type('BR-RETRY');await click('OK');await wait(`document.body.innerText.includes('sans confirmation')`);
await check('Network failure never offered as unknown creation '+width,`document.body.innerText.includes('Réessayer BR-RETRY')&&!document.body.innerText.includes('hors import — à créer')`);
await click('Réessayer BR-RETRY');await wait(`document.body.innerText.includes('2 colis confirmés')`);
await type('0012345678300123450101');await click('OK');await wait(`document.body.innerText.includes('Numéro individuel nécessaire')`);
await check('Recognized order stays unconfirmed and cannot create a duplicate '+width,`document.body.innerText.includes('Commande 12345678 retrouvée')&&document.body.innerText.includes('2 colis confirmés')&&!document.body.innerText.includes('hors import — à créer')`);
await type('BR-CARTON');await click('OK');await wait(`document.body.innerText.includes('3 colis confirmés')`);
await check('Individual carton still confirms after order warning '+width,`document.body.innerText.includes('BR-CARTON')&&document.body.innerText.includes('Numéro individuel nécessaire')`);
await click('J’ai compris');await check('Order guidance is dismissible '+width,`!document.body.innerText.includes('Numéro individuel nécessaire')`);
await check('No horizontal overflow '+width,`document.documentElement.scrollWidth===innerWidth && [...document.querySelectorAll('input')].every(e=>e.getBoundingClientRect().right<=innerWidth)`);
await mkdir(output,{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/scan-${width}.png`,Buffer.from(shot.data,'base64'));
await click('Ouvrir ma tournée (3)');await check('Done opens actual returned tour '+width,`window.done?.count===3&&window.done?.id==='tour-demo-17-septembre'`);
}
await call('Page.navigate',{url:'http://127.0.0.1:5245/?fallback'});await wait(`!!document.querySelector('#fallback-scan-code')`);await type('BR-MANUAL','#fallback-scan-code');await click('Vérifier ce colis');await check('Fallback preserves business scan and displays confirmation',`window.fallbackCode==='BR-MANUAL'&&document.body.innerText.includes('Scan confirmé')`);
await call('Page.navigate',{url:'http://127.0.0.1:5245/?timeline'});await wait(`document.body.innerText.includes('Colis')||document.body.innerText.includes('nouvelle tournée')`);await check('Timeline displays original and current tours with full timestamp',`['17/09/2026','16/09/2026','09:12:30','tour-demo-17','tour-demo-16','Chauffeur fictif'].every(t=>document.body.innerText.includes(t))`);
checks.push({name:'No runtime exception',pass:errors.length===0});await writeFile(`${output}/browser.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await call('Page.close');ws.close()}
