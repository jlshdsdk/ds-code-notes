export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  wrapped.flush = (...args: A) => {
    if (t) {
      clearTimeout(t);
      t = null;
      fn(...args);
    }
  };
  wrapped.cancel = () => {
    if (t) {
      clearTimeout(t);
      t = null;
    }
  };
  return wrapped;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
