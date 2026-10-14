import { readFile, writeFile, mkdir } from 'node:fs/promises';
const output = '/private/tmp/fleet-dispatch-retry-ui'; await mkdir(output, { recursive: true });
const [port] = (await readFile('/private/tmp/fleet-dispatch-retry-browser/DevToolsActivePort', 'utf8')).trim().split('\n');
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let seq = 0; const pending = new Map(), checks = [], errors = [], externalRequests = [];
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request?.reject(message.error) : request?.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url) && !message.params.request.url.startsWith('http://127.0.0.1:5256/') && !message.params.request.url.startsWith('https://fonts.googleapis.com/')) externalRequests.push(message.params.request.url);
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description); return result.result.value; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async expression => { for (let n = 0; n < 100; n++) { if (await ev('!!document.body && (' + expression + ')')) return; await pause(100); } throw Error('Timeout ' + expression); };
const click = async text => { await ev(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw Error('Missing/disabled '+${JSON.stringify(text)});button.click()})()`); await pause(100); };
const check = async (name, expression) => { const pass = !!await ev(expression); checks.push({ name, pass }); if (!pass) throw Error(name); };
const screenshot = async name => { const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(output + '/' + name + '.png', Buffer.from(result.data, 'base64')); };
await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');
await call('Network.setBlockedURLs', { urls: ['*://*.googleapis.com/*', '*://*.firebaseio.com/*', '*://*.cloudfunctions.net/*', '*://*.run.app/*'] });
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
try {
  await call('Page.navigate', { url: 'http://127.0.0.1:5256/' });
  await wait("document.body.innerText.includes('Sélectionner ce secteur')");
  await click('Sélectionner ce secteur'); await click('2. Planifier'); await click('Optimiser 1 tournée');
  await wait("document.body.innerText.includes('1 tournée optimisée')"); await click('Affecter 1 tournée');
  await wait("window.calls.length===1&&window.parcels.every(p=>p.missionId)&&document.body.innerText.includes('Réponse réseau perdue')");
  await check('Successful server commit removes every package from the available zone', "document.body.innerText.includes('Aucun colis au hub prêt à être affecté')&&window.created.length===1&&window.completed===0");
  await ev("document.querySelector('[role=dialog] button[aria-label=Fermer]').click()");
  await wait("!document.querySelector('[role=dialog]')&&document.body.innerText.includes('Reprendre la confirmation d’affectation')");
  await screenshot('pending-without-zone');
  await click('Reprendre la confirmation d’affectation');
  await wait("!!document.querySelector('[role=dialog]')");
  await click('Affecter 1 tournée'); await wait('window.completed===1');
  await check('Retry sends exactly the original request ID and complete payload', "window.calls.length===2&&!!window.calls[0].requestId&&JSON.stringify(window.calls[0])===JSON.stringify(window.calls[1])");
  await check('A single optimized route is created and confirmed once', 'window.optimizations===1&&window.receipts.size===1&&window.created.length===1&&window.completed===1');
  await check('Successful confirmation clears the pending preparation', "!document.querySelector('[role=dialog]')&&!document.body.innerText.includes('Reprendre la confirmation d’affectation')");
  await check('Mobile confirmation has no horizontal overflow', 'document.documentElement.scrollWidth<=innerWidth+1');
  await screenshot('confirmed-once');
} catch (error) { await screenshot('failure'); await writeFile(output + '/failure.txt', await ev('document.body.innerText')); throw error; }
finally { await writeFile(output + '/results.json', JSON.stringify({ checks, errors, externalRequests }, null, 2)); console.log(JSON.stringify({ checks, errors, externalRequests }, null, 2)); await call('Page.close'); ws.close(); }
if (checks.some(check => !check.pass) || errors.length || externalRequests.length) process.exitCode = 1;
