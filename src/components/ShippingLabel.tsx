import { escapeHtml } from '../utils/html';
/**
 * SHIPPING LABEL
 *
 * Étiquette de transport imprimable, format 100 × 150 mm.
 * Génère un code-barres Code128 à partir du numéro de commande.
 *
 * Usage :
 * - Portail client : bouton "Imprimer l'étiquette" sur devis accepté
 * - Back-office : impression depuis la vue colis
 * L'impression par lot dispose de son propre gabarit dans pickupService.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { QuoteRequest, Zone } from '../types';
import { Printer } from 'lucide-react';
import Modal from './shared/Modal';
import { formatWeight } from '../utils/format';

export interface ShippingLabelData {
  // Identifiants
  orderNumber: string;             // Numéro affiché + code-barres
  barcode?: string;                // Si différent du orderNumber
  externalId?: string;             // Ref client (ex: C0004911-15087911)

  // Expéditeur
  senderName: string;
  senderAddress?: string;
  senderCity?: string;
  senderPhone?: string;

  // Destinataire
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientPostalCode: string;
  recipientPhone?: string;
  floor?: number;
  hasElevator?: boolean;

  // Livraison
  zone: Zone | string;
  timeWindowStart?: string;        // "08:00"
  timeWindowEnd?: string;          // "12:00"
  timeWindowLabel?: string;        // "Matin (08h-12h)"
  deliveryDate?: string;           // ISO date

  // Colis
  goodsDescription?: string;
  weight?: number;
  volume?: number;
  comment?: string;
  packageCount?: number;           // "1/3" si multi-colis
  packageTotal?: number;
}

interface ShippingLabelProps {
  data: ShippingLabelData;
  onClose?: () => void;
  companyName?: string;            // Nom de ta société de transport
}

/**
 * Convertit un QuoteRequest en ShippingLabelData
 */
export const quoteToLabelData = (quote: QuoteRequest): ShippingLabelData => {
  // Extraire le code postal de l'adresse destination
  const destParts = (quote.destinationAddress || quote.destination || '').split(',').map(s => s.trim());
  const postalCode = destParts.find(p => /^97\d{3}$/.test(p)) || '';
  const city = quote.destination || destParts[destParts.length - 1] || '';
  const address = destParts[0] || '';

  return {
    orderNumber: quote.convertedToPackageId
      ? `Q${quote.id.slice(-6)}`
      : quote.id.slice(-8),
    externalId: quote.id,
    senderName: quote.clientName,
    senderAddress: quote.originAddress,
    senderCity: quote.origin,
    senderPhone: quote.originContact?.phone,
    recipientName: quote.destinationContact?.name || 'Destinataire',
    recipientAddress: address,
    recipientCity: city,
    recipientPostalCode: postalCode,
    recipientPhone: quote.destinationContact?.phone,
    zone: '', // Will be auto-detected or empty
    timeWindowStart: quote.deliveryTimeWindow?.start,
    timeWindowEnd: quote.deliveryTimeWindow?.end,
    timeWindowLabel: quote.deliveryTimeWindow?.label,
    deliveryDate: quote.deliveryDate,
    goodsDescription: quote.goodsDescription,
    weight: quote.weight,
    volume: quote.volume,
    comment: quote.clientNotes
  };
};

export const shippingBarcodeOptions = {
  format: 'CODE128', width: 2, height: 80, displayValue: false,
  // Ten modules of white space on each side remain inside the SVG viewBox.
  margin: 0, marginLeft: 20, marginRight: 20,
  background: '#ffffff', lineColor: '#000000',
};

/** The markup comes from this component's React-rendered label, including its local SVG. */
export const buildShippingLabelPrintHtml = (markup: string, orderNumber: string): string => `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Étiquette - ${escapeHtml(orderNumber)}</title>
        <style>
          @page {
            size: 100mm 150mm;
            margin: 0;
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            background: #fff;
            color: #000;
            width: 100mm;
            height: 150mm;
            padding: 3mm;
          }
          .label-container {
            width: 100%;
            height: 100%;
            min-width: 0;
            overflow-wrap: anywhere;
            border: 2px solid #000;
            display: flex;
            flex-direction: column;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 3mm;
            border-bottom: 2px solid #000;
            background: #f8f8f8;
          }
          .company-name {
            font-size: 12pt;
            font-weight: bold;
          }
          .zone-badge {
            font-size: 14pt;
            font-weight: bold;
            padding: 2mm 4mm;
            border: 2px solid #000;
            border-radius: 3mm;
            background: #000;
            color: #fff;
          }
          .sender-block {
            padding: 2mm 3mm;
            border-bottom: 1px dashed #999;
            font-size: 8pt;
            color: #555;
          }
          .sender-block .label {
            font-size: 7pt;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5pt;
            color: #999;
          }
          .recipient-block {
            padding: 3mm;
            border-bottom: 2px solid #000;
            flex: 1;
          }
          .recipient-label {
            font-size: 7pt;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5pt;
            color: #999;
            margin-bottom: 1mm;
          }
          .recipient-name {
            font-size: 14pt;
            font-weight: bold;
            margin-bottom: 1mm;
          }
          .recipient-address {
            font-size: 11pt;
            font-weight: bold;
            line-height: 1.3;
          }
          .recipient-postal {
            font-size: 16pt;
            font-weight: bold;
            margin-top: 2mm;
            letter-spacing: 1pt;
          }
          .recipient-phone {
            font-size: 9pt;
            margin-top: 1mm;
            color: #333;
          }
          .floor-info {
            font-size: 8pt;
            margin-top: 1mm;
            color: #555;
          }
          .details-row {
            display: flex;
            border-bottom: 1px solid #000;
          }
          .detail-cell {
            flex: 1;
            padding: 2mm 3mm;
            border-right: 1px solid #000;
            text-align: center;
          }
          .detail-cell:last-child {
            border-right: none;
          }
          .detail-label {
            font-size: 6pt;
            font-weight: bold;
            text-transform: uppercase;
            color: #999;
          }
          .detail-value {
            font-size: 10pt;
            font-weight: bold;
          }
          .barcode-block {
            flex-shrink: 0;
            padding: 2mm;
            text-align: center;
            border-bottom: 1px solid #000;
          }
          .barcode-block svg {
            max-width: 100%;
            width: 100%;
            height: 22mm;
            display: block;
          }
          .comment-block {
            padding: 2mm 3mm;
            font-size: 7pt;
            color: #555;
            max-height: 10mm;
            overflow: hidden;
          }
          .time-window {
            background: #eee;
            padding: 1mm 3mm;
            border-radius: 2mm;
            font-size: 9pt;
            font-weight: bold;
            display: inline-block;
            margin-top: 1mm;
          }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        ${markup}
      </body>
      </html>
    `;

const ShippingLabel: React.FC<ShippingLabelProps> = ({
  data,
  onClose,
  companyName = 'FleetGenius Transport'
}) => {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const printAreaRef = useRef<HTMLDivElement>(null);
  const [barcodeError, setBarcodeError] = useState('');
  const [printError, setPrintError] = useState('');
  const barcodeValue = data.barcode || data.orderNumber;

  // Only the bars scale; keep the full identifier separately readable below.
  useEffect(() => {
    setBarcodeError('');
    setPrintError('');
    if (!barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, barcodeValue, shippingBarcodeOptions);
      barcodeRef.current.setAttribute('preserveAspectRatio', 'none');
    } catch {
      barcodeRef.current.replaceChildren();
      setBarcodeError('Le code-barres ne peut pas être généré. Vérifiez le numéro du colis avant d’imprimer.');
    }
  }, [barcodeValue]);

  // Impression
  const handlePrint = useCallback(() => {
    const printContent = printAreaRef.current;
    if (!printContent || barcodeError) return;
    setPrintError('');

    let printWindow: Window | null;
    try { printWindow = window.open('', '_blank', 'width=450,height=650'); }
    catch { printWindow = null; }
    if (!printWindow) {
      setPrintError('La fenêtre d’impression a été bloquée. Autorisez les fenêtres contextuelles pour ce site, puis réessayez.');
      return;
    }
    try {
      printWindow.document.write(buildShippingLabelPrintHtml(printContent.innerHTML, data.orderNumber));
      printWindow.document.close();
      const target = printWindow;
      setTimeout(() => {
        try {
          const label = target.document.querySelector<HTMLElement>('.label-container');
          if (!label || label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1) {
            setPrintError('Le contenu dépasse le format 100 × 150 mm. Raccourcissez les instructions ou l’adresse avec le bureau avant d’imprimer.');
            target.close();
            return;
          }
          target.focus();
          target.print();
        } catch {
          setPrintError('L’impression n’a pas pu être ouverte. Vérifiez les autorisations du navigateur, puis réessayez.');
        }
      }, 250);
    } catch {
      printWindow.close();
      setPrintError('L’étiquette n’a pas pu être préparée pour l’impression. Réessayez.');
    }
  }, [data.orderNumber, barcodeError]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    } catch { return '—'; }
  };

  const zoneDisplay = data.zone || '?';

  return (
    <Modal isOpen={true} onClose={onClose || (() => {})} showCloseButton={!!onClose}
      closeOnOverlay={!!onClose} closeOnEscape={!!onClose} title="Aperçu de l’étiquette" size="lg"
      footer={<div className="space-y-2">
        {(barcodeError || printError) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{barcodeError || printError}</p>}
        <button type="button" onClick={handlePrint} disabled={!!barcodeError} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          <Printer size={16} /> Imprimer l’étiquette
        </button>
        <p className="text-center text-xs text-slate-600">Format 100 × 150 mm · Taille réelle 100 % · Marges désactivées dans l’imprimante</p>
      </div>}>
        {/* Label Preview */}
        <div className="flex min-w-0 justify-center">
          <div
            ref={printAreaRef}
            className="w-full min-w-0 bg-white"
            style={{ maxWidth: '378px', fontSize: '0', overflowWrap: 'anywhere' }}
          >
            <div className="label-container flex min-w-0 flex-col border-2 border-black" style={{ fontFamily: 'Arial, sans-serif' }}>

              {/* HEADER — Société + Zone */}
              <div className="header flex items-center justify-between gap-2 px-3 py-2 border-b-2 border-black bg-gray-100">
                <span style={{ fontSize: '12pt', fontWeight: 'bold' }}>{companyName}</span>
                <span
                  className="zone-badge"
                  style={{
                    fontSize: '14pt', fontWeight: 'bold',
                    padding: '2px 10px', border: '2px solid #000',
                    borderRadius: '6px', background: '#000', color: '#fff', whiteSpace: 'nowrap', flexShrink: 0
                  }}
                >
                  {zoneDisplay}
                </span>
              </div>

              {/* EXPÉDITEUR */}
              <div className="sender-block px-3 py-1.5 border-b border-dashed border-gray-400">
                <div style={{ fontSize: '7pt', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5pt', color: '#999' }}>
                  Expéditeur
                </div>
                <div style={{ fontSize: '9pt', color: '#333' }}>
                  <strong>{data.senderName}</strong>
                  {data.senderAddress && <span> — {data.senderAddress}</span>}
                  {data.senderCity && <span>, {data.senderCity}</span>}
                  {data.senderPhone && <span> • Tél: {data.senderPhone}</span>}
                </div>
              </div>

              {/* DESTINATAIRE (bloc principal) */}
              <div className="recipient-block px-3 py-2 border-b-2 border-black flex-1">
                <div style={{ fontSize: '7pt', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5pt', color: '#999', marginBottom: '2px' }}>
                  Destinataire
                </div>
                <div style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: '2px' }}>
                  {data.recipientName}
                </div>
                <div style={{ fontSize: '11pt', fontWeight: 'bold', lineHeight: '1.3' }}>
                  {data.recipientAddress}
                </div>
                <div style={{ fontSize: '16pt', fontWeight: 'bold', marginTop: '4px', letterSpacing: '1pt' }}>
                  {data.recipientPostalCode} {data.recipientCity}
                </div>
                {data.recipientPhone && (
                  <div style={{ fontSize: '9pt', marginTop: '2px', color: '#333' }}>
                    📞 {data.recipientPhone}
                  </div>
                )}
                {(data.floor !== undefined && data.floor > 0) && (
                  <div style={{ fontSize: '8pt', marginTop: '2px', color: '#555' }}>
                    Étage {data.floor} {data.hasElevator ? '(ascenseur)' : '(sans ascenseur)'}
                  </div>
                )}
                {data.timeWindowLabel || (data.timeWindowStart && data.timeWindowEnd) ? (
                  <div style={{
                    display: 'inline-block', marginTop: '4px', padding: '2px 8px',
                    background: '#eee', borderRadius: '4px', fontSize: '9pt', fontWeight: 'bold'
                  }}>
                    🕐 {data.timeWindowLabel || `${data.timeWindowStart} — ${data.timeWindowEnd}`}
                  </div>
                ) : null}
              </div>

              {/* DÉTAILS — Poids / Volume / Date / N° colis */}
              <div className="details-row grid grid-cols-2 sm:flex border-b border-black">
                <div className="detail-cell min-w-0 flex-1 px-2 py-1.5 border-r border-black text-center">
                  <div style={{ fontSize: '6pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999' }}>Poids</div>
                  <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>{formatWeight(data.weight) || '—'}</div>
                </div>
                <div className="detail-cell min-w-0 flex-1 px-2 py-1.5 border-r border-black text-center">
                  <div style={{ fontSize: '6pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999' }}>Volume</div>
                  <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>{data.volume ? `${data.volume} m³` : '—'}</div>
                </div>
                <div className="detail-cell min-w-0 flex-1 px-2 py-1.5 border-r border-black text-center">
                  <div style={{ fontSize: '6pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999' }}>Livraison</div>
                  <div style={{ fontSize: '8pt', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatDate(data.deliveryDate)}</div>
                </div>
                {data.packageCount && data.packageTotal && (
                  <div className="detail-cell min-w-0 flex-1 px-2 py-1.5 text-center">
                    <div style={{ fontSize: '6pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999' }}>Colis</div>
                    <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>{data.packageCount}/{data.packageTotal}</div>
                  </div>
                )}
              </div>

              {/* CODE-BARRES */}
              <div className="barcode-block min-w-0 shrink-0 px-2 py-1 text-center border-b border-black">
                <svg ref={barcodeRef} role="img" aria-label={`Code-barres ${barcodeValue}`} preserveAspectRatio="none" style={{ width: '100%', maxWidth: '100%', height: '22mm', display: 'block' }} />
                <div className="barcode-value" style={{ font: 'bold 8pt monospace', overflowWrap: 'anywhere', marginTop: '1mm' }}>{barcodeValue}</div>
              </div>

              {/* COMMENTAIRE / DESCRIPTION */}
              {(data.goodsDescription || data.comment) && (
                <div className="comment-block px-3 py-1.5" style={{ fontSize: '7pt', color: '#555', maxHeight: '35px', overflow: 'hidden' }}>
                  {data.goodsDescription && <span><strong>Contenu:</strong> {data.goodsDescription}</span>}
                  {data.comment && <span> | <strong>Note:</strong> {data.comment}</span>}
                </div>
              )}
            </div>
          </div>
        </div>

    </Modal>
  );
};

export default ShippingLabel;
