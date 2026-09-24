// Real App/profile screen/map/presence components, synthetic services only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const profile = process.env.FLEET_UI18_CHROME_PROFILE || join(tmpdir(), 'fleet-profile-browser');
const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(), exceptions = [], checks = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const wait = async expr => { for (let i = 0; i < 100; i++) { if (await ev(expr)) return; await pause(100); } throw new Error('Timeout: ' + expr); };
const check = async (name, expr) => { const pass = !!await ev(expr); checks.push({ name, pass }); if (!pass) throw new Error(name); };
const navigate = async (mode, query = '') => {
  await ev(`try{sessionStorage.setItem('fixtureMode',${JSON.stringify(mode)})}catch{}`);
  await call('Page.navigate', { url: `http://127.0.0.1:5244/?fixture=${mode}${query}` });
};
const press = async text => { await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`); };
await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');
await call('Network.setBlockedURLs', { urls: ['*://*.googleapis.com/*', '*://*.firebaseio.com/*', '*://*.cloudfunctions.net/*', '*://*.run.app/*', '*://*.tile.openstreetmap.org/*'] });
await call('Page.bringToFront');
try {
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate('app', '&profile-error=unavailable'); await wait(`document.body.innerText.includes('Votre profil n’a pas pu être chargé')`);
  await check('Read failure offers retry without forced sign-out or misleading missing-profile alert', `!window.__signOuts&&!document.body.innerText.includes('Aucun profil rattaché')&&document.body.innerText.includes('ux@example.invalid')`);
  await check('Recovery screen fits mobile and offers 44px actions', `document.documentElement.scrollWidth===innerWidth&&[...document.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44)`);
  const screenshot = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(join(tmpdir(), 'fleet-profile-retry.png'), Buffer.from(screenshot.data, 'base64'));
  await ev('window.__profileError=null'); await press('Réessayer'); await wait(`document.body.innerText.includes('Vue fictive Dashboard')`);
  await check('Retry restores actual application and presence without changing credentials', `!window.__signOuts&&window.__presenceCalls?.some(c=>c.uid==='UX-ADMIN'&&c.login)`);
  await ev(`window.__fixtureUser.isDisabled=true;window.__setAuth({uid:'UX-ADMIN',email:'ux@example.invalid',getIdTokenResult:async()=>({claims:{auth_time:Date.now()/1000}})})`);
  await wait(`document.body.innerText.includes('Ce compte est désactivé')`);
  await check('Disabled account cannot access application', `!document.body.innerText.includes('Vue fictive Dashboard')`);
  await press('Utiliser un autre compte'); await wait(`document.body.innerText.includes('Se connecter')`);
  await check('Account switch explicitly signs out and returns to login', `window.__signOuts===1&&!document.body.innerText.includes('Ce compte est désactivé')`);
  await navigate('connections'); await wait(`!!document.querySelector('[data-status=online]')`);
  await check('Presence distinguishes online, offline and unknown with preserved connection dates', `document.querySelector('[data-status=online]').innerText.includes('En ligne')&&document.querySelector('[data-status=offline]').innerText.includes('Hors ligne')&&document.querySelector('[data-status=unknown]').innerText.includes('État de connexion inconnu')&&document.body.innerText.includes('23/09/2026')&&!document.body.innerText.includes('Jamais connecté')`);
  await check('Presence display fits narrow screens', `document.documentElement.scrollWidth===innerWidth`);
  await navigate('map'); await wait(`document.body.innerText.includes('Chauffeur présent')`);
  await check('Driver without GPS still shows online status and last connection on map', `document.body.innerText.includes('En ligne')&&document.body.innerText.includes('23/09/2026')&&document.body.innerText.includes('Position indisponible')&&!document.body.innerText.includes('Jamais connecté')`);
  await navigate('map', '&gps-error=1'); await wait(`document.body.innerText.includes('Les positions GPS ne peuvent pas être actualisées')`);
  await check('GPS load error is visible without declaring drivers disconnected', `document.querySelector('[role=alert]')?.textContent.includes('Cela ne signifie pas')&&document.body.innerText.includes('En ligne')`);
} catch (error) { checks.push({ name: 'probe-error', pass: false, error: String(error), body: await ev('document.body.innerText.slice(0,1500)') }); }
const out = new URL('../../docs/validation/profile-session/', import.meta.url); await mkdir(out, { recursive: true });
await writeFile(new URL('browser.json', out), JSON.stringify({ checkedAt: new Date().toISOString(), checks, exceptions }, null, 2) + '\n');
console.log(JSON.stringify({ checks, exceptions }, null, 2));
await call('Page.close'); ws.close(); if (checks.some(c => !c.pass) || exceptions.length) process.exitCode = 1;
