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
await mkdir("docs/validation/voting", { recursive: true });
try {
  await navigate("role=employee");
  await check(
    "Votes list renders without a Router provider at the real /votes path",
    `location.pathname==='/votes'&&!location.search.includes('vote=')&&document.body.innerText.includes('Votes des salariés')`,
  );
  await click("Comprendre et voter");
  await wait(`!!document.querySelector('input[name=ballot]')`);
  await check(
    "Opening a vote updates the native URL and preserves other parameters",
    `new URLSearchParams(location.search).get('vote')==='fixture-vote'&&new URLSearchParams(location.search).get('role')==='employee'&&!!history.state.__fleetNavigation`,
  );
  await ev("history.back()");
  await wait(`!document.querySelector('input[name=ballot]')&&document.body.innerText.includes('Votes des salariés')`);
  await check("Browser Back restores the list", `!new URLSearchParams(location.search).has('vote')`);
  await ev("history.forward()");
  await wait(`!!document.querySelector('input[name=ballot]')`);
  await check("Browser Forward restores the selected vote", `new URLSearchParams(location.search).get('vote')==='fixture-vote'`);
  await click("Tous les scrutins");
  await wait(`!document.querySelector('input[name=ballot]')&&document.body.innerText.includes('Votes des salariés')`);
  await check("Return to all votes clears only the vote parameter", `location.pathname==='/votes'&&location.search==='?role=employee'`);
  await ev(`history.pushState(history.state,'','/votes?role=employee&vote=fixture-vote');window.dispatchEvent(new Event('fleet-url-change'))`);
  await wait(`!!document.querySelector('input[name=ballot]')`);
  await check("Application navigation event opens the selected vote", `window.calls.some(c=>c.action==='get'&&c.id==='fixture-vote')`);
  await ev("window.beforeReload=true");
  await call("Page.reload");
  await wait(`!window.beforeReload&&window.poll&&!!document.querySelector('input[name=ballot]')`);
  await check("Reload preserves the direct link and ballot", `new URLSearchParams(location.search).get('vote')==='fixture-vote'&&document.body.innerText.includes('Pourquoi vote-t-on')`);
  for (const width of [320, 390, 1365]) {
    await navigate("role=employee&direct=1", width);
    await check(
      "Worker sees object and privacy before voting " + width,
      `document.body.innerText.includes('Pourquoi vote-t-on')&&document.body.innerText.includes('Vote secret')&&!document.body.innerText.includes('Gestion du scrutin')`,
    );
    await check(
      "No page overflow " + width,
      `document.documentElement.scrollWidth===innerWidth`,
    );
    await ev(
      `document.querySelector('input[name=ballot]').click();window.holdCast=true`,
    );
    await click("Vérifier puis confirmer mon vote");
    await check(
      "Confirmation repeats selected choice " + width,
      `document.querySelector('[role=alertdialog]').innerText.includes('Le matin')&&document.querySelector('[role=alertdialog]').innerText.includes('ne pourrez plus')`,
    );
    await click("Confirmer mon vote");
    await click("Enregistrement…");
    await check(
      "Double tap produces one request and no premature confirmation " + width,
      `window.calls.filter(x=>x.action==='cast').length===1&&!document.body.innerText.includes('Votre vote est enregistré')`,
    );
    await ev("window.releaseCast()");
    await wait(`document.body.innerText.includes('Votre vote est enregistré')`);
    await check(
      "Receipt shown and second vote removed " + width,
      `document.body.innerText.includes('confirmation-fictive')&&!document.querySelector('input[name=ballot]')`,
    );
    const shot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(
      "docs/validation/voting/employee-" + width + ".png",
      Buffer.from(shot.data, "base64"),
    );
  }
  await navigate("role=employee&scenario=scheduled&direct=1");
  await check(
    "Scheduled elector initially sees opening time",
    `document.body.innerText.includes('Le vote n’a pas encore commencé')&&!document.querySelector('input[name=ballot]')`,
  );
  await wait(`!!document.querySelector('input[name=ballot]')`);
  await check(
    "Ballot opens automatically without classifying elector as observer",
    `document.body.innerText.includes('Votre bulletin')&&!document.body.innerText.includes('Vous participez en consultation')`,
  );
  await navigate("role=observer&direct=1");
  await check(
    "Observer can read but has no ballot",
    `document.body.innerText.includes('Vous participez en consultation')&&!document.querySelector('input[name=ballot]')`,
  );
  await navigate("role=employee&privacy=nominal&direct=1");
  await check(
    "Nominal privacy is explicit before choice",
    `document.body.innerText.includes('Vote nominatif')&&document.body.innerText.includes('visible par la direction')`,
  );
  await navigate("role=manager&scenario=draft&direct=1");
  await check(
    "Manager can review eligibility before publishing",
    `document.body.innerText.includes('Vérifier les participants')&&document.body.innerText.includes('Publier le scrutin')`,
  );
  await ev(
    `const file=new File(['%PDF-fictif'],'note-fictive.pdf',{type:'application/pdf'});const dt=new DataTransfer();dt.items.add(file);const el=document.querySelector('input[type=file]');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await click("Ajouter le document");
  await wait(`window.calls.some(c=>c.action==='attach')`);
  await check(
    "Selected attachment survives rerender and is submitted",
    `window.calls.find(c=>c.action==='attach').name==='note-fictive.pdf'&&document.body.innerText.includes('note-fictive.pdf')`,
  );
  await click("Publier le scrutin");
  await click("Confirmer");
  await wait(
    `document.body.innerText.includes('Clôturer et voir les résultats')`,
  );
  await check(
    "Published rules cannot be edited",
    `!document.body.innerText.includes('Modifier le brouillon')&&!document.body.innerText.includes('Résultats et procès-verbal')`,
  );
  await click("Clôturer et voir les résultats");
  await input("Motif obligatoire", "Clôture anticipée fictive");
  await click("Confirmer");
  await wait(`document.body.innerText.includes('Résultats et procès-verbal')`);
  await input("Présidence du scrutin", "Alice Fictive");
  await input("Secrétaire du scrutin", "Bruno Fictif");
  await input("Lieu", "La Réunion");
  await input("Observations", "Résultats fictifs constatés pour validation.");
  await click("Finaliser le procès-verbal");
  await click("Confirmer");
  await wait(`document.body.innerText.includes('Télécharger le PV PDF')`);
  await click("Télécharger le PV PDF");
  await wait(`window.downloads.some(d=>d.name.endsWith('.pdf'))`);
  await click("Exporter le tableau CSV");
  await wait(`window.downloads.some(d=>d.name.endsWith('.csv'))`);
  await check(
    "Actual PDF and CSV downloads",
    `window.downloads.some(d=>d.type==='application/pdf'&&d.size>1000)&&window.downloads.some(d=>d.name.endsWith('.csv'))`,
  );
  const pdf = await ev(
    `window.downloads.find(d=>d.name.endsWith('.pdf')).base64`,
  );
  await writeFile(
    "docs/validation/voting/PV-FICTIF.pdf",
    Buffer.from(pdf, "base64"),
  );
  await ev("window.scrollTo(0,document.body.scrollHeight)");
  const shot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "docs/validation/voting/direction-390.png",
    Buffer.from(shot.data, "base64"),
  );
  await navigate("role=manager&scenario=draft");
  await click("Préparer un vote");
  await input("Titre du vote", "Consultation fictive de validation");
  await input(
    "Objet et explications",
    "Choisir un créneau en conservant la logique métier.",
  );
  await input("Question posée", "Quel créneau vous convient ?");
  await click("Enregistrer le brouillon");
  await wait(`window.calls.some(c=>c.action==='save')`);
  await wait(`new URLSearchParams(location.search).get('vote')===window.poll.id&&document.body.innerText.includes('Modifier le brouillon')`);
  await check(
    "Creating a vote opens its saved detail at a shareable native URL",
    `new URLSearchParams(location.search).get('vote')===window.poll.id&&location.pathname==='/votes'&&new URLSearchParams(location.search).get('role')==='manager'`,
  );
  await check(
    "Creation includes selected voters, purpose, rules and dates",
    `(()=>{const d=window.calls.find(c=>c.action==='save').draft;return d.participantIds.length===3&&d.voterIds.length===3&&d.privacy==='secret'&&d.purpose.includes('créneau')&&d.options.length===2&&Date.parse(d.closesAt)>Date.parse(d.opensAt)})()`,
  );
  await navigate("role=secretary&scenario=draft");
  await click("Préparer un vote");
  await input("Titre du vote", "Vote créé par le secrétariat fictif");
  await input("Objet et explications", "Consultation préparée pour l’équipe.");
  await input("Question posée", "Êtes-vous d’accord ?");
  await click("Enregistrer le brouillon");
  await wait(
    `window.calls.some(c=>c.action==='save')&&document.body.innerText.includes('Publier le scrutin')`,
  );
  await check(
    "Secretariat can create and prepare publication",
    `window.poll.canManage&&!window.poll.canViewResults&&document.body.innerText.includes('Modifier le brouillon')`,
  );
  await check(
    "Secretariat uploads briefing documents with participant visibility",
    `!!document.querySelector('input[type=file]')&&!document.querySelector('option[value=direction]')`,
  );
  await click("Publier le scrutin");
  await click("Confirmer");
  await wait(`document.body.innerText.includes('Clôturer le scrutin')`);
  await check(
    "Secretariat can publish without a results access button",
    `window.calls.some(c=>c.action==='publish')&&!document.body.innerText.includes('Clôturer et voir les résultats')`,
  );
  await click("Clôturer le scrutin");
  await input("Motif obligatoire", "Fin de la validation fictive");
  await click("Confirmer");
  await wait(
    `window.poll.status==='closed'&&!document.querySelector('[role=alertdialog]')`,
  );
  await check(
    "Secretariat can close without seeing results or exports",
    `window.calls.some(c=>c.action==='close')&&!document.body.innerText.includes('Résultats et procès-verbal')&&!document.body.innerText.includes('Exporter le tableau CSV')`,
  );
  await navigate("role=secretary&scenario=closed&finalized=1&direct=1");
  await check(
    "Secretariat cannot generate or attach signed minutes",
    `!document.body.innerText.includes('Télécharger le PV PDF')&&!document.body.innerText.includes('Finaliser le procès-verbal')&&!document.querySelector('input[type=file]')`,
  );
  const secretaryShot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "docs/validation/voting/secretariat-390.png",
    Buffer.from(secretaryShot.data, "base64"),
  );
  checks.push({ name: "No runtime exception", pass: exceptions.length === 0 });
  await writeFile(
    "docs/validation/voting/browser.json",
    JSON.stringify({ checks, exceptions }, null, 2),
  );
  console.log(JSON.stringify({ checks, exceptions }, null, 2));
  if (checks.some((c) => !c.pass)) process.exitCode = 1;
} finally {
  await call("Page.close");
  ws.close();
}
