import { AlertTriangle, CheckCircle, Loader2, XCircle } from 'lucide-react';

export interface ScanFeedbackValue { type: 'ok' | 'warn' | 'error' | 'pending'; text: string }

/** Only the server's confirmation can show a parcel as accepted. */
export default function ScanFeedback({ message, busy = false }: { message: ScanFeedbackValue; busy?: boolean }) {
  const Icon = message.type === 'ok' ? CheckCircle : message.type === 'error' ? XCircle : message.type === 'pending' ? Loader2 : AlertTriangle;
  const color = message.type === 'ok' ? 'bg-green-700' : message.type === 'error' ? 'bg-red-700' : message.type === 'pending' ? 'bg-slate-700' : 'bg-amber-800';
  return <div role={message.type === 'error' ? 'alert' : 'status'} aria-atomic="true" data-scan-feedback={message.type}
    className={`shrink-0 px-4 py-3 text-white text-center text-sm font-bold break-words ${color}`}>
    <Icon size={24} className={`inline mr-2 ${message.type === 'pending' ? 'animate-spin' : ''}`} aria-hidden="true" />
    {message.text}
    {busy && message.type !== 'pending' && <p className="mt-1 flex items-center justify-center gap-2 font-normal"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Vérification en cours…</p>}
  </div>;
}
