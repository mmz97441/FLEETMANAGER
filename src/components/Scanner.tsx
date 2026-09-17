import React, { lazy, Suspense, useState, useEffect } from 'react';
import { recordDiagnosticAction } from '../utils/runtimeDiagnostics';
import Modal from './shared/Modal';
import type { BarcodeScannerProps } from './BarcodeScanner';

/** Kept in the calling screen's bundle: a missing camera chunk must not crash the tour or discard its draft. */
export function ManualScanFallback({ onScan, onClose, busy, title, flashMessage, countLabel }: BarcodeScannerProps) {
  const [code, setCode] = useState('');
  return <Modal isOpen mobileFullscreen onClose={onClose} busy={busy} title={title || 'Scanner un colis'}>
    <p className="text-sm text-amber-900 bg-amber-50 rounded-xl p-3 mb-4">Le lecteur caméra n’a pas pu se charger. Saisissez le numéro du colis ci-dessous. Vous pourrez recharger l’application après avoir terminé votre opération.</p>
    <form onSubmit={event => { event.preventDefault(); if (code.trim()) { onScan(code.trim()); setCode(''); } }} className="space-y-3">
      <label htmlFor="fallback-scan-code" className="block text-sm font-bold">Numéro du colis</label>
      <input id="fallback-scan-code" autoFocus value={code} onChange={event => setCode(event.target.value)} className="ui-input w-full" autoComplete="off" />
      <button type="submit" disabled={!code.trim() || busy} className="ui-button ui-button-primary w-full">{busy ? 'Confirmation en cours…' : 'Vérifier ce colis'}</button>
    </form>
    {flashMessage && <p role="status" className={`mt-4 text-sm ${flashMessage.type === 'warn' ? 'text-amber-900' : 'text-green-800'}`}>{flashMessage.text}</p>}
    {countLabel && <p className="mt-3 text-sm">{countLabel}</p>}
  </Modal>;
}
const CameraScanner = lazy(() => import('./BarcodeScanner').catch(error => {
  void import('../services/logService').then(({ reportError }) => reportError('scanner.module.load', error, { silent: true })).catch(() => {});
  return { default: ManualScanFallback };
}));
export default function Scanner(props: BarcodeScannerProps) {
  useEffect(() => { recordDiagnosticAction('scanner.open'); return () => recordDiagnosticAction('scanner.close'); }, []);
  return <Suspense fallback={<Modal isOpen onClose={props.onClose} title="Ouverture du scanner"><p role="status">Chargement du lecteur…</p></Modal>}><CameraScanner {...props} /></Suspense>;
}
