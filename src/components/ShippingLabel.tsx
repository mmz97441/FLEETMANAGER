/**
 * SHIPPING LABEL
 * 
 * Étiquette de transport imprimable, format standard ~10x15cm (A6).
 * Génère un code-barres Code128 à partir du numéro de commande.
 * 
 * Usage :
 * - Portail client : bouton "Imprimer l'étiquette" sur devis accepté
 * - Back-office : impression depuis la vue colis
 * - Impression par lot (futur)
 * 
 * Format : Optimisé pour impression sur étiqueteuse ou imprimante A4
 *           (1 étiquette par page A6 / 4 par A4)
 */

import React, { useRef, useEffect, useCallback } from 'react';
import JsBarcode from 'jsbarcode';
import { QuoteRequest, Zone, ZONE_COLORS } from '../types';
import { Printer, X } from 'lucide-react';

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

const ShippingLabel: React.FC<ShippingLabelProps> = ({ 
  data, 
  onClose, 
  companyName = 'FleetGenius Transport' 
}) => {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const printAreaRef = useRef<HTMLDivElement>(null);

  // Générer le code-barres
  useEffect(() => {
    if (barcodeRef.current && data.orderNumber) {
      try {
        JsBarcode(barcodeRef.current, data.barcode || data.orderNumber, {
          format: 'CODE128',
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 14,
          font: 'monospace',
          fontOptions: 'bold',
          margin: 5,
          background: '#ffffff',
          lineColor: '#000000'
        });
      } catch (e) {
        /* silenced */
      }
    }
  }, [data.orderNumber, data.barcode]);

  // Impression
  const handlePrint = useCallback(() => {
    const printContent = printAreaRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank', 'width=450,height=650');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Étiquette - ${data.orderNumber}</title>
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
            width: 100mm;
            height: 150mm;
            padding: 3mm;
          }
          .label-container {
            width: 100%;
            height: 100%;
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
            padding: 2mm;
            text-align: center;
            border-bottom: 1px solid #000;
          }
          .barcode-block svg {
            max-width: 100%;
            height: 40px;
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
        ${printContent.innerHTML}
      </body>
      </html>
    `);

    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  }, [data.orderNumber]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-800 text-sm">Aperçu étiquette</h3>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
            >
              <Printer size={14} />
              Imprimer
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Label Preview */}
        <div className="p-5 flex justify-center">
          <div 
            ref={printAreaRef}
            className="bg-white border-2 border-black"
            style={{ width: '378px', minHeight: '567px', fontSize: '0' }} // ~100mm x 150mm at 96dpi
          >
            <div className="label-container flex flex-col h-full" style={{ fontFamily: 'Arial, sans-serif' }}>

              {/* HEADER — Société + Zone */}
              <div className="flex items-center justify-between px-3 py-2 border-b-2 border-black bg-gray-100">
                <span style={{ fontSize: '12pt', fontWeight: 'bold' }}>{companyName}</span>
                <span 
                  className="zone-badge"
                  style={{ 
                    fontSize: '14pt', fontWeight: 'bold', 
                    padding: '2px 10px', border: '2px solid #000', 
                    borderRadius: '6px', background: '#000', color: '#fff' 
                  }}
                >
                  {zoneDisplay}
                </span>
              </div>

              {/* EXPÉDITEUR */}
              <div className="px-3 py-1.5 border-b border-dashed border-gray-400">
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
              <div className="px-3 py-2 border-b-2 border-black flex-1">
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
              <div className="flex border-b border-black">
                <div className="flex-1 px-2 py-1.5 border-r border-black text-center">
                  <div style={{ fontSize: '6pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999' }}>Poids</div>
                  <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>{data.weight ? `${data.weight} kg` : '—'}</div>
                </div>
                <div className="flex-1 px-2 py-1.5 border-r border-black text-center">
                  <div style={{ fontSize: '6pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999' }}>Volume</div>
                  <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>{data.volume ? `${data.volume} m³` : '—'}</div>
                </div>
                <div className="flex-1 px-2 py-1.5 border-r border-black text-center">
                  <div style={{ fontSize: '6pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999' }}>Livraison</div>
                  <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>{formatDate(data.deliveryDate)}</div>
                </div>
                {data.packageCount && data.packageTotal && (
                  <div className="flex-1 px-2 py-1.5 text-center">
                    <div style={{ fontSize: '6pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999' }}>Colis</div>
                    <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>{data.packageCount}/{data.packageTotal}</div>
                  </div>
                )}
              </div>

              {/* CODE-BARRES */}
              <div className="px-2 py-1 text-center border-b border-black">
                <svg ref={barcodeRef} />
              </div>

              {/* COMMENTAIRE / DESCRIPTION */}
              {(data.goodsDescription || data.comment) && (
                <div className="px-3 py-1.5" style={{ fontSize: '7pt', color: '#555', maxHeight: '35px', overflow: 'hidden' }}>
                  {data.goodsDescription && <span><strong>Contenu:</strong> {data.goodsDescription}</span>}
                  {data.comment && <span> | <strong>Note:</strong> {data.comment}</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Infos sous l'aperçu */}
        <div className="px-5 pb-4 text-center">
          <p className="text-xs text-slate-400">
            Format 10×15 cm — Compatible étiqueteuse et impression A4
          </p>
        </div>
      </div>
    </div>
  );
};

export default ShippingLabel;
