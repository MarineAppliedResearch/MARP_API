/** Small DOM helpers and the icon set. Nothing here knows about state. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build one element from a markup string. */
export const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export const ICON = {
  flag: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h1.6v14H3zM5.6 2h8l-2 3 2 3h-8z"/></svg>',
  tick: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 12.5 2 8l1.4-1.4 3.1 3.1 6.1-6.1L14 5z"/></svg>',
  eye:  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.4 3 1.6 5.6 1 8c.6 2.4 3.4 5 7 5s6.4-2.6 7-5c-.6-2.4-3.4-5-7-5zm0 8a3 3 0 110-6 3 3 0 010 6z"/></svg>',
  del:  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 1h4l.6 1H14v2H2V2h3.4zM3 5h10l-.8 10H3.8z"/></svg>',
  exc:  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM3.9 8a4.1 4.1 0 016.3-3.4L4.6 10.2A4 4 0 013.9 8zm4.1 4.1a4 4 0 01-2.2-.7l5.6-5.6A4.1 4.1 0 018 12.1z"/></svg>',
  pro:  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="m8 1 2 4.4 4.8.5-3.6 3.2 1 4.7L8 11.4 3.8 13.8l1-4.7L1.2 5.9 6 5.4z"/></svg>',
  cross: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M12.6 4.8 11.2 3.4 8 6.6 4.8 3.4 3.4 4.8 6.6 8l-3.2 3.2 1.4 1.4L8 9.4l3.2 3.2 1.4-1.4L9.4 8z"/></svg>'
};

/**
 * The reviewer's initials, for the header button.
 *
 * **The name itself is gone from this file** (R19). It was the literal `'I. Travers'`, and
 * `ui/tile.js` compared it against `decidedBy(row)` to decide "by you" — against four row
 * columns that do not exist, so the badge was true for one person on one machine and
 * silently false for everybody else (F8). The identity comes from `/api/v2/auth/me` and
 * lives in `state.me`; this is only how a name is drawn small.
 *
 * @param {Object|null} me - `state.me`.
 * @returns {string} Up to two initials, or a dash before the identity has arrived.
 */
export const initialsOf = (me) => {
  const name = (me && me.name) || '';
  const parts = name.split(/[\s.]+/).filter(Boolean);
  if (!parts.length) return '\u2014';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};
