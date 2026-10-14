import { readFile, writeFile, mkdir } from 'node:fs/promises';
const output = new URL('../docs/validation/app-updates-4-37/', import.meta.url); await mkdir(output, { recursive: true });
const [port] = (await readFile('/private/tmp/fleet-app-update-browser/DevToolsActivePort', 'utf8')).trim().split('\n');
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let seq = 0; const pending = new Map(), checks = [], errors = [], externalRequests = [], dialogs = [];
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request?.reject(message.error) : request?.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if (message.method === 'Page.javascriptDialogOpening') { dialogs.push(message.params.type); ws.send(JSON.stringify({ id: ++seq, method: 'Page.handleJavaScriptDialog', params: { accept: true } })); }
  if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url) && !message.params.request.url.startsWith('http://127.0.0.1:5258/') && !message.params.request.url.startsWith('https://fonts.googleapis.com/')) externalRequests.push(message.params.request.url);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 20_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description); return result.result.value; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async expression => { for (let n = 0; n < 100; n++) { try { if (await ev('!!document.body && (' + expression + ')')) return; } catch (error) { if (!/context|Cannot read|not a function/.test(String(error))) throw error; } await pause(100); } throw Error('Timeout ' + expression); };
const check = async (name, expression) => { const pass = !!await ev(expression); checks.push({ name, pass }); if (!pass) throw Error(name); };
const click = async selector => { await ev(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button||button.disabled)throw Error('Missing/disabled '+${JSON.stringify(selector)});button.click()})()`); await pause(100); };
const screenshot = async name => { await pause(400); const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(new URL('gate-' + name + '.png', output), Buffer.from(result.data, 'base64')); };
const gate = '[data-testid="mandatory-app-update"]';
const width = (width, height = 844) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
const navigate = async mode => { await call('Page.navigate', { url: `http://127.0.0.1:5258/?case=${mode}` }); await wait(`window.mode===${JSON.stringify(mode)}&&typeof window.checkUpdate==='function'&&!window.getVersion().checking`); };
const requireUpdate = async () => { await ev('window.setTarget(window.futureVersion);window.checkUpdate()'); };
const rollback = async () => { await ev('window.setTarget(window.currentVersion);window.checkUpdate()'); await wait(`!document.querySelector('${gate}')`); };
await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');
await call('Network.setBlockedURLs', { urls: ['*://*.googleapis.com/*', '*://*.firebaseio.com/*', '*://*.cloudfunctions.net/*', '*://*.run.app/*'] });
await call('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5258', storageTypes: 'all' });
try {
  await navigate('plain');
  await ev('window.seedPending()');
  await check('A pending delivery with its original photo and signature is durable before any update', '(async()=>{const rows=await window.getPending();return rows.length===1&&rows[0].proof.photosBase64[0].startsWith("data:")&&rows[0].proof.signatureBase64.startsWith("data:")})()');
  for (const viewport of [320, 390, 1440]) {
    await width(viewport, viewport === 1440 ? 900 : 844); await requireUpdate(); await wait(`!!document.querySelector('${gate}')`);
    const boot = await ev('window.boots');
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1, button: 'left', clickCount: 1 });
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' }); await pause(250);
    await check(`Mandatory gate cannot be dismissed or tabbed around at ${viewport}px`, `!!document.querySelector('${gate}')&&document.getElementById('root').inert&&document.activeElement.closest('${gate}')&&!document.querySelector('${gate} [aria-label="Fermer"]')`);
    await check(`No automatic reload and no horizontal overflow at ${viewport}px`, `window.boots===${boot}&&document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('${gate} button').getBoundingClientRect().height>=44`);
    await screenshot('mandatory-' + viewport); await rollback();
    await check(`A verified rollback reopens the current build without reloading at ${viewport}px`, `window.boots===${boot}&&!document.getElementById('root').inert`);
  }
  await width(390); await requireUpdate(); await wait(`!!document.querySelector('${gate}')`);
  const offlineBoot = await ev('window.boots');
  await ev("window.offline=true;window.dispatchEvent(new Event('offline'));window.checkUpdate()");
  await check('Offline known requirement remains blocking and offers no destructive reload', `!!document.querySelector('${gate}')&&document.querySelector('${gate} button').disabled&&window.getVersion().available&&document.body.innerText.includes('Reconnectez-vous')&&window.boots===${offlineBoot}`);
  await screenshot('offline-required');
  await ev("window.offline=false;window.manifestFailure=true;window.dispatchEvent(new Event('online'))"); await wait('!window.getVersion().checking');
  await click(gate + ' button');
  await check('A failed install verification keeps the gate and local proofs', `!!document.querySelector('${gate} [role="alert"]')&&window.boots===${offlineBoot}&&window.getVersion().available`);
  await ev('window.manifestFailure=false;window.setTarget(window.currentVersion)'); await click(gate + ' button'); await wait(`!document.querySelector('${gate}')`);
  await check('Explicit retry accepts a recovered server rollback without a reload', `window.boots===${offlineBoot}&&!window.getVersion().available`);

  await ev('window.startBackground()'); await wait("typeof window.releaseUpload==='function'"); await requireUpdate();
  await check('A real outbox upload already in progress defers entry to the gate', `window.getSafety().busy&&!document.querySelector('${gate}')&&!!document.querySelector('[data-testid="update-deferred"]')`);
  await ev('window.holdUpload=false;window.releaseUpload();window.background'); await wait(`!!document.querySelector('${gate}')`);
  await ev('window.releaseUpload=undefined;window.startBackground()'); await wait("typeof window.releaseUpload==='function'");
  await check('An upload starting after entry disables installation while keeping the gate', `!!document.querySelector('${gate}')&&document.querySelector('${gate} button').disabled&&document.body.innerText.includes('Envoi en cours')`);
  await screenshot('upload-blocks-install');
  await ev('window.holdUpload=false;window.releaseUpload();window.background'); await wait(`!document.querySelector('${gate} button').disabled`); await rollback();

  await navigate('editing'); await wait("!!document.querySelector('input[type=file]')&&!document.querySelector('fieldset').disabled");
  await ev(`(()=>{const select=document.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'hub-fixture');select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait("!document.querySelector('fieldset').disabled");
  await ev(`(()=>{const input=document.querySelector('input[type=file]');const canvas=document.createElement('canvas');canvas.width=12;canvas.height=12;canvas.getContext('2d').fillRect(0,0,12,12);return new Promise(resolve=>canvas.toBlob(blob=>{const dt=new DataTransfer();dt.items.add(new File([blob],'preuve-fictive.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));resolve(true)}))})()`);
  await wait("!!document.querySelector('img[alt^=\"Carton au dépôt\"]')&&!document.querySelector('fieldset').disabled");
  const draftPhoto = await ev('(async()=> (await window.getDraft()).photos[0])()');
  await requireUpdate();
  await check('A captured photo and open return form remain usable when the new version arrives', `!document.querySelector('${gate}')&&window.getSafety().active&&!document.querySelector('input[type=file]').closest('[inert]')&&!!document.querySelector('img[alt^="Carton au dépôt"]')`);
  await screenshot('photo-preserved-before-update');
  await click('[role="dialog"] button[aria-label="Fermer"]'); await wait(`!!document.querySelector('${gate}')`);
  const installBoot = await ev('window.boots');
  await click(gate + ' button'); await wait(`window.boots===${installBoot + 1}&&typeof window.getDraft==='function'`);
  await check('An explicit install reload preserves the exact return photo and pending delivery proof', `(async()=>{const draft=await window.getDraft(),pending=await window.getPending();return draft.photos[0]===${JSON.stringify(draftPhoto)}&&draft.hubId==='hub-fixture'&&pending.length===1&&pending[0].proof.photosBase64[0].startsWith('data:')&&pending[0].proof.signatureBase64.startsWith('data:')})()`);

  await navigate('restore'); await wait(`!!document.querySelector('${gate}')`);
  await check('The gate can enter before a later Suspense sibling finishes mounting', `!!document.querySelector('${gate}')&&!document.querySelector('input[type=file]')`);
  await wait("!!document.querySelector('img[alt^=\"Carton au dépôt\"]')");
  await check('A later Suspense sibling restoring a form releases the earlier gate without deadlock', `!document.querySelector('${gate}')&&window.getSafety().active&&!document.querySelector('input[type=file]').closest('[inert]')&&!!document.activeElement.closest('[role="dialog"]')`);
  await screenshot('late-restored-sibling');
  await click('[role="dialog"] button[aria-label="Fermer"]'); await wait(`!!document.querySelector('${gate}')`);
  await check('The mandatory gate resumes once the restored form closes', `!!document.querySelector('${gate}')&&!window.getSafety().active`);
  await rollback(); await ev('window.setTarget(window.futureVersion)'); await navigate('office'); await width(320);
  await wait("document.body.innerText.includes('Version publiée : 4.99.0')");
  await click('summary');
  await check('Office sees server target and outdated device without a mandatory driver gate', `!document.querySelector('${gate}')&&document.body.innerText.includes('Mise à jour requise')&&document.body.innerText.includes('4.32.0')&&document.documentElement.scrollWidth<=innerWidth+1`);
  await check('Office status and app layout share one manifest request', "window.calls.filter(call=>call.name==='manifest').length===1");
  await screenshot('office-status-320');
} catch (error) {
  await screenshot('failure'); await writeFile(new URL('gate-failure.txt', output), await ev('document.body.innerText')); throw error;
} finally {
  const result = { checks, errors, externalRequests, dialogs };
  await writeFile(new URL('gate-results.json', output), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  await call('Page.close'); ws.close();
}
if (checks.some(check => !check.pass) || errors.length || externalRequests.length || dialogs.length) process.exitCode = 1;
