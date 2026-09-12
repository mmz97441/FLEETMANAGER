import React, { useEffect, useRef, useState, lazy, Suspense } from 'react';
import JsBarcode from 'jsbarcode';
import { Camera, MapPin, Download, Printer, Smartphone } from 'lucide-react';
import { FormInput, FormSelect } from './shared/FormInput';
import { buildDeviceDiagnosticReport, downloadDiagnosticJson, fieldScenarios, initialFieldResults, DiagnosticOutcome } from '../utils/deviceDiagnostic';

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));
const testCode = 'TEST-FLEETGENIUS-0000';

export default function DeviceDiagnostics() {
  const [device, setDevice] = useState('');
  const [role, setRole] = useState('chauffeur');
  const [camera, setCamera] = useState('Non testé');
  const [gps, setGps] = useState('Non testé');
  const [network, setNetwork] = useState(() => navigator.onLine);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [scan, setScan] = useState(false);
  const [print, setPrint] = useState('Non testé');
  const [scanResult, setScanResult] = useState('Non testé');
  const [results, setResults] = useState(initialFieldResults);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const active = useRef(true);
  const cameraRequest = useRef(0);

  useEffect(() => {
    active.current = true;
    const update = () => setNetwork(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { active.current = false; cameraRequest.current += 1; stream.current?.getTracks().forEach(track => track.stop()); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => { if (video.current && cameraRunning) video.current.srcObject = stream.current; }, [cameraRunning]);

  const stopCamera = () => {
    cameraRequest.current += 1;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    setCameraRunning(false); setCameraBusy(false);
  };
  const startCamera = async () => {
    const request = ++cameraRequest.current;
    setCameraBusy(true); setCamera('Demande d’accès à la caméra…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!active.current || request !== cameraRequest.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media; setCameraRunning(true); setCamera('Flux caméra obtenu. Vérifiez visuellement l’image ci-dessous ; aucune image n’est enregistrée.');
    } catch (error) {
      if (active.current && request === cameraRequest.current) setCamera(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Accès refusé. Autorisez la caméra pour ce site dans les réglages du navigateur.' : 'Caméra indisponible. Vérifiez le navigateur et si une autre application utilise la caméra.');
    } finally { if (active.current && request === cameraRequest.current) setCameraBusy(false); }
  };
  const testGps = () => {
    if (!navigator.geolocation) { setGps('Géolocalisation indisponible dans ce navigateur.'); return; }
    setGpsBusy(true); setGps('Recherche de position…');
    navigator.geolocation.getCurrentPosition(position => {
      if (!active.current) return;
      setGps(`Position obtenue. Précision annoncée : ±${Math.round(position.coords.accuracy)} m. Les coordonnées ne sont pas conservées.`); setGpsBusy(false);
    }, error => {
      if (!active.current) return;
      setGps(error.code === 1 ? 'Accès refusé. Vérifiez l’autorisation de localisation de ce site et les réglages système.' : error.code === 3 ? 'Délai dépassé. Réessayez à l’extérieur.' : 'Position indisponible. Réessayez à l’extérieur.'); setGpsBusy(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  const printTest = () => {
    const popup = window.open('', '_blank', 'width=500,height=700');
    if (!popup) { setPrint('Fenêtre bloquée. Autorisez la fenêtre d’impression puis réessayez.'); return; }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, testCode, { format: 'CODE128', width: 2, height: 70, fontSize: 14, margin: 12 });
    popup.document.write(`<!doctype html><html lang="fr"><head><title>Étiquette fictive de diagnostic</title><style>@page{size:100mm 150mm;margin:5mm}body{font-family:Arial,sans-serif;color:#000;margin:0}h1{font-size:20px}svg{width:100%;height:auto}p{font-size:14px}button{padding:12px}@media print{button{display:none}}</style></head><body><h1>TEST — AUCUN COLIS RÉEL</h1><p>Diagnostic FleetGenius. Ne pas utiliser pour une livraison.</p>${svg.outerHTML}<p>Vérifiez les marges, la netteté et la lecture depuis le bouton « Tester le scan fictif » dans l’aide.</p><button onclick="window.print()">Imprimer l’étiquette fictive</button></body></html>`);
    popup.document.close();
    setPrint('Étiquette fictive ouverte. L’impression physique et la lecture restent à confirmer dans la grille.');
  };
  const btn = "ui-button ui-button-secondary";

  return (
    <section
      aria-label="Diagnostic de cet appareil"
      className="ui-panel p-4 space-y-3"
    >
      <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <Smartphone size={22} />
        Diagnostic de cet appareil
      </h3>
      <p className="text-sm text-slate-700">
        Chaque test démarre à votre demande. Aucune image, position ou donnée
        métier n’est enregistrée.
      </p>
      <p
        role="status"
        className="border-l-2 border-slate-300 pl-3 text-sm text-slate-700"
      >
        Réseau déclaré par le navigateur :{" "}
        <strong>{network ? 'connecté' : 'hors ligne'}</strong>. Cet état ne
        confirme pas la connexion au serveur.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={cameraBusy || cameraRunning} onClick={startCamera} className={btn}>
          <Camera size={18} />
          Tester la caméra
        </button>
        {(cameraBusy || cameraRunning) && (
          <button type="button" onClick={stopCamera} className={btn}>
            Arrêter la caméra
          </button>
        )}
        <button type="button" onClick={testGps} disabled={gpsBusy} className={btn}>
          <MapPin size={18} />
          {gpsBusy ? 'GPS en cours…' : 'Tester le GPS'}
        </button>
      </div>
      <p role="status" className="text-sm text-slate-800">
        Caméra : {camera}
      </p>
      {cameraRunning && (
        <video ref={video} autoPlay playsInline muted className="w-full max-h-64 rounded-xl bg-black" aria-label="Aperçu local de la caméra" />
      )}
      <p role="status" className="text-sm text-slate-800">
        GPS : {gps}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={printTest} className={btn}>
          <Printer size={18} />
          Ouvrir l’étiquette fictive
        </button>
        <button type="button" onClick={() => { stopCamera(); setScan(true); }} className={btn}>
          Tester le scan fictif
        </button>
      </div>
      <p className="text-sm text-slate-700">Impression : {print}</p>
      <p role="status" className="text-sm text-slate-700">
        Scan : {scanResult}
      </p>
      {scan && (
        <Suspense fallback={<p role="status">Ouverture du scanner de test…</p>}>
          <BarcodeScanner title="Diagnostic — étiquette fictive uniquement" expectedBarcodes={[testCode]} onClose={() => setScan(false)} onScan={code => { setScanResult(code === testCode ? 'Code fictif reconnu. Confirmez dans la grille si la lecture a été réalisée avec la caméra ou avec une aide.' : 'Code différent du code fictif attendu. Aucune recherche ni opération métier effectuée.'); setScan(false); }} />
        </Suspense>
      )}
      <details className="border-t border-slate-200 pt-3">
        <summary className="min-h-11 cursor-pointer font-bold text-slate-900">
          Consigner et exporter une séance terrain
        </summary>
        <p className="my-3 text-sm text-slate-700">
          Réalisez les gestes sur des dossiers de test autorisés, puis consignez
          le résultat observé. « Non testé » reste le résultat par défaut.
          N’indiquez aucun nom de client ou de chauffeur.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormInput label="Appareil et navigateur" value={device} onChange={event => setDevice(event.target.value)} placeholder="Ex. iPhone 14, iOS 18, Safari" />
          <FormSelect label="Profil testé" value={role} onChange={event => setRole(event.target.value)} options={[{ value: 'chauffeur', label: 'Chauffeur' }, { value: 'exploitation', label: 'Exploitation' }, { value: 'client', label: 'Client' }]} />
        </div>
        <div className="mt-4 space-y-4">
          {results.map((result, index) => (
            <fieldset
              key={result.scenario}
              className="border-t border-slate-200 pt-3"
            >
              <legend className="pr-2 font-semibold text-slate-900">
                {fieldScenarios[index][1]}
              </legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormSelect label="Résultat observé" value={result.outcome} onChange={event => setResults(previous => previous.map((row, i) => i === index ? { ...row, outcome: event.target.value as DiagnosticOutcome } : row))} options={[{ value: 'non_testé', label: 'Non testé' }, { value: 'réussi_sans_aide', label: 'Réussi sans aide' }, { value: 'réussi_avec_aide', label: 'Réussi avec aide' }, { value: 'échec', label: 'Échec' }]} />
                {(['seconds', 'errors'] as const).map((key) => (
                  <FormInput key={key} label={key === 'seconds' ? 'Durée (secondes)' : 'Erreurs rencontrées'} type="number" inputMode="numeric" min={0} value={result[key] ?? ''} onChange={event => setResults(previous => previous.map((row, i) => i === index ? { ...row, [key]: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) } : row))} />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <button type="button" onClick={() => downloadDiagnosticJson(buildDeviceDiagnosticReport(device, role, { camera, gps, network: network ? 'connecté (navigateur)' : 'hors ligne', scan: scanResult, print }, results))} className={`${btn} mt-4`}>
          <Download size={18} />
          Exporter mes résultats (JSON)
        </button>
        <p className="mt-2 text-sm text-slate-600">
          Export local à partager volontairement avec l’équipe. Les tests de
          caméra/GPS ne valident pas les livraisons, la synchronisation ou
          l’impression physique.
        </p>
      </details>
    </section>
  );
}
