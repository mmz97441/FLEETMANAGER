import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const out=fileURLToPath(new URL('../../docs/validation/ui18/root/',import.meta.url));
await mkdir(out,{recursive:true});
const [port]=(await readFile(join(process.env.FLEET_UI18_CHROME_PROFILE || join(tmpdir(),'fleet-ui18-root-browser'),'DevToolsActivePort'),'utf8')).trim().split('\n');
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map(),exceptions=[],checks=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}if(m.method==='Page.javascriptDialogOpening')ws.send(JSON.stringify({id:++id,method:'Page.handleJavaScriptDialog',params:{accept:true}}));if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)});
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const check=(name,value)=>checks.push({name,pass:!!value});
const click=async selector=>{await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el?.focus();el?.click()})()`);await pause(80)};
const key=async (key,shift=false)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Tab'?9:27,modifiers:shift?8:0});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});await pause(80)};
const navigate=async mode=>{await ev(`try{sessionStorage.setItem('fixtureMode',${JSON.stringify(mode)})}catch{}`);await call('Page.navigate',{url:'http://127.0.0.1:5244/?fixture='+mode});await pause(1400)};
const type=async(selector,text)=>{await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);await call('Input.insertText',{text});await pause(50)};
const screenshot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`${out}/shared-${name}.png`,Buffer.from(r.data,'base64'))};
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});

const wait=async expr=>{for(let i=0;i<100;i++){if(await ev(expr))return;await pause(100)}throw new Error('Timeout '+expr)};
const pressText=async text=>{await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)})?.click()`);await pause(160)};
try{
await call('Emulation.setDeviceMetricsOverride',{width:1365,height:900,deviceScaleFactor:1,mobile:false});await navigate('app');
await wait(`document.body.innerText.includes('Vue fictive Dashboard')`);
await ev(`history.pushState({},'', '/missions');window.dispatchEvent(new PopStateEvent('popstate',{state:history.state}))`);await wait(`!!document.querySelector('#draft-opener')`);await click('#draft-opener');await type('#navigation-draft','Saisie à conserver');
await ev('history.back()');await wait(`!!document.querySelector('[role=alertdialog]')`);
check('Back attend confirmation sans changer la vue',await ev(`location.pathname==='/missions'&&document.querySelector('#navigation-draft').value==='Saisie à conserver'`));
check('Confirmation focus interne',await ev(`!!document.activeElement.closest('[role=alertdialog]')`));
await screenshot('retour-demande-confirmation');await pressText('Continuer la saisie');
check('Back annulé conserve URL et brouillon',await ev(`location.pathname==='/missions'&&document.querySelector('#navigation-draft').value==='Saisie à conserver'&&!document.querySelector('[role=alertdialog]')`));
await ev('history.back()');await wait(`!!document.querySelector('[role=alertdialog]')`);await pressText('Abandonner la saisie');await wait(`location.pathname==='/'&&document.body.innerText.includes('Vue fictive Dashboard')`);check('Back accepté change réellement la vue',true);
await ev('history.forward()');await wait(`!!document.querySelector('#draft-opener')`);check('Forward conservé',await ev(`location.pathname==='/missions'`));await click('#draft-opener');await type('#navigation-draft','Deuxième brouillon');
await pressText('Aide & Support');await wait(`!!document.querySelector('[role=alertdialog]')`);await pressText('Continuer la saisie');check('Navigation du menu protégée',await ev(`location.pathname==='/missions'&&document.querySelector('#navigation-draft').value==='Deuxième brouillon'`));
await click('#busy-action');await ev('history.back()');await wait(`!!document.querySelector('[role=alertdialog]')`);check('Envoi en cours ne propose pas abandon',await ev(`document.querySelector('[role=alertdialog]').innerText.includes('Opération en cours')&&!document.querySelector('[role=alertdialog]').innerText.includes('Abandonner')`));await pressText('Rester sur cet écran');check('Envoi conservé',await ev(`document.querySelector('[role=dialog]')?.getAttribute('aria-busy')==='true'&&location.pathname==='/missions'`));await click('#busy-action');
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await ev('history.back()');await wait(`!!document.querySelector('[role=alertdialog]')`);check('Confirmation mobile sans débordement',await ev('document.documentElement.scrollWidth===innerWidth'));await screenshot('retour-mobile');await pressText('Continuer la saisie');
await ev(`document.querySelector('[role=dialog] button[aria-label="Fermer"]').click()`);await wait(`!!document.querySelector('[role=alertdialog]')`);await pressText('Abandonner la saisie');check('Fermeture normale reste protégée',await ev(`!document.querySelector('[role=dialog]')`));
}catch(error){checks.push({name:'probe-error',pass:false,error:error.stack,body:await ev('document.body.innerText.slice(0,1200)')})}
await writeFile(`${out}/navigation-browser.json`,JSON.stringify({checkedAt:new Date().toISOString(),checks,exceptions},null,2));console.log(JSON.stringify({checks,exceptions},null,2));await call('Page.close');ws.close();if(checks.some(c=>!c.pass)||exceptions.length)process.exitCode=1;
