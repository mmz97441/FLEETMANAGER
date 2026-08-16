import React, { useCallback, useEffect, useRef, useState } from 'react';

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
}

const AUTO_HIDE_MS = 3000;

/**
 * Reusable, dependency-free tooltip.
 * - Shows on mouseenter/focus (and touchstart for touch devices).
 * - Auto-hides after 3s even if still hovered.
 * - Hides immediately on mouseleave/blur.
 */
const Tooltip: React.FC<TooltipProps> = ({ label, children, side = 'top' }) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearTimer();
    setVisible(true);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, AUTO_HIDE_MS);
  }, [clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  // Clean up any pending timer on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  // Empty label: render children untouched, no bubble.
  if (!label) {
    return <>{children}</>;
  }

  const isTop = side === 'top';

  const bubblePosition = isTop
    ? 'bottom-full mb-2'
    : 'top-full mt-2';

  const arrowPosition = isTop
    ? '-bottom-1'
    : '-top-1';

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onTouchStart={show}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden={!visible}
        className={[
          'pointer-events-none absolute left-1/2 -translate-x-1/2',
          bubblePosition,
          'z-[130] whitespace-nowrap max-w-xs',
          'rounded-lg bg-slate-900 px-2 py-1 text-xs text-white shadow-lg',
          'origin-center transition-all duration-150 ease-out',
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
        ].join(' ')}
      >
        {label}
        <span
          className={[
            'absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900',
            arrowPosition,
          ].join(' ')}
          aria-hidden="true"
        />
      </span>
    </span>
  );
};

export default Tooltip;
