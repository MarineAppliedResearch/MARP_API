/**
 * What a key press means, and when it means nothing.
 *
 * Pure: it takes a description of the event and the context, and returns an action name
 * or null. No DOM, no store — so the awkward question ("does this fire while somebody is
 * typing in the species search?") is answerable in a unit test rather than by driving a
 * browser and hoping.
 *
 * The shortcuts are page-level on purpose. Marking a tile with a pointer is one action
 * with no traversal; arrow-and-space is two keystrokes plus the walk between tiles. So
 * the pointer selects and the keyboard commands, and there is deliberately no keyboard
 * cursor through the grid. See MARP_API#68, corrected 2026-09-05.
 */

/**
 * The whole set. Ordered as a reviewer would meet them: move, tidy, switch, commit.
 *
 * `keys` are matched case-insensitively against `event.key`. `chord` means Ctrl or Cmd
 * must be held; anything without it must never be destructive.
 */
export const SHORTCUTS = [
  { action: 'nextPage', keys: ['ArrowRight', 'n'], label: 'Next page', hint: 'N' },
  { action: 'prevPage', keys: ['ArrowLeft', 'p'], label: 'Previous page', hint: 'P' },
  { action: 'clearMarks', keys: ['c'], label: "Clear this page's marks", hint: 'C' },
  { action: 'modeScientific', keys: ['1'], label: 'Scientific Data Review', hint: '1' },
  { action: 'modeTraining', keys: ['2'], label: 'Training Data Review', hint: '2' },
  { action: 'modeDelete', keys: ['3'], label: 'Delete', hint: '3' },
  /* The one chord. Committing is irreversible and, outside Delete Mode, ungated -- a
     stray keypress would review a page of records silently. */
  { action: 'commitPage', keys: ['Enter'], chord: true, label: 'Commit the page', hint: 'Ctrl+Enter' },
];

/** The hint for one action, for drawing on the control it duplicates. */
export const hintFor = (action) =>
  (SHORTCUTS.find((s) => s.action === action) || {}).hint || null;

/**
 * Tags whose keystrokes belong to them and not to the application.
 *
 * `menus.js` already binds keys on the species search; without this, typing "no imagery"
 * into it would page forward twice and clear the page's marks on the way.
 */
const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * @param {object} event            { key, ctrlKey, metaKey, altKey, shiftKey }
 * @param {object} context
 * @param {string} [context.tagName]      the focused element's tag
 * @param {boolean} [context.isEditable]  contenteditable, which no tag name reveals
 * @param {boolean} [context.modalOpen]   a dialog owns the keyboard while it is up
 * @returns {string|null} the action to run, or null
 */
export function resolveKey(event, context = {}) {
  if (!event || !event.key) return null;

  /* A modal owns the keyboard. The delete confirmation takes Escape itself, and paging
     out from underneath an open confirmation would leave it describing a page that is no
     longer there. */
  if (context.modalOpen) return null;

  if (TYPING.has((context.tagName || '').toUpperCase()) || context.isEditable) return null;

  /* Alt and Shift are left alone: they belong to the browser and the operating system,
     and a shortcut that fights them is a shortcut people turn off. */
  if (event.altKey || event.shiftKey) return null;

  const chord = Boolean(event.ctrlKey || event.metaKey);

  for (const shortcut of SHORTCUTS) {
    if (Boolean(shortcut.chord) !== chord) continue;
    if (shortcut.keys.some((k) => k.toLowerCase() === event.key.toLowerCase())) {
      return shortcut.action;
    }
  }
  return null;
}
