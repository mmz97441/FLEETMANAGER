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
const screenshot=async name=>{await pause(350);const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`${out}/shared-${name}.png`,Buffer.from(r.data,'base64'))};
await call('Page.bringToFront');await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*://*.googleapis.com/*','*://*.firebaseio.com/*','*://*.cloudfunctions.net/*','*://*.run.app/*']});

const wait=async expr=>{for(let i=0;i<100;i++){if(await ev(expr))return;await pause(100)}throw new Error('Timeout '+expr)};
const pressText=async text=>{await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)})?.click()`);await pause(160)};
try{
for(const width of [320,390,1365]){
 await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<640});
 await call('Page.navigate',{url:'http://127.0.0.1:5244/__gallery'});await wait(`!!document.querySelector('#primary')`);await pause(300);
 check('Galerie sans débordement '+width,await ev('document.documentElement.scrollWidth===innerWidth'));
 check('Actions et champs 44px '+width,await ev(`[...document.querySelectorAll('.ui-button,input:not([type=checkbox])')].every(e=>e.getBoundingClientRect().height>=44)`));
 check('Tableau lisible et adresse entière '+width,await ev(`[...document.querySelectorAll('td,th')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=14)&&[...document.querySelectorAll('td')].some(e=>e.textContent.includes('porte 207')&&getComputedStyle(e).textOverflow!=='ellipsis')`));
 check('Texte de variation neutre '+width,await ev(`getComputedStyle(document.querySelector('#volume svg')).color==='rgb(71, 85, 105)'`));
 check('Aucune variation et volume ne donnent pas de faux succès '+width,await ev(`document.querySelector('#flat').textContent.includes('Stable')&&!document.querySelector('#volume').querySelector('[class*=green]')`));
 check('Compteur neutre exact et compact '+width,await ev(`document.querySelector('#count').textContent==='99+'&&document.querySelector('#count [aria-label]').getAttribute('aria-label').includes('135')&&getComputedStyle(document.querySelector('#count span')).animationName==='none'`));
 if(width<640)check('Titre complet sur ligne dédiée '+width,await ev(`document.querySelector('h1').getBoundingClientRect().right<=innerWidth&&document.querySelector('#open').getBoundingClientRect().top>=document.querySelector('h1').getBoundingClientRect().bottom`));
 await screenshot('galerie-'+width);
}
await ev(`document.querySelector('button[aria-label="Voir le détail : Kilomètres parcourus"]').focus()`);
await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await pause(100);
check('Carte indicateur native activable Entrée',await ev(`window.__calls.includes('stat')`));
check('Focus clavier visible',await ev(`getComputedStyle(document.activeElement).outlineStyle!=='none'&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`));
check('Grand bouton garde taille 48px et texte16',await ev(`document.querySelector('#large').getBoundingClientRect().height>=48&&getComputedStyle(document.querySelector('#large')).fontSize==='16px'`));
check('Chargement bloque activation',await ev(`document.querySelector('#loading').disabled&&document.querySelector('#loading').getAttribute('aria-busy')==='true'&&document.querySelector('#disabled').disabled`));
const contrasts=await ev(`(()=>{function lum(c){const a=c.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722}return ['primary','secondary','danger'].map(id=>{const s=getComputedStyle(document.getElementById(id)),a=lum(s.color),b=lum(s.backgroundColor);return {id,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}});})()`);
checks.push({name:'Contraste texte actions ≥4,5:1',pass:contrasts.every(r=>r.ratio>=4.5),measurements:contrasts});
await call('Emulation.setDeviceMetricsOverride',{width:390,height:420,deviceScaleFactor:1,mobile:true});await click('#open');await wait(`!!document.querySelector('#recipient')`);await pause(350);
check('Formulaire plein écran sur viewport court',await ev(`(()=>{const r=document.querySelector('.ui-dialog-box').getBoundingClientRect();return r.width===390&&Math.abs(r.height-420)<2&&Math.abs(r.top)<2})()`));
check('Champ mobile 16px',await ev(`parseFloat(getComputedStyle(document.querySelector('#recipient')).fontSize)>=16`));
await type('#recipient','Alexandra, saisie à conserver');await click('#save');
check('Envoi occupe la fenêtre sans masquer action',await ev(`document.querySelector('[role=dialog]').getAttribute('aria-busy')==='true'&&document.querySelector('#save').disabled&&document.querySelector('#save').getBoundingClientRect().bottom<=innerHeight`));
await key('Escape');check('Échap pendant envoi conserve saisie',await ev(`document.querySelector('#recipient')?.value==='Alexandra, saisie à conserver'`));await pause(1600);
await pressText('Vérifier');await wait(`document.querySelectorAll('[role=dialog]').length===2`);await click('#nested-close');
check('Fenêtre imbriquée rend le focus au formulaire',await ev(`document.querySelectorAll('[role=dialog]').length===1&&!!document.activeElement.closest('[role=dialog]')&&document.querySelector('#recipient').value.includes('Alexandra')`));
await screenshot('formulaire-390-420');await key('Escape');await wait(`!!document.querySelector('[role=alertdialog]')`);await pressText('Continuer la saisie');check('Annulation conserve brouillon',await ev(`document.querySelector('#recipient').value.includes('Alexandra')`));
await key('Escape');await wait(`!!document.querySelector('[role=alertdialog]')`);await pressText('Abandonner la saisie');check('Fermeture confirmée rend focus au déclencheur',await ev(`!document.querySelector('[role=dialog]')&&document.activeElement.id==='open'`));
await click('button[aria-label^="Notifications"]');await wait(`document.body.innerText.includes('Notification urgent')`);
check('Priorité haute distincte urgence réelle',await ev(`document.querySelector('[role=dialog]').innerText.includes('Prioritaire')&&document.querySelector('[role=dialog]').innerText.includes('Urgent')`));
check('Notifications sans débordement mobile court',await ev(`document.documentElement.scrollWidth===innerWidth&&document.querySelector('[role=dialog]').scrollWidth<=innerWidth`));await screenshot('notifications-390');
await call('Emulation.setDeviceMetricsOverride',{width:1365,height:900,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:'http://127.0.0.1:5244/__gallery?screen=sidebar'});await wait(`document.querySelectorAll('.ui-count').length>0`);
check('Navigation compteurs neutres sans pulsation',await ev(`[...document.querySelectorAll('.ui-count')].every(e=>getComputedStyle(e).animationName==='none'&&!/red|danger|pulse/.test(e.className))`));await screenshot('sidebar');
await call('Page.navigate',{url:'http://127.0.0.1:5244/__gallery?screen=dashboard&month=2026-09'});await wait(`document.body.innerText.includes('Km parcourus')`);await pause(300);
const metrics=await ev(`['Km parcourus','Litres totaux','Carburant par km'].map(label=>{const p=[...document.querySelectorAll('span')].find(e=>e.textContent===label);const card=p?.parentElement.parentElement;const t=card?.querySelector('span.inline-flex');return {label,text:card?.textContent,color:t&&getComputedStyle(t).color}})`);
checks.push({name:'Indicateurs réels distance et volume neutres, coût contextualisé',pass:metrics[0]?.color==='rgb(71, 85, 105)'&&metrics[1]?.color==='rgb(71, 85, 105)'&&metrics[2]?.color==='rgb(22, 101, 52)',measurements:metrics});
await screenshot('dashboard-president');
await call('Page.navigate',{url:'http://127.0.0.1:5244/__gallery?screen=dashboard&month=2026-09&no-baseline=1'});await wait(`document.body.innerText.includes('Comparaison indisponible')`);check('Absence de base précédente ne donne pas Stable ou succès',await ev(`!document.body.innerText.includes('Stable')&&[...document.querySelectorAll('span.inline-flex')].filter(e=>e.textContent.includes('Comparaison indisponible')).every(e=>getComputedStyle(e).color==='rgb(71, 85, 105)')`));await screenshot('dashboard-sans-comparaison');
}catch(error){checks.push({name:'probe-error',pass:false,error:error.stack,body:await ev('document.body.innerText.slice(0,2000)')})}
try {
await call('Emulation.setTimezoneOverride',{timezoneId:'Indian/Reunion'});
for (const [offset,expected,label] of [[-1,'1','hier'],[0,'0','aujourd’hui'],[1,'0','demain']]) {
 await call('Page.navigate',{url:`http://127.0.0.1:5244/__gallery?screen=dashboard&ct-offset=${offset}`});
 await wait(`document.body.innerText.includes('CT expirés')`);
 const count=await ev(`[...document.querySelectorAll('span')].find(e=>e.textContent==='CT expirés')?.nextElementSibling?.textContent`);
 checks.push({name:`Dashboard CT ${label} selon jour local Réunion`,pass:count===expected,actual:count,expected});
}
} catch(error) { checks.push({name:'calendar-probe-error',pass:false,error:error.stack}); }
await writeFile(`${out}/contracts-browser.json`,JSON.stringify({checkedAt:new Date().toISOString(),checks,exceptions},null,2));console.log(JSON.stringify({checks,exceptions},null,2));await call('Page.close');ws.close();if(checks.some(c=>!c.pass)||exceptions.length)process.exitCode=1;
