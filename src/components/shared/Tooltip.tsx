import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
}

const AUTO_HIDE_MS = 3000;

/**
 * Tooltip réutilisable, sans dépendance.
 * - S'affiche au survol / focus / tap.
 * - Disparaît automatiquement après 3s, même si le pointeur reste dessus.
 * - Disparaît immédiatement au mouseleave / blur.
 *
 * La bulle est rendue dans un PORTAIL (document.body) en position: fixed, pour
 * échapper à tout ancêtre `overflow: hidden/auto` (cartes arrondies, tableaux
 * scrollables) qui la découperait sinon.
 */
const Tooltip: React.FC<TooltipProps> = ({ label, children, side = 'top' }) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTop = side === 'top';

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const position = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({
      top: isTop ? r.top : r.bottom,
      left: r.left + r.width / 2,
    });
  }, [isTop]);

  const show = useCallback(() => {
    clearTimer();
    position();
    setVisible(true);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, AUTO_HIDE_MS);
  }, [clearTimer, position]);

  const hide = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  // Repositionne précisément une fois la bulle mesurée (centrage + décalage vertical).
  useLayoutEffect(() => {
    if (visible) position();
  }, [visible, position]);

  useEffect(() => clearTimer, [clearTimer]);

  // Label vide : on rend les enfants tels quels, sans bulle.
  if (!label) {
    return <>{children}</>;
  }

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onTouchStart={show}
    >
      {children}
      {visible && coords && createPortal(
        <span
          ref={bubbleRef}
          role="tooltip"
          className="pointer-events-none fixed z-[200] -translate-x-1/2 whitespace-nowrap max-w-xs rounded-lg bg-slate-900 px-2 py-1 text-xs text-white shadow-lg"
          style={{
            top: coords.top,
            left: coords.left,
            transform: `translate(-50%, ${isTop ? 'calc(-100% - 8px)' : '8px'})`,
          }}
        >
          {label}
        </span>,
        document.body
      )}
    </span>
  );
};

export default Tooltip;
