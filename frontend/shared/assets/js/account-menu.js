/**
 * The MARP account menu, written once (#151).
 *
 * The Picture Mosaic Reviewer and the ML Dashboard each carry their own copy of this
 * control. This is the third place that needs it, so it is the place it stops being
 * copied: the behaviour lives here and the two existing applications can adopt it when
 * somebody decides they should, which is a judgement rather than a refactor to slip in.
 *
 * What makes the landing page different from the other two is the only interesting part.
 * Both of those are served behind a session gate in `app.js`, so by the time their code
 * runs there is certainly a session. The landing page is deliberately open, so it has to
 * ask, and it has to be able to hear "no" without looking broken:
 *
 * - **It asks `GET /api/v2/auth/me`**, which describes itself as the session introspection
 *   endpoint, answers 401 with no session and the user with one, and needs no permission
 *   beyond having a session. Two applications already ask it this question. Nothing new was
 *   invented here, and nothing reads a cookie.
 * - **Anything other than a clean answer means signed out.** A 401 says so; so does a 404
 *   from the static file server the render tier runs against, and so does a network that is
 *   not there. The page a visitor sees is the page that was already there.
 *
 * **Who it draws, and how it is told.** Two ways, because the three applications know
 * different things:
 *
 * - It **asks** by default, which is what an open page has to do.
 * - `data-account-probe="no"` means the host already knows and will say, through
 *   `MarpAccountMenu.show(root, user)`. The Mosaic Reviewer reads the same endpoint at
 *   start-up for its own reasons, and asking twice on every load for one answer is
 *   waste the component does not need to cause.
 *
 * **And what it draws when nobody is signed in.** `data-account-signed-out` says what
 * that should look like: `hide` takes the control off the page, which is what the
 * landing page wants because it has a Sign in button to fall back to; `show` leaves it
 * there saying plainly that nobody is signed in. **It never invents a person.** There is
 * no placeholder name and no set of initials standing in for one, because that is the
 * bug this component exists to end: the ML Dashboard had `IT` and `Isaac Travers` typed
 * into it, and the Mosaic Reviewer once shipped the same literal and told everybody they
 * were one developer.
 *
 * Usage: include this script on a page carrying the markup below, and it wires itself.
 * `window.MarpAccountMenu.mount(root)` is the same thing by hand, for an application that
 * draws its header later than this script runs.
 *
 *   <div class="account" data-account hidden> ... </div>
 *
 * Every control it needs is found by data attribute, so the classes stay the page's own.
 */

"use strict";

(function () {
  var SESSION_URL = "/api/v2/auth/me";
  /* What the avatar shows when there is nobody to show. A mark, not initials, and
     certainly not somebody's. */
  var NOBODY = "\u00b7";
  var SIGNOUT_URL = "/api/v2/auth/logout";

  /**
   * Up to two initials for the button, the way the Mosaic Reviewer already draws them.
   * Falls back to the username, and then to a neutral mark, because the button is round
   * and empty reads as broken.
   *
   * @param {Object} user the user from the session endpoint.
   * @returns {string} one or two characters.
   */
  function initialsOf(user) {
    var name = (user && (user.name || user.username)) || "";
    var parts = name.split(/[\s.]+/).filter(Boolean);
    if (!parts.length) {
      return "?";
    }
    var first = parts[0][0];
    var last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }

  /**
   * Asks who is signed in.
   *
   * @returns {Promise<Object|null>} the user, or null for every other outcome.
   */
  function whoami() {
    return fetch(SESSION_URL, { credentials: "same-origin" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (body) {
        return (body && body.user) || null;
      })
      .catch(function () {
        return null;
      });
  }

  /**
   * Wires one account control: the session probe, the dropdown, and signing out.
   *
   * @param {Element} root the element carrying `data-account`.
   * @returns {void}
   */
  function mount(root) {
    if (!root || root.dataset.accountMounted === "yes") {
      return;
    }
    root.dataset.accountMounted = "yes";

    var button = root.querySelector("[data-account-button]");
    var menu = root.querySelector("[data-account-menu]");
    var who = root.querySelector("[data-account-who]");
    var signOut = root.querySelector("[data-account-signout]");
    if (!button || !menu) {
      return;
    }

    /* `setOpen`, not `show`. It was `show`, which shadowed the `show(root, user)` below
       inside this function -- so the paint that says who is signed in was calling the
       dropdown toggle with a DOM node for its argument, and every application drew nobody
       for ever. Caught by `tools/account-check.mjs` the first time it ran. */
    var setOpen = function (open) {
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    };

    button.addEventListener("click", function (event) {
      event.stopPropagation();
      setOpen(menu.hidden);
    });
    document.addEventListener("click", function () {
      setOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    });

    /* Signing out is the one item here that really acts, so it tells the server and then
       reloads the public page rather than hiding the menu and leaving the session open. */
    if (signOut) {
      signOut.addEventListener("click", function () {
        fetch(SIGNOUT_URL, { method: "POST", credentials: "same-origin" })
          .catch(function () { /* the reload is what the person sees either way */ })
          .then(function () {
            window.location.href = "/";
          });
      });
    }

    if (root.dataset.accountProbe === "no") {
      /* The host will say, and this must not paint over it.

         Wiring happens at DOMContentLoaded while a host that renders from state can have
         painted already -- so drawing `nobody` here would blank a name that had just
         arrived, until whatever the host does next happened to repaint it. The markup
         itself carries the nobody state, so there is nothing to draw until there is
         somebody. */
      return;
    }
    whoami().then(function (user) {
      show(root, user);
    });
  }

  /**
   * Draw who is signed in, or that nobody is.
   *
   * Safe to call as often as you like: an application that re-renders its chrome from
   * state calls this on every pass, and every write here is the same write.
   *
   * @param {Element} root the element carrying `data-account`.
   * @param {Object|null} user the signed-in user, or null for nobody.
   * @returns {void}
   */
  function show(root, user) {
    if (!root) {
      return;
    }
    var button = root.querySelector("[data-account-button]");
    var who = root.querySelector("[data-account-who]");
    var signOut = root.querySelector("[data-account-signout]");
    if (!button) {
      return;
    }

    var name = user && (user.name || user.username);

    if (name) {
      button.textContent = initialsOf(user);
      button.removeAttribute("data-account-nobody");
      button.setAttribute("aria-label", "Account menu for " + name);
      if (who) who.textContent = "Signed in as " + name;
    } else {
      button.textContent = NOBODY;
      button.setAttribute("data-account-nobody", "yes");
      button.setAttribute("aria-label", "Not signed in");
      if (who) who.textContent = "Not signed in";
    }

    /* Signing out is only offered to somebody who is signed in. */
    if (signOut) {
      signOut.hidden = !name;
    }

    /* `hide` is for a page that has something else to offer instead, which on the
       landing page is the Sign in button. `show` is for an application whose chrome
       always carries this control. */
    root.hidden = !name && root.dataset.accountSignedOut !== "show";

    /* The invitation to sign in is what the avatar replaces, so it goes at the same
       moment rather than sitting beside it. */
    var invitations = document.querySelectorAll("[data-signed-out-only]");
    for (var i = 0; i < invitations.length; i += 1) {
      invitations[i].hidden = Boolean(name);
    }
  }

  /**
   * Wires every account control on the page.
   *
   * @returns {void}
   */
  function mountAll() {
    var roots = document.querySelectorAll("[data-account]");
    for (var i = 0; i < roots.length; i += 1) {
      mount(roots[i]);
    }
  }

  window.MarpAccountMenu = { mount: mount, mountAll: mountAll, show: show, whoami: whoami };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }
})();
