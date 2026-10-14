import React, { useEffect, useState } from 'react';
import type { ProofOfDelivery } from '../types';
import { X, Printer, ChevronLeft, ChevronRight, CheckCircle, AlertTriangle } from 'lucide-react';
import { buildProofPrintHTML, presentProof, type ProofPackageInfo } from '../utils/proofPresentation';
import { trustedImageUrl } from '../utils/html';

interface PODViewerProps {
  pod: ProofOfDelivery;
  onClose: () => void;
  packageInfo?: ProofPackageInfo;
  showDriverInfo?: boolean;
}
const PODViewer: React.FC<PODViewerProps> = ({ pod, onClose, packageInfo, showDriverInfo = true }) => {
  const model = presentProof(pod, packageInfo, showDriverInfo);
  const images = [...(model.signature ? [{ url: model.signature, label: 'Signature du réceptionnaire' }] : []),
    ...model.photos.map((url, i) => ({ url, label: `Photo ${i + 1}` }))];
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const [printError, setPrintError] = useState('');
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (imageIndex !== null) setImageIndex(null); else onClose(); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [imageIndex, onClose]);
  const print = () => {
    setPrintError('');
    const target = window.open('', '_blank', 'width=800,height=950');
    if (!target) { setPrintError('Le navigateur a bloqué le document. Autorisez les fenêtres pour imprimer la preuve.'); return; }
    target.document.write(buildProofPrintHTML(model)); target.document.close();
  };
  return <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <button type="button" aria-label="Fermer la preuve" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-label={model.title} className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="text-base font-bold text-slate-900">{model.title}</h2>
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={print} className="ui-button ui-button-secondary"><Printer size={18} aria-hidden="true" />Imprimer</button>
            <button type="button" onClick={onClose} aria-label="Fermer la preuve" className="ui-button ui-button-ghost"><X size={20} /></button>
          </div>
        </header>
        <div className="space-y-4 p-4">
          {printError && <p role="alert" className="text-sm text-red-700">{printError}</p>}
          <div className={`flex items-start gap-3 rounded-xl border p-3 ${model.failure ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
            {model.failure ? <AlertTriangle size={20} /> : <CheckCircle size={20} />}
            <div><p className="font-semibold">{model.failure ? 'Colis non remis' : 'Livré avec succès'}</p><p className="text-sm">{model.timestamp} · La Réunion</p></div>
          </div>
          <dl className="space-y-3 text-sm">{model.facts.map(fact => <div key={fact.label}><dt className="font-medium text-slate-600">{fact.label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-slate-900">{fact.href ? <a href={fact.href} target="_blank" rel="noreferrer" className="text-blue-700 underline">{fact.value} — Voir sur la carte</a> : fact.value}</dd></div>)}</dl>
          {!model.signature && <p className="text-sm text-slate-600">Pas de signature enregistrée</p>}
          <div className="grid grid-cols-2 gap-3">{images.map((image, index) => <button type="button" key={`${image.url}_${index}`} onClick={() => setImageIndex(index)} className="rounded-lg border border-slate-200 p-2 text-left">
            <span className="mb-1 block text-sm text-slate-700">{image.label}</span><img src={trustedImageUrl(image.url)} alt={image.label} className="h-32 w-full object-contain" />
          </button>)}</div>
        </div>
      </section>
    </div>
    {imageIndex !== null && images[imageIndex] && <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/90 p-4" role="dialog" aria-modal="true" aria-label={images[imageIndex].label}>
      <button type="button" onClick={() => setImageIndex(null)} className="ui-button ui-button-secondary">Fermer l’image</button>
      <img src={trustedImageUrl(images[imageIndex].url)} alt={images[imageIndex].label} className="max-h-[75vh] max-w-full object-contain" />
      <div className="flex gap-4"><button type="button" disabled={imageIndex === 0} onClick={() => setImageIndex(imageIndex - 1)} aria-label="Image précédente" className="ui-button ui-button-secondary"><ChevronLeft /></button><button type="button" disabled={imageIndex === images.length - 1} onClick={() => setImageIndex(imageIndex + 1)} aria-label="Image suivante" className="ui-button ui-button-secondary"><ChevronRight /></button></div>
    </div>}
  </>;
};
export default PODViewer;
