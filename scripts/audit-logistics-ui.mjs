// Real import UI with the repository's synthetic reliability fixture (port 5250).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as XLSX from 'xlsx';
const output = '/private/tmp/fleet-logistics-ui';
await mkdir(output, { recursive: true });
const [port] = (await readFile('/private/tmp/fleet-logistics-browser/DevToolsActivePort', 'utf8')).trim().split('\n');
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map(), checks = [], errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { const promise = pending.get(message.id); if (promise) { pending.delete(message.id); message.error ? promise.reject(message.error) : promise.resolve(message.result); } }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
});
const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description); return result.result.value; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async expression => { for (let n = 0; n < 100; n++) { if (await ev(expression)) return; await pause(100); } throw Error('Timeout ' + expression); };
const row = { 'Numéro de colis': 'BR-AUDIT-001', Destinataire: 'Pharmacie fictive', Adresse: '1 rue Fictive 97400 Saint-Denis', Téléphone: '0262000000' };
await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');
await call('Network.setBlockedURLs', { urls: ['*://*.googleapis.com/*', '*://*.firebaseio.com/*', '*://*.cloudfunctions.net/*', '*://*.run.app/*'] });
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
try {
  for (const code of ['BR-AUDIT-001', 'EXP-A/0042', '000012345678']) {
    const file = output + '/synthetic.xlsx', book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ ...row, 'Numéro de colis': code }]), 'Audit fictif');
    await writeFile(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
    await call('Page.navigate', { url: 'http://127.0.0.1:5250/?case=import' });
    await wait("!!document.querySelector('input[type=file]')");
    const { root } = await call('DOM.getDocument');
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
    await call('DOM.setFileInputFiles', { nodeId, files: [file] });
    await wait("document.body.innerText.includes('Ligne 2')");
    const state = await ev("({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1,calls:window.calls.length})");
    const rejected = state.text.includes('doit commencer par BR');
    if (code.startsWith('BR') ? rejected || !state.text.includes('Prêt à importer') : !rejected) throw Error('Unexpected import result for ' + code);
    checks.push({ code, rejected, productionWrites: state.calls, horizontalOverflow: state.overflow });
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(output + '/' + (code.startsWith('BR') ? 'br-accepted' : code.startsWith('EXP') ? 'other-sender-rejected' : 'numeric-rejected') + '.png', Buffer.from(shot.data, 'base64'));
  }
  await writeFile(output + '/results.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await call('Page.close'); ws.close(); }
