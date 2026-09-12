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

    var show = function (open) {
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    };

    button.addEventListener("click", function (event) {
      event.stopPropagation();
      show(menu.hidden);
    });
    document.addEventListener("click", function () {
      show(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        show(false);
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

    whoami().then(function (user) {
      if (!user) {
        return;
      }
      button.textContent = initialsOf(user);
      button.setAttribute("aria-label", "Account menu for " + (user.name || user.username));
      if (who) {
        who.textContent = "Signed in as " + (user.name || user.username);
      }
      root.hidden = false;
      /* The invitation to sign in is what the avatar replaces, so it goes at the same
         moment rather than sitting beside it. */
      var invitations = document.querySelectorAll("[data-signed-out-only]");
      for (var i = 0; i < invitations.length; i += 1) {
        invitations[i].hidden = true;
      }
    });
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

  window.MarpAccountMenu = { mount: mount, mountAll: mountAll, whoami: whoami };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }
})();
