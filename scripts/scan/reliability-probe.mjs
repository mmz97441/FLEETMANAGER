import { readFile, writeFile, mkdir } from 'node:fs/promises';
const directory='/private/tmp/fleet-scan-reliability-browser', output='/private/tmp/fleet-scan-reliability-ui';
const [port]=(await readFile(directory+'/DevToolsActivePort','utf8')).trim().split('\n');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map(),checks=[],errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)});
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++seq,{resolve,reject});ws.send(JSON.stringify({id:seq,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await pause(100);}throw Error('Timeout '+expression)};
const click=async label=>{await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(label)})?.click()`);await pause(100)};
const check=async(name,expression)=>{const pass=!!await ev(expression);checks.push({name,pass});if(!pass)throw Error(name)};
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});
try {
  for(const width of [320,390,1365]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<500});
    await call('Page.navigate',{url:'http://127.0.0.1:5251/'});await wait("document.body.innerText.includes('1 import(s) incomplet(s)')");
    await ev("document.querySelector('details').open=true");
    await check(`Only unassociated carton listed at ${width}`,"document.body.innerText.includes('BR1986')&&!document.body.innerText.includes('BR1987')");
    await check(`Pending import references visible at ${width}`,"document.body.innerText.includes('BR1999')&&document.body.innerText.includes('2/3 références confirmées')");
    await check(`No horizontal overflow at ${width}`,"document.documentElement.scrollWidth<=innerWidth+1");
    await click('Associer les étiquettes');await wait("!!document.querySelector('[role=dialog]')");
    await check(`Carton prefilled at ${width}`,"document.querySelector('[role=dialog] input').value==='BR1986'");
    if(width===390){await mkdir(output,{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(output+'/association-390.png',Buffer.from(shot.data,'base64'));}
  }
  await call('Page.navigate',{url:'http://127.0.0.1:5251/?journal'});await wait("document.body.innerText.includes('BR1986 — Code non retrouvé')");
  await check('Accepted control is not counted as an error',"document.querySelectorAll('button').length>0&&document.body.innerText.includes('scan.not_found')&&!document.body.innerText.includes('scan.verified')");
  await ev("[...document.querySelectorAll('button')].find(b=>b.innerText.includes('BR1986 — Code non retrouvé')).click()");
  await check('Office can see the subsequent recovery',"document.body.innerText.includes('Scan accepté ensuite')");
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Page.navigate',{url:'http://127.0.0.1:5251/?claim'});await wait("!!document.querySelector('input')");
  await ev("document.querySelector('input').focus()");await call('Input.insertText',{text:'BR-UNKNOWN'});await click('OK');
  await wait("document.body.innerText.includes('codes introuvables')");
  await click('Création exceptionnelle');await wait("document.body.innerText.includes('J’ai vérifié avec le bureau')");
  await check('Exceptional creation requires the declared office check',"[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Créer et prendre en charge')).disabled");
  await check('No parcel creation happened during diagnostic controls',"!window.calls.some(c=>c.name==='create')");
  checks.push({name:'No uncaught browser exception',pass:errors.length===0});
} finally {
  await mkdir(output,{recursive:true});await writeFile(output+'/scan-import-ui.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
  await call('Page.close');ws.close();
}
if(checks.some(check=>!check.pass)||errors.length)process.exitCode=1;
