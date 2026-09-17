import type { UserMessage } from '../services/logService';

export type VisibleToast = UserMessage & { occurrences: number };
export const toastKey = (message: UserMessage) => `${message.group || 'action'}:${message.level}:${message.message}`;

export function appendToast(previous: VisibleToast[], message: UserMessage): VisibleToast[] {
  const index = previous.findIndex(toast => toastKey(toast) === toastKey(message));
  if (index >= 0) return message.group === 'runtime'
    ? previous.map((toast, i) => i === index ? { ...toast, occurrences: toast.occurrences + 1 } : toast)
    : previous;
  return [...previous.slice(-3), { ...message, occurrences: 1 }];
}
