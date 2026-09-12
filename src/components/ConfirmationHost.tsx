import { useEffect, useRef, useState } from 'react';
import Modal from './shared/Modal';
import { Confirmation, subscribeConfirmations } from '../services/confirmationService';
type Request = Confirmation & { resolve: (confirmed: boolean) => void };
export default function ConfirmationHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  useEffect(() => {
    const unsubscribe = subscribeConfirmations(request => setQueue(previous => [...previous, request]));
    return () => { unsubscribe(); queueRef.current.forEach(request => request.resolve(false)); };
  }, []);
  const current = queue[0];
  const finish = (confirmed: boolean) => { current?.resolve(confirmed); setQueue(previous => previous.slice(1)); };
  return <Modal isOpen={!!current} onClose={() => finish(false)} title={current?.title} role="alertdialog" size="sm" showCloseButton={false}>
    <p className="text-slate-700">{current?.message}</p>
    <div className="mt-5 flex flex-col gap-3">
      <button type="button" data-autofocus onClick={() => finish(false)} className="ui-button ui-button-secondary">{current?.cancelLabel || 'Annuler'}</button>
      <button type="button" onClick={() => finish(true)} className={`ui-button ${current?.danger ? 'ui-button-danger' : 'ui-button-primary'}`}>{current?.confirmLabel || 'Confirmer'}</button>
    </div>
  </Modal>;
}
