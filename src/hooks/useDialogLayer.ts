import { useLayoutEffect, useRef } from 'react';

type Layer = { node: HTMLElement; escape: () => void; previous: HTMLElement | null; priority: number };
const layers: Layer[] = [];
const subscribers = new Set<() => void>();
export const getTopDialogNode = () => layers[layers.length - 1]?.node ?? null;
export const subscribeDialogLayers = (notify: () => void) => {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
};
const notifyLayers = () => { for (const notify of subscribers) notify(); };
const originalInert = new Map<HTMLElement, boolean>();
let savedBody: { overflow: string; paddingRight: string } | undefined;
let observer: MutationObserver | undefined;
const focusable = (node: HTMLElement) => Array.from(node.querySelectorAll<HTMLElement>(
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
)).filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');

function focusInside(layer: Layer) {
  const preferred = layer.node.querySelector<HTMLElement>('[data-autofocus]');
  const controls = focusable(layer.node);
  (preferred && controls.includes(preferred) ? preferred : controls[0] || layer.node).focus({ preventScroll: true });
}
function updateBackground() {
  layers.forEach((layer, index) => { layer.node.style.zIndex = String(10000 + (index + 1) * 10); });
  for (const [node, value] of originalInert) node.inert = value;
  originalInert.clear();
  const top = layers[layers.length - 1];
  if (!top) return;
  // Walk ancestors as well: supports both body portals and the mobile drawer.
  let active: HTMLElement = top.node;
  while (active.parentElement) {
    for (const sibling of Array.from(active.parentElement.children)) {
      if (sibling !== active && sibling instanceof HTMLElement && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
        originalInert.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }
    if (active.parentElement === document.body) break;
    active = active.parentElement;
  }
}
function keydown(event: KeyboardEvent) {
  const top = layers[layers.length - 1];
  if (!top || event.defaultPrevented) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    top.escape();
  } else if (event.key === 'Tab') {
    const controls = focusable(top.node);
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (!controls.length) { event.preventDefault(); top.node.focus(); }
    else if (event.shiftKey && index <= 0) { event.preventDefault(); controls[controls.length - 1].focus(); }
    else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  }
}
function focusin(event: FocusEvent) {
  const top = layers[layers.length - 1];
  if (top && event.target instanceof Node && !top.node.contains(event.target)) focusInside(top);
}

/** A shared stack keeps nested dialogs from unlocking or focusing their background. */
export function useDialogLayer(isOpen: boolean, onEscape: () => void, priority = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useLayoutEffect(() => {
    if (!isOpen || !ref.current) return;
    const node = ref.current;
    const initialZIndex = node.style.zIndex;
    const layer: Layer = { node, escape: () => escapeRef.current(), previous: document.activeElement instanceof HTMLElement ? document.activeElement : null, priority };
    if (!layers.length) {
      savedBody = { overflow: document.body.style.overflow, paddingRight: document.body.style.paddingRight };
      const gap = window.innerWidth - document.documentElement.clientWidth;
      if (gap > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + gap}px`;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', keydown);
      document.addEventListener('focusin', focusin, true);
      observer = new MutationObserver(updateBackground);
      observer.observe(document.body, { childList: true });
    }
    layers.push(layer);
    layers.sort((a, b) => a.priority - b.priority);
    updateBackground();
    if (layers[layers.length - 1] === layer) focusInside(layer);
    notifyLayers();
    return () => {
      node.style.zIndex = initialZIndex;
      const index = layers.indexOf(layer);
      const wasTop = index === layers.length - 1;
      if (index >= 0) layers.splice(index, 1);
      updateBackground();
      if (!layers.length) {
        observer?.disconnect();
        document.removeEventListener('keydown', keydown);
        document.removeEventListener('focusin', focusin, true);
        if (savedBody) Object.assign(document.body.style, savedBody);
        savedBody = undefined;
      }
      if (wasTop) {
        const next = layers[layers.length - 1];
        if (layer.previous?.isConnected && !layer.previous.closest('[inert]') && (!next || next.node.contains(layer.previous))) {
          layer.previous.focus({ preventScroll: true });
        } else if (next) focusInside(next);
      }
      notifyLayers();
    };
  }, [isOpen, priority]);
  return ref;
}
