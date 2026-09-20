import { readFile, writeFile, mkdir } from "node:fs/promises";
const [port] = (
  await readFile("/tmp/fleet-voting-browser/DevToolsActivePort", "utf8")
)
  .trim()
  .split("\n");
const tab = await (
  await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: "PUT",
  })
).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map(),
  checks = [],
  exceptions = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      m.error ? p.reject(m.error) : p.resolve(m.result);
    }
  }
  if (m.method === "Runtime.exceptionThrown")
    exceptions.push(
      m.params.exceptionDetails.exception?.description ||
        m.params.exceptionDetails.text,
    );
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const r = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    throw Error(
      r.exceptionDetails.exception?.description || r.exceptionDetails.text,
    );
  return r.result.value;
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (e) => {
  for (let n = 0; n < 100; n++) {
    if (await ev(e)) return;
    await pause(100);
  }
  throw Error("Timeout " + e);
};
const check = async (name, e) => checks.push({ name, pass: !!(await ev(e)) });
const click = async (text) => {
  await ev(
    `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing');b.click()})()`,
  );
  await pause(60);
};
const input = async (label, value) => {
  await ev(
    `(()=>{const el=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input,textarea');if(!el)throw Error('Input missing');el.focus();el.select()})()`,
  );
  await call("Input.insertText", { text: value });
  await pause(30);
};
const navigate = async (query, width = 390) => {
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height: 844,
    deviceScaleFactor: 1,
    mobile: width < 640,
  });
  const params = new URLSearchParams(query);
  if (params.has("direct")) params.set("vote", "fixture-vote");
  params.delete("direct");
  await call("Page.navigate", { url: "http://127.0.0.1:5249/votes?" + params });
  await wait(
    `window.poll&&document.body.innerText.includes('Choisir notre réunion')&&!document.body.innerText.includes('Chargement des scrutins')`,
  );
};
await call("Runtime.enable");
await call("Page.enable");
await call("Network.enable");
await call("Network.setBlockedURLs", {
  urls: [
    "*://*.googleapis.com/*",
    "*://*.firebaseio.com/*",
    "*://*.cloudfunctions.net/*",
    "*://*.run.app/*",
  ],
});
const gate = async (query = "", width = 390) => {
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height: 844,
    deviceScaleFactor: 1,
    mobile: width < 640,
  });
  await call("Page.navigate", {
    url: "http://127.0.0.1:5249/missions?role=employee&gate=1&" + query,
  });
  await wait(
    "window.poll&&document.body.innerText.includes('Page métier fictive')&&window.calls.some(c=>c.action==='pending')",
  );
  await pause(150);
};
const topTitle = () =>
  ev(
    `(()=>{const d=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(d=>!d.closest('[inert]'));return d.at(-1)?.innerText||''})()`,
  );
const assertCheck = async (name, condition) => {
  await check(name, condition);
  if (!checks.at(-1).pass) throw Error(name);
};
try {
  for (const width of [320, 390, 1365]) {
    await gate("block=1", width);
    await wait("document.body.innerText.includes('Un vote vous attend')");
    await assertCheck(
      "Priority vote is above blocking documents " + width,
      `[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(d=>!d.closest('[inert]')).every(d=>d.innerText.includes('Un vote vous attend'))&&document.activeElement.closest('[role=alertdialog]')?.innerText.includes('Un vote vous attend')`,
    );
    await assertCheck(
      "Secret voting explanation separates participation and choice " + width,
      `document.body.innerText.includes('Votre choix n’est pas enregistré avec votre nom')&&document.body.innerText.includes('sans accès à leur choix individuel')`,
    );
    await assertCheck(
      "Priority prompt fits mobile and desktop " + width,
      `document.documentElement.scrollWidth===innerWidth`,
    );
    await ev(
      "document.querySelector('[role=alertdialog] button[aria-label=Fermer]').click()",
    );
    await wait("document.body.innerText.includes('Continuer sans voter ?')");
    await assertCheck(
      "Closing first opens a warning without recording anything " + width,
      `!window.calls.some(c=>['cast','dismiss'].includes(c.action))&&document.body.innerText.includes('Aucun bulletin, y compris blanc')&&document.body.innerText.includes('Vous pourrez revenir')`,
    );
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
    });
    await assertCheck(
      "Escape cannot bypass the non-participation warning " + width,
      `document.body.innerText.includes('Continuer sans voter ?')&&!window.calls.some(c=>c.action==='dismiss')`,
    );
    await ev("window.holdDismiss=true");
    await click("Confirmer : continuer sans voter");
    await click("Enregistrement…");
    await assertCheck(
      "One dismissal request and no premature close " + width,
      `window.calls.filter(c=>c.action==='dismiss').length===1&&document.body.innerText.includes('Continuer sans voter ?')&&!window.calls.some(c=>c.action==='cast')`,
    );
    await ev("window.releaseDismiss()");
    await wait("!document.body.innerText.includes('Continuer sans voter ?')");
    await assertCheck(
      "Business work resumes after confirmed non-participation " + width,
      `document.body.innerText.includes('Documents obligatoires fictifs')&&!document.body.innerText.includes('Un vote vous attend')&&!window.calls.some(c=>c.action==='cast')`,
    );
  }
  await gate();
  await ev("window.showBlock()");
  await pause(100);
  await assertCheck(
    "A later document modal cannot steal priority or focus",
    `document.activeElement.closest('[role=alertdialog]')?.innerText.includes('Un vote vous attend')&&[...document.querySelectorAll('[role=dialog]')].every(d=>!!d.closest('[inert]'))`,
  );
  await click("Passer au vote");
  await wait("!!document.querySelector('input[name=ballot]')");
  await assertCheck(
    "Primary action opens the actual ballot at a native deep link",
    `location.pathname==='/votes'&&new URLSearchParams(location.search).get('vote')==='fixture-vote'&&!document.querySelector('[role=alertdialog]')&&!document.body.innerText.includes('Documents obligatoires fictifs')`,
  );
  await ev("document.querySelector('input[name=ballot]').click()");
  await click("Vérifier puis confirmer mon vote");
  await click("Confirmer mon vote");
  await wait("document.body.innerText.includes('Votre vote est enregistré')");
  await ev("history.back()");
  await wait("document.body.innerText.includes('Page métier fictive')");
  await assertCheck(
    "A recorded ballot suppresses the priority reminder",
    `!document.body.innerText.includes('Un vote vous attend')&&window.calls.filter(c=>c.action==='cast').length===1`,
  );
  await gate("dirty=1");
  await click("Passer au vote");
  await wait("document.body.innerText.includes('Abandonner cette saisie ?')");
  await assertCheck(
    "Unsaved work confirmation remains above the priority invitation",
    `document.activeElement.closest('[role=alertdialog]')?.innerText.includes('Abandonner cette saisie ?')`,
  );
  await click("Continuer la saisie");
  await assertCheck(
    "Cancelling navigation keeps the draft and invitation",
    `location.pathname==='/missions'&&document.querySelector('input').value==='Brouillon fictif'&&document.body.innerText.includes('Un vote vous attend')`,
  );
  await click("Passer au vote");
  await click("Abandonner la saisie");
  await wait("!!document.querySelector('input[name=ballot]')");
  await assertCheck(
    "Accepting the warning opens the ballot",
    `location.pathname==='/votes'`,
  );
  await gate("busy=1");
  await click("Passer au vote");
  await wait("document.body.innerText.includes('Opération en cours')");
  await click("Continuer ici");
  await assertCheck(
    "An ongoing business write is protected from navigation",
    `location.pathname==='/missions'&&!document.querySelector('input[name=ballot]')`,
  );
  await gate("privacy=nominal");
  await assertCheck(
    "Legacy nominal polls never receive the secrecy promise",
    `document.body.innerText.includes('votre choix sera visible par la direction')&&!document.body.innerText.includes('Votre choix n’est pas enregistré avec votre nom')`,
  );
  await gate();
  await click("Continuer sans voter");
  await ev("window.failDismiss=true");
  await click("Confirmer : continuer sans voter");
  await wait(
    "document.body.innerText.includes('La fermeture n’a pas été confirmée')",
  );
  await assertCheck(
    "A failed dismissal stays explicit and does not create a ballot",
    `document.body.innerText.includes('Continuer sans voter ?')&&!window.calls.some(c=>c.action==='cast')`,
  );
  await click("Fermer le rappel pour cette session");
  await assertCheck(
    "A network failure does not trap the user in the reminder",
    `!document.querySelector('[role=alertdialog]')&&document.body.innerText.includes('Page métier fictive')`,
  );
  await gate();
  await ev(
    "window.pendingPolls=[window.poll,{...window.poll,id:'second-vote',title:'Deuxième consultation fictive'}]",
  );
  await click("Continuer sans voter");
  await click("Confirmer : continuer sans voter");
  await wait(
    "document.body.innerText.includes('Deuxième consultation fictive')",
  );
  await assertCheck(
    "The next eligible vote appears after dismissing the first",
    `window.calls.filter(c=>c.action==='dismiss').length===1&&!window.calls.some(c=>c.action==='cast')`,
  );
  await pause(350);
  await assertCheck(
    "The next invitation is interactive above every backdrop",
    `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Passer au vote');const r=b.getBoundingClientRect();return !b.closest('[inert]')&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b})()`,
  );
  const shot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "docs/validation/voting/priority-390.png",
    Buffer.from(shot.data, "base64"),
  );
  await gate("scenario=closed");
  await assertCheck(
    "Closed votes do not interrupt work",
    `!document.querySelector('[role=alertdialog]')`,
  );
  checks.push({ name: "No runtime exception", pass: exceptions.length === 0 });
  await writeFile(
    "docs/validation/voting/priority-browser.json",
    JSON.stringify({ checks, exceptions }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ checks, exceptions }, null, 2));
  if (checks.some((c) => !c.pass)) process.exitCode = 1;
} finally {
  await call("Page.close");
  ws.close();
}
