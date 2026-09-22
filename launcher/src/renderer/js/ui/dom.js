/** Minimal DOM helpers — enough structure to keep views declarative. */

/** Create an element. `props` supports class, text, html, dataset, style, on*, aria*. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') applyStyle(node, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }

  return node;
}

/* Object.assign onto a CSSStyleDeclaration silently drops custom properties,
   so per-element theming (--tag-c, --brand-h) has to go through setProperty. */
function applyStyle(node, style) {
  for (const [name, value] of Object.entries(style)) {
    if (name.startsWith('--')) node.style.setProperty(name, value);
    else node.style[name] = value;
  }
}

export const qs = (selector, scope = document) => scope.querySelector(selector);
export const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** Replace an element's children in one operation. */
export function mount(container, ...children) {
  container.replaceChildren(...children.filter(Boolean));
  return container;
}

/** Escape text destined for an innerHTML template. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/**
 * Trap Tab focus inside a container and restore it on teardown.
 * Every overlay in the app uses this so keyboard users are never stranded
 * behind a modal.
 */
export function trapFocus(container, initial) {
  const previous = document.activeElement;
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  const focusables = () => [...container.querySelectorAll(selector)].filter((node) => node.offsetParent !== null);

  const onKeydown = (event) => {
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKeydown);
  // Synchronous: the container is already in the document when this is called,
  // and rAF does not fire while the window is hidden. preventScroll matters
  // while the container is still animating in — without it the browser scrolls
  // to the focused node mid-slide and the panel judders.
  (initial || focusables()[0])?.focus({ preventScroll: true });

  return () => {
    container.removeEventListener('keydown', onKeydown);
    if (previous instanceof HTMLElement) previous.focus();
  };
}

/**
 * A ResizeObserver that lets go of a node that has left the page (2026-09-22).
 *
 * A plain `new ResizeObserver(fn).observe(node)` is a leak in a launcher that
 * rebuilds a page on every visit: the observer is registered with the document
 * and holds its target, the target holds the detached subtree under it — a
 * player model's seventy-two boxes, a card of faces drawn as data URIs — and
 * nothing ever disconnects it, because a node that is no longer in the page
 * never resizes and so never calls the callback that might have noticed. Home
 * made three of them per visit (two lists and the model) and Cosmetics one
 * more, for the launcher's life.
 *
 * Every observer made here is remembered, and each new one first drops any
 * whose node has since been detached. So the cost is bounded at one stale
 * observer per call site rather than one per visit, with no page lifecycle to
 * hook into and no handle for the caller to remember to use.
 */
const observers = new Set();

export function observeSize(node, callback) {
  if (typeof ResizeObserver !== 'function' || !node) return null;
  for (const entry of [...observers]) {
    if (entry.node.isConnected) continue;
    entry.ro.disconnect();
    observers.delete(entry);
  }
  const ro = new ResizeObserver(callback);
  ro.observe(node);
  observers.add({ ro, node });
  return ro;
}
