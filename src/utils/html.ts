/** Escape untrusted text before interpolating it into printable HTML. */
export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export const trustedImageUrl = (value: unknown): string => {
  const url = String(value || '');
  return /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(url)
    ? url
    : '';
};

/** Attribute escaping is for HTML strings only; React escapes its own attributes. */
export const safeImageUrl = (value: unknown): string => escapeHtml(trustedImageUrl(value));
