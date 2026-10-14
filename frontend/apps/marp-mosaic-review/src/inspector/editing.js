/**
 * Box editing on the video page (#181): the annotation GUI's controls, by mouse and by touch.
 *
 * | GUI | mouse | touch (A10) |
 * | --- | --- | --- |
 * | select | click a box | tap a box |
 * | move | drag its body | drag its body |
 * | resize | drag a corner grip of the selected box | the same |
 * | pin, or take a keyframe away | double click | double tap |
 * | the menu | right click | long press |
 *
 * Releasing a drag saves it, straight away, and a press that moved nothing saves nothing --
 * as the GUI does. A keyframe on the picture is moved and keeps its frame and kind; an
 * in-between box becomes a new middle keyframe at the picture's time. The last save wins.
 *
 * Presses that land on no box are left for the player, so its own controls go on working
 * underneath. The rules are `model/box-edit.js`; this file is the events and the saves.
 */
import { MarpApi } from '../api/index.js';
import {
  hitTest, dragged, toRecord, keyframeShown, menuFor, trackKey,
  DRAG_SLOP, DOUBLE_PRESS_MS, LONG_PRESS_MS
} from '../model/box-edit.js';

/**
 * @param {Object} options
 * @param {HTMLElement} options.stage - Holds the player and the overlay; presses land here.
 * @param {HTMLCanvasElement} options.overlay - The boxes' canvas, for where a press is.
 * @param {HTMLElement} options.menu - The menu's element, filled and placed here.
 * @param {Object} options.host - The page: `drawn()`, `time()`, `frameRate()`, `pause()`,
 *   `redraw()`, `apply(answer)`, `deleteObservation(id)`, `status(text)`.
 */
export function createBoxEditor({ stage, overlay, menu, host }) {
  let enabled = false;
  let canDeleteObservations = false;

  /* The selected track, by the GUI's key: observation and subset. */
  let selectedKey = null;

  /* The box being dragged, drawn in place of the record until its save has landed. */
  let preview = null;

  /* Draw order: a pressed box comes to the front, as the GUI's does; Send To Back sends one
     behind the rest. Unranked boxes keep the page's own order. */
  const rank = new Map();
  let front = 0;
  let back = 0;

  let gesture = null;
  let lastPress = null;
  let longPress = null;

  /* Saves run one at a time, in the order they were made. */
  let saving = Promise.resolve();

  function pointIn(event) {
    const rect = overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function entryFor(key) {
    return host.drawn().rects.find((entry) => entry.key === key) || null;
  }

  function closeMenu() {
    menu.hidden = true;
    menu.replaceChildren();
  }

  function cancelLongPress() {
    if (longPress) clearTimeout(longPress);
    longPress = null;
  }

  function select(key) {
    selectedKey = key;
    rank.set(key, ++front);
  }

  /* Queue one save, and fold its answer into what the page holds. */
  function save(work) {
    saving = saving.then(async () => {
      try {
        const answers = await work();
        for (const answer of [].concat(answers || [])) host.apply(answer);
      } catch (error) {
        host.status(`The change was not saved: ${error.message}`);
      } finally {
        preview = null;
        host.redraw();
      }
    });
    return saving;
  }

  /* The box as the record now has it on this picture, and its keyframe here, if any. */
  function boxHere(entry) {
    const t = host.time();
    return { t, keyframe: keyframeShown(entry.box.keyframes, t, host.frameRate()) };
  }

  function addAt(entry, t, box) {
    return MarpApi.addKeyframe({ observationId: entry.box.observation_id, subset: entry.box.subset, t, box });
  }

  /* Releasing a move or a resize: the keyframe on the picture is moved, or an in-between
     box becomes a middle keyframe here. */
  function commitDrag(entry, rect, area) {
    const box = toRecord(rect, area);
    const { t, keyframe } = boxHere(entry);
    return save(() => (keyframe ? MarpApi.moveKeyframe(keyframe.keyframe_id, box) : addAt(entry, t, box)));
  }

  /* Double click: pin an in-between box, or take a keyframe away. */
  function toggleKeyframe(entry) {
    const { t, keyframe } = boxHere(entry);
    return save(() => (keyframe ? MarpApi.deleteKeyframe(keyframe.keyframe_id) : addAt(entry, t, entry.box)));
  }

  function act(action, entry) {
    const { t, keyframe } = boxHere(entry);
    if (action === 'pin') return save(() => addAt(entry, t, entry.box));
    if (action === 'end') {
      return save(async () => {
        if (keyframe) return MarpApi.setEndKeyframe(keyframe.keyframe_id);
        // An in-between box set as the end is pinned here first, then made the end.
        const added = await addAt(entry, t, entry.box);
        return [added, await MarpApi.setEndKeyframe(added.changed[0].keyframe_id)];
      });
    }
    if (action === 'deleteKeyframe' && keyframe) return save(() => MarpApi.deleteKeyframe(keyframe.keyframe_id));
    if (action === 'back') {
      rank.set(entry.key, --back);
      host.redraw();
    }
    if (action === 'deleteObservation') {
      const { observation_id: id, comname } = entry.box;
      // Deleting is permanent and leaves no trace, so it is asked about; nothing else is.
      if (window.confirm(`Delete observation ${id}${comname ? ` (${comname})` : ''} and every keyframe it has? This cannot be undone.`)) {
        return saving = saving.then(() => host.deleteObservation(id)).catch((error) => {
          host.status(`The observation was not deleted: ${error.message}`);
        });
      }
    }
    return null;
  }

  /* The pointer says what a press would do, as the GUI's does: move over a box, a resize
     arrow over a grip of the selected one. A class on the stage, because the player's own
     layers under it set cursors of their own. */
  const CURSORS = { body: 'cursor-move', tl: 'cursor-nwse', br: 'cursor-nwse', tr: 'cursor-nesw', bl: 'cursor-nesw' };
  function showCursor(part) {
    for (const name of Object.values(CURSORS)) stage.classList.toggle(name, CURSORS[part] === name);
  }

  function openMenu(entry, point) {
    const { t, keyframe } = boxHere(entry);
    const items = menuFor({ ...entry.box, keyframe, t })
      .filter((item) => item.action !== 'deleteObservation' || canDeleteObservations);
    menu.replaceChildren(...items.map((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.dataset.action = item.action;
      button.disabled = Boolean(item.disabled);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMenu();
        act(item.action, entry);
      });
      return button;
    }));
    menu.hidden = false;
    // Inside whatever holds it -- the player, so it shows in fullscreen too -- however near
    // its edge the press was.
    const hostRect = (menu.offsetParent || stage).getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const x = point.x + overlayRect.left - hostRect.left;
    const y = point.y + overlayRect.top - hostRect.top;
    menu.style.left = `${Math.max(0, Math.min(x, hostRect.width - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, hostRect.height - menu.offsetHeight))}px`;
  }

  function onPointerDown(event) {
    if (!enabled) return;
    if (menu.contains(event.target)) return;
    if (!menu.hidden) closeMenu();
    const point = pointIn(event);
    const hit = hitTest(host.drawn().rects, point, selectedKey);
    if (!hit) {
      // The picture, not a box: the player's, and the selection is let go.
      if (selectedKey && event.button === 0) {
        selectedKey = null;
        host.redraw();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;

    host.pause();
    select(hit.key);
    const entry = entryFor(hit.key);
    const now = performance.now();
    if (lastPress && lastPress.key === hit.key && now - lastPress.at < DOUBLE_PRESS_MS) {
      lastPress = null;
      gesture = null;
      host.redraw();
      toggleKeyframe(entry);
      return;
    }
    lastPress = { key: hit.key, at: now };
    gesture = {
      pointerId: event.pointerId, key: hit.key, part: hit.part,
      start: point, rect: entry.rect, area: host.drawn().area, moved: false
    };
    stage.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') {
      longPress = setTimeout(() => {
        longPress = null;
        gesture = null;
        preview = null;
        openMenu(entry, point);
      }, LONG_PRESS_MS);
    }
    host.redraw();
  }

  function onPointerMove(event) {
    if (!gesture) {
      if (enabled && event.pointerType === 'mouse') {
        const hit = hitTest(host.drawn().rects, pointIn(event), selectedKey);
        showCursor(hit ? hit.part : null);
      }
      return;
    }
    if (event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointIn(event);
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    gesture.moved = true;
    lastPress = null;
    cancelLongPress();
    preview = { key: gesture.key, part: gesture.part, rect: dragged(gesture.rect, gesture.part, dx, dy, gesture.area) };
    host.redraw();
  }

  function onPointerUp(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.stopPropagation();
    cancelLongPress();
    const done = gesture;
    gesture = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (event.type === 'pointerup' && done.moved && preview) {
      const entry = entryFor(done.key);
      if (entry) {
        commitDrag(entry, preview.rect, done.area);
        return;
      }
    }
    preview = null;
    host.redraw();
  }

  function onContextMenu(event) {
    if (!enabled) return;
    const point = pointIn(event);
    const hit = hitTest(host.drawn().rects, point, selectedKey);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    cancelLongPress();
    gesture = null;
    select(hit.key);
    host.redraw();
    openMenu(entryFor(hit.key), point);
  }

  stage.addEventListener('pointerdown', onPointerDown, true);
  stage.addEventListener('pointermove', onPointerMove, true);
  stage.addEventListener('pointerup', onPointerUp, true);
  stage.addEventListener('pointercancel', onPointerUp, true);
  stage.addEventListener('contextmenu', onContextMenu, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) closeMenu();
  });

  return {
    /* Turned on for a user who may write keyframes; delete only with `observations:write`. */
    enable({ deleteObservations = false } = {}) {
      enabled = true;
      canDeleteObservations = deleteObservations;
      stage.classList.add('editing');
    },
    get enabled() { return enabled; },
    get selectedKey() { return selectedKey; },
    /* The part of a box being pressed, so it is drawn in the GUI's state colour from the
       press, not only once it moves. */
    pressFor(key) { return gesture && gesture.key === key ? gesture.part : null; },
    /* The dragged rectangle to draw for a box, in place of the record's, or null. */
    previewFor(key) { return preview && preview.key === key ? preview : null; },
    /* Draw order: lower first. The opened observation sits above unranked boxes. */
    rankOf(key, opened) { return rank.has(key) ? rank.get(key) : (opened ? 0.5 : 0); },
    /* A new video or query: nothing selected, nothing dragged, the menu shut. */
    reset() {
      selectedKey = null;
      preview = null;
      gesture = null;
      rank.clear();
      closeMenu();
    },
    trackKey
  };
}
