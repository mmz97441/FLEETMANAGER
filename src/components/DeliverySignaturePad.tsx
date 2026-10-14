import React, { useRef, useState, useEffect } from 'react';
import { PenTool, CheckCircle, X, Undo2 } from 'lucide-react';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
const SignaturePad: React.FC<{
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
  driverName?: string;
}> = ({ onSave, onCancel, driverName }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  useUnsavedChanges(hasContent, isDrawing, true);
  const strokesRef = useRef<{ x: number; y: number }[][]>([]);
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);

  const getPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const redraw = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length - 1; i++) {
        const mx = (stroke[i].x + stroke[i + 1].x) / 2;
        const my = (stroke[i].y + stroke[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, mx, my);
      }
      ctx.lineTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
      ctx.stroke();
    }
  };

  const startDrawing = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    currentStrokeRef.current = [pos];
    setIsDrawing(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    currentStrokeRef.current.push(pos);

    // Live drawing du trait courant
    const pts = currentStrokeRef.current;
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const prev = pts[pts.length - 2];
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasContent(true);
  };

  const stopDrawing = () => {
    if (isDrawing && currentStrokeRef.current.length > 1) {
      strokesRef.current.push([...currentStrokeRef.current]);
      currentStrokeRef.current = [];
      redraw(); // Redessine avec Bézier pour lisser
    }
    setIsDrawing(false);
  };

  const undo = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    redraw();
    setHasContent(strokesRef.current.length > 0);
  };

  const clear = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    strokesRef.current = [];
    currentStrokeRef.current = [];
    setHasContent(false);
  };

  const save = () => {
    if (!canvasRef.current || !hasContent) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) { onSave(canvas.toDataURL('image/png')); return; }

    // Watermark en bas : date + heure + chauffeur
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const watermark = `${dateStr} ${timeStr}${driverName ? ` — ${driverName}` : ''}`;

    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, canvas.height - 22, canvas.width, 22);
    ctx.font = '11px Arial, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.textBaseline = 'middle';
    ctx.fillText(watermark, 6, canvas.height - 11);

    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div className="min-w-0 max-w-full bg-white rounded-xl border-2 border-amber-300 overflow-hidden shadow-lg">
      <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <span className="text-sm font-bold text-amber-800">
          <PenTool
            size={18}
            className="inline shrink-0 align-text-bottom"
            aria-hidden="true"
          />{" "}
          Signature du destinataire
        </span>
        <div className="flex gap-2">
          <button
            onClick={undo}
            disabled={strokesRef.current.length === 0}
            className="ui-button ui-button-secondary disabled:opacity-30"
          >
            <Undo2 size={18} aria-hidden="true" />
            Annuler
          </button>
          <button onClick={clear} className="ui-button ui-button-secondary">
            Effacer tout
          </button>
        </div>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={280}
          aria-label="Zone de signature manuscrite du destinataire" className="block max-w-full w-full h-[160px] touch-none bg-white cursor-crosshair"
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
        />
        {!hasContent && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-600 text-sm">Signez ici avec le doigt</p>
          </div>
        )}
      </div>
      <div className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2">
        <button
          onClick={onCancel}
          className="ui-button ui-button-secondary flex-1"
        >
          Annuler
        </button>
        <button
          onClick={save}
          disabled={!hasContent}
          className="ui-button ui-button-primary flex-1"
        >
          <CheckCircle size={18} aria-hidden="true" />
          Valider signature
        </button>
      </div>
    </div>
  );
};


export default SignaturePad;
