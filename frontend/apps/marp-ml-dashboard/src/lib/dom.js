/**
 * The whole DOM builder. Deliberately small.
 *
 * `h` does not parse HTML strings, on purpose. A fixture field interpolated
 * into innerHTML is how a mockup grows an injection bug that then survives
 * into the real application, and every string in this app comes from data.
 */

/**
 * h('div', { class: 'panel', dataState: 'running', onclick: fn }, ...children)
 *
 * Recognised props: `class`/`className`, `style` (string or object), `html`
 * (an explicit escape hatch, used only for inline SVG we author ourselves),
 * anything starting `on` (a listener), `data*`/`aria*` (attributes), and
 * everything else set as an attribute unless it is a boolean.
 *
 * Children may be nodes, strings, numbers, arrays, or null/false/undefined
 * (skipped, so `cond && h(...)` reads naturally).
 */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign(el.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v);
    } else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') {
      el[k] = v;                          // properties, not attributes
      if (v === true) el.setAttribute(k, '');
    } else {
      el.setAttribute(attrName(k), v === true ? '' : String(v));
    }
  }
  add(el, kids);
  return el;
}

/** dataState -> data-state, ariaSort -> aria-sort, htmlFor -> for. */
function attrName(k) {
  if (k === 'htmlFor') return 'for';
  return k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

function add(el, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false || kid === true) continue;
    if (Array.isArray(kid)) add(el, kid);
    else if (kid instanceof Node) el.appendChild(kid);
    else el.appendChild(document.createTextNode(String(kid)));
  }
}

/** A fragment, for returning several siblings from one function. */
export function frag(...kids) {
  const f = document.createDocumentFragment();
  add(f, kids);
  return f;
}

/** Empty an element and put these children in it. */
export function fill(el, ...kids) {
  el.replaceChildren();
  add(el, kids);
  return el;
}

/** `$('.sel', root)` and `$$('tr', root)`, scoped and never global. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
