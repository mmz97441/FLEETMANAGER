/**
 * POD VIEWER — Visualisation Preuve de Livraison
 * 
 * Composant partagé utilisé par :
 * - MissionManager (back-office) : clic sur un colis livré → affiche POD
 * - ClientPortal : le client voit la preuve de ses livraisons
 * 
 * Affiche : signature, photos, coordonnées GPS, horodatage, réceptionnaire
 */

import React, { useState } from 'react';
import { ProofOfDelivery } from '../types';
import {
  X, MapPin, Clock, User, Truck, Camera, PenTool,
  ZoomIn, ChevronLeft, ChevronRight, ExternalLink, Printer
} from 'lucide-react';

interface PODViewerProps {
  pod: ProofOfDelivery;
  onClose: () => void;
  packageInfo?: {
    orderNumber: string;
    contactName: string;
    address: string;
    city: string;
  };
  showDriverInfo?: boolean;  // false pour le client (pas besoin de voir les détails véhicule)
}

const PODViewer: React.FC<PODViewerProps> = ({
  pod,
  onClose,
  packageInfo,
  showDriverInfo = true
}) => {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const allImages = [
    ...(pod.signatureUrl ? [{ url: pod.signatureUrl, type: 'signature' as const }] : []),
    ...pod.photoUrls.map(url => ({ url, type: 'photo' as const }))
  ];

  const openLightbox = (url: string) => {
    const idx = allImages.findIndex(img => img.url === url);
    setLightboxIndex(idx >= 0 ? idx : 0);
    setLightboxImage(url);
  };

  const navigateLightbox = (direction: 1 | -1) => {
    const newIdx = lightboxIndex + direction;
    if (newIdx >= 0 && newIdx < allImages.length) {
      setLightboxIndex(newIdx);
      setLightboxImage(allImages[newIdx].url);
    }
  };

  const formatDate = (ts: string) => {
    try {
      return new Date(ts).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return ts; }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=700,height=900');
    if (!printWindow) return;

    const photosHtml = pod.photoUrls.map(url =>
      `<div style="text-align:center;margin:10px 0;"><img src="${url}" style="max-width:100%;max-height:300px;border:1px solid #ccc;border-radius:8px;" /></div>`
    ).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head><title>POD - ${packageInfo?.orderNumber || pod.packageId}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; max-width: 700px; margin: 0 auto; }
        h1 { font-size: 18pt; border-bottom: 2px solid #000; padding-bottom: 10px; }
        .row { display: flex; justify-content: space-between; margin: 8px 0; }
        .label { font-weight: bold; color: #555; font-size: 10pt; }
        .value { font-size: 11pt; }
        .signature-block { margin: 20px 0; text-align: center; }
        .signature-block img { border: 1px solid #ccc; border-radius: 8px; max-width: 400px; }
        .signature-label { font-size: 9pt; color: #888; margin-top: 5px; }
        hr { border: none; border-top: 1px dashed #ccc; margin: 15px 0; }
        @media print { body { padding: 10px; } }
      </style></head><body>
        <h1>Preuve de Livraison</h1>
        ${packageInfo ? `
          <div class="row"><span class="label">Commande :</span><span class="value">${packageInfo.orderNumber}</span></div>
          <div class="row"><span class="label">Destinataire :</span><span class="value">${packageInfo.contactName}</span></div>
          <div class="row"><span class="label">Adresse :</span><span class="value">${packageInfo.address}, ${packageInfo.city}</span></div>
        ` : ''}
        <hr />
        <div class="row"><span class="label">Réceptionné par :</span><span class="value">${pod.recipientName || 'Non renseigné'}</span></div>
        <div class="row"><span class="label">Date / Heure :</span><span class="value">${formatDate(pod.timestamp)}</span></div>
        <div class="row"><span class="label">Chauffeur :</span><span class="value">${pod.driverName}</span></div>
        <div class="row"><span class="label">Véhicule :</span><span class="value">${pod.vehiclePlate}</span></div>
        <div class="row"><span class="label">Coordonnées GPS :</span><span class="value">${pod.coordinates.lat.toFixed(6)}, ${pod.coordinates.lng.toFixed(6)}</span></div>
        ${pod.notes ? `<div class="row"><span class="label">Notes :</span><span class="value">${pod.notes}</span></div>` : ''}
        <hr />
        ${pod.signatureUrl ? `
          <div class="signature-block">
            <img src="${pod.signatureUrl}" />
            <p class="signature-label">Signature du réceptionnaire</p>
          </div>
        ` : '<p style="color:#999;text-align:center;">Pas de signature</p>'}
        ${photosHtml ? `<hr /><h3 style="font-size:12pt;">Photos</h3>${photosHtml}` : ''}
      </body></html>
    `);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 300);
  };

  return (
    <>
      {/* MODAL POD */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-5 py-3 border-b border-slate-200 rounded-t-2xl">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Preuve de livraison</h3>
              {packageInfo && (
                <p className="text-xs text-slate-500">Commande {packageInfo.orderNumber}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors"
              >
                <Printer size={12} />
                Imprimer
              </button>
              <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-5 space-y-4">

            {/* Badge statut */}
            <div className="flex items-center gap-3 bg-emerald-50 rounded-xl p-3 border border-emerald-200">
              <div className="bg-emerald-100 p-2 rounded-full">
                <PenTool size={18} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-emerald-800">Livré avec succès</p>
                <p className="text-xs text-emerald-600">
                  {formatDate(pod.timestamp)}
                </p>
              </div>
            </div>

            {/* Destinataire */}
            {packageInfo && (
              <div className="space-y-1">
                <p className="text-xs font-bold text-slate-400 uppercase">Destinataire</p>
                <p className="font-bold text-slate-800">{packageInfo.contactName}</p>
                <p className="text-sm text-slate-600">{packageInfo.address}</p>
                <p className="text-sm text-slate-600">{packageInfo.city}</p>
              </div>
            )}

            {/* Réceptionné par */}
            <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
              <User size={16} className="text-slate-400" />
              <div>
                <p className="text-xs text-slate-500">Réceptionné par</p>
                <p className="font-bold text-slate-800 text-sm">{pod.recipientName || 'Non renseigné'}</p>
              </div>
            </div>

            {/* Infos chauffeur (back-office uniquement) */}
            {showDriverInfo && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-3">
                  <Truck size={14} className="text-slate-400" />
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Chauffeur</p>
                    <p className="font-bold text-slate-800 text-xs">{pod.driverName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-3">
                  <Truck size={14} className="text-slate-400" />
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Véhicule</p>
                    <p className="font-bold text-slate-800 text-xs">{pod.vehiclePlate}</p>
                  </div>
                </div>
              </div>
            )}

            {/* GPS */}
            {pod.coordinates && (pod.coordinates.lat !== 0 || pod.coordinates.lng !== 0) && (
              <div className="flex items-center gap-3 bg-blue-50 rounded-xl p-3 border border-blue-100">
                <MapPin size={16} className="text-blue-500" />
                <div className="flex-1">
                  <p className="text-xs text-blue-600 font-medium">Position GPS vérifiée</p>
                  <p className="text-xs text-blue-500 font-mono">
                    {pod.coordinates.lat.toFixed(6)}, {pod.coordinates.lng.toFixed(6)}
                  </p>
                </div>
                <a
                  href={`https://maps.google.com/?q=${pod.coordinates.lat},${pod.coordinates.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-700"
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            )}

            {/* Notes */}
            {pod.notes && (
              <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                <p className="text-xs text-amber-800">{pod.notes}</p>
              </div>
            )}

            {/* SIGNATURE */}
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                <PenTool size={12} /> Signature
              </p>
              {pod.signatureUrl ? (
                <div
                  onClick={() => openLightbox(pod.signatureUrl!)}
                  className="bg-white border-2 border-slate-200 rounded-xl p-2 cursor-pointer hover:border-blue-300 transition-colors group relative"
                >
                  <img
                    src={pod.signatureUrl}
                    alt="Signature"
                    className="w-full h-[100px] object-contain"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-black/40 rounded-full p-2">
                      <ZoomIn size={16} className="text-white" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 rounded-xl p-4 text-center text-sm text-slate-400 border border-dashed border-slate-200">
                  Pas de signature enregistrée
                </div>
              )}
            </div>

            {/* PHOTOS */}
            {pod.photoUrls.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                  <Camera size={12} /> Photos ({pod.photoUrls.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {pod.photoUrls.map((url, i) => (
                    <div
                      key={i}
                      onClick={() => openLightbox(url)}
                      className="aspect-square rounded-xl overflow-hidden border border-slate-200 cursor-pointer group relative"
                    >
                      <img
                        src={url}
                        alt={`Photo ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                        <div className="bg-black/50 rounded-full p-2">
                          <ZoomIn size={16} className="text-white" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LIGHTBOX PLEIN ÉCRAN */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[60] bg-black flex items-center justify-center"
          onClick={() => setLightboxImage(null)}
        >
          {/* Navigation */}
          {lightboxIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); navigateLightbox(-1); }}
              className="absolute left-4 z-10 bg-white/20 hover:bg-white/40 rounded-full p-2 transition-colors"
            >
              <ChevronLeft size={24} className="text-white" />
            </button>
          )}
          {lightboxIndex < allImages.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); navigateLightbox(1); }}
              className="absolute right-4 z-10 bg-white/20 hover:bg-white/40 rounded-full p-2 transition-colors"
            >
              <ChevronRight size={24} className="text-white" />
            </button>
          )}

          {/* Close */}
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 z-10 bg-white/20 hover:bg-white/40 rounded-full p-2"
          >
            <X size={20} className="text-white" />
          </button>

          {/* Image */}
          <img
            src={lightboxImage}
            alt="Zoom"
            className="max-w-[95vw] max-h-[90vh] object-contain"
            onClick={e => e.stopPropagation()}
          />

          {/* Type indicator */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/20 px-3 py-1 rounded-full text-white text-xs">
            {allImages[lightboxIndex]?.type === 'signature' ? '✍️ Signature' : `📷 Photo ${lightboxIndex}`}
            {' '}— {lightboxIndex + 1}/{allImages.length}
          </div>
        </div>
      )}
    </>
  );
};

export default PODViewer;
