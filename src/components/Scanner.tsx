import React, { useState, useEffect, useRef } from 'react';
import { recordDiagnosticAction } from '../utils/runtimeDiagnostics';
import { withDeadline } from '../utils/asyncDeadline';
import Modal from './shared/Modal';
import type { BarcodeScannerProps } from './BarcodeScanner';

/** Kept in the calling screen's bundle: a missing camera chunk must not crash the tour or discard its draft. */
export function ManualScanFallback({ onScan, onClose, busy, title, flashMessage, countLabel, onRetryCamera }: BarcodeScannerProps & { onRetryCamera?: () => void }) {
  const [code, setCode] = useState('');
  return <Modal isOpen mobileFullscreen onClose={onClose} busy={busy} title={title || 'Scanner un colis'}>
    <p className="text-sm text-amber-900 bg-amber-50 rounded-xl p-3 mb-4">Le lecteur caméra est indisponible. Vous pouvez saisir le numéro du colis ou réessayer la caméra ici, sans vous déconnecter.</p>
    {onRetryCamera && <button type="button" disabled={busy} onClick={onRetryCamera} className="ui-button ui-button-secondary w-full mb-4">Réessayer la caméra</button>}
    <form onSubmit={event => { event.preventDefault(); if (code.trim()) { onScan(code.trim()); setCode(''); } }} className="space-y-3">
      <label htmlFor="fallback-scan-code" className="block text-sm font-bold">Numéro du colis</label>
      <input id="fallback-scan-code" autoFocus value={code} onChange={event => setCode(event.target.value)} className="ui-input w-full" autoComplete="off" />
      <button type="submit" disabled={!code.trim() || busy} className="ui-button ui-button-primary w-full">{busy ? 'Confirmation en cours…' : 'Vérifier ce colis'}</button>
    </form>
    {flashMessage && <p role="status" className={`mt-4 text-sm ${flashMessage.type === 'warn' ? 'text-amber-900' : 'text-green-800'}`}>{flashMessage.text}</p>}
    {countLabel && <p className="mt-3 text-sm">{countLabel}</p>}
  </Modal>;
}
export default function Scanner(props: BarcodeScannerProps) {
  const [CameraScanner, setCameraScanner] = useState<React.ComponentType<BarcodeScannerProps> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => { recordDiagnosticAction('scanner.open'); return () => recordDiagnosticAction('scanner.close'); }, []);
  useEffect(() => {
    const current = ++generation.current;
    setFailed(false);
    // Do not cache a failed load as the scanner component for the entire login
    // session. A retry or a later opening gets another bounded loading attempt.
    void withDeadline(import('./BarcodeScanner'), 10000, new Error('Chargement du lecteur trop long.')).then(module => {
      if (generation.current === current) setCameraScanner(() => module.default);
    }).catch(error => {
      if (generation.current !== current) return;
      setFailed(true);
      void import('../services/logService').then(({ reportError }) => reportError('scanner.module.load', error, { silent: true })).catch(() => {});
    });
    return () => { generation.current++; };
  }, [attempt]);
  if (CameraScanner) return <CameraScanner {...props} />;
  if (failed) return <ManualScanFallback {...props} onRetryCamera={() => setAttempt(value => value + 1)} />;
  return <Modal isOpen onClose={props.onClose} busy={props.busy} title="Ouverture du scanner">
    <p role="status">Chargement du lecteur…</p>
    <button type="button" className="ui-button ui-button-secondary mt-4" onClick={() => { generation.current++; setFailed(true); }}>Saisie manuelle</button>
  </Modal>;
}
