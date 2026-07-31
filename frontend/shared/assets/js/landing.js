/**
 * MARP public landing page interactions.
 *
 * Responsibilities:
 * 1. Manage the responsive navigation menu.
 * 2. Open and close the login dialog accessibly.
 * 3. Provide the password visibility control.
 * 4. Submit the login form to POST /api/v2/auth/login and, on success,
 *    redirect to the dashboard app.
 * 5. Add subtle scroll-based header and reveal behavior.
 */

"use strict";

// Add the JS marker immediately so CSS enhancement rules can activate.
document.documentElement.classList.add("js");

/**
 * Initializes all landing-page behavior after the DOM is available.
 * Inputs: none.
 * Output: none.
 * Usage: registered once on DOMContentLoaded at the bottom of this file.
 */
function initializeLandingPage() {

  initializeMobileNavigation();
  initializeLoginDialog();
  initializeScrollEffects();
  initializeCurrentYear();
}


/**
 * Controls the mobile navigation panel and its accessibility state.
 * Inputs: DOM elements selected by data attributes.
 * Output: updated menu classes, aria-expanded state, and body scroll state.
 * Usage: called once during page initialization.
 */
function initializeMobileNavigation() {

  const toggleButton = document.querySelector("[data-menu-toggle]");
  const navigation = document.querySelector("[data-primary-nav]");

  if (!toggleButton || !navigation) {
    return;
  }

  const closeMenu = () => {
    toggleButton.setAttribute("aria-expanded", "false");
    toggleButton.setAttribute("aria-label", "Open navigation menu");
    navigation.classList.remove("is-open");
    document.body.classList.remove("menu-open");
  };

  const openMenu = () => {
    toggleButton.setAttribute("aria-expanded", "true");
    toggleButton.setAttribute("aria-label", "Close navigation menu");
    navigation.classList.add("is-open");
    document.body.classList.add("menu-open");
  };

  toggleButton.addEventListener("click", () => {
    const isExpanded = toggleButton.getAttribute("aria-expanded") === "true";

    if (isExpanded) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a") || event.target.closest("[data-login-open]")) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) {
      closeMenu();
    }
  });
}


/**
 * Configures the login dialog, including submitting credentials to the
 * real session-login endpoint.
 * Inputs: all elements carrying the login dialog data attributes.
 * Output: dialog open/close state, a login-status message, and (on success)
 * a redirect to the dashboard app.
 * Usage: called once during page initialization.
 */
function initializeLoginDialog() {

  const dialog = document.querySelector("[data-login-dialog]");
  const openButtons = document.querySelectorAll("[data-login-open]");
  const closeButton = document.querySelector("[data-login-close]");
  const loginForm = document.querySelector("[data-login-form]");
  const statusMessage = document.querySelector("[data-login-status]");
  const passwordInput = document.querySelector("[data-password-input]");
  const passwordToggle = document.querySelector("[data-password-toggle]");

  if (!dialog) {
    return;
  }

  const openDialog = () => {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      document.body.classList.add("dialog-open");

      const usernameInput = dialog.querySelector("input[name='username']");
      window.setTimeout(() => usernameInput?.focus(), 40);
    }
  };

  const closeDialog = () => {
    if (dialog.open) {
      dialog.close();
    }

    document.body.classList.remove("dialog-open");
  };

  openButtons.forEach((button) => {
    button.addEventListener("click", openDialog);
  });

  closeButton?.addEventListener("click", closeDialog);

  // Clicking the shaded backdrop closes the modal without interfering with
  // clicks inside the dialog panel itself.
  dialog.addEventListener("click", (event) => {
    const dialogBounds = dialog.getBoundingClientRect();
    const clickWasInside = (
      event.clientX >= dialogBounds.left &&
      event.clientX <= dialogBounds.right &&
      event.clientY >= dialogBounds.top &&
      event.clientY <= dialogBounds.bottom
    );

    if (!clickWasInside) {
      closeDialog();
    }
  });

  dialog.addEventListener("close", () => {
    document.body.classList.remove("dialog-open");
  });

  passwordToggle?.addEventListener("click", () => {
    if (!passwordInput) {
      return;
    }

    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    passwordToggle.setAttribute("aria-pressed", String(!isVisible));
    passwordToggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  });

  loginForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!loginForm.checkValidity()) {
      loginForm.reportValidity();
      return;
    }

    const submitButton = loginForm.querySelector("button[type='submit']");
    const username = loginForm.elements.username.value;
    const password = loginForm.elements.password.value;

    if (statusMessage) {
      statusMessage.textContent = "Signing in…";
    }

    submitButton?.setAttribute("disabled", "true");

    fetch("/api/v2/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    })
      .then(async (response) => {
        if (!response.ok) {
          // The API returns a standardized { error: { message, ... } }
          // envelope on every non-2xx response (see
          // middleware/error-contract.middleware.js) -- covers wrong
          // password, unknown username, and rate-limited attempts alike.
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message || "Sign in failed. Please try again.");
        }

        if (statusMessage) {
          statusMessage.textContent = "Signed in — redirecting…";
        }

        window.location.href = "/apps/dashboard/index.html";
      })
      .catch((error) => {
        if (statusMessage) {
          statusMessage.textContent = error.message;
        }

        submitButton?.removeAttribute("disabled");
      });
  });
}


/**
 * Adds the scrolled header style, active navigation state, and reveal effects.
 * Inputs: page sections and elements marked with data-reveal.
 * Output: CSS classes that describe current scroll position and visibility.
 * Usage: called once during page initialization.
 */
function initializeScrollEffects() {

  const header = document.querySelector("[data-site-header]");
  const revealElements = document.querySelectorAll("[data-reveal]");
  const sectionLinks = Array.from(document.querySelectorAll(".primary-nav a[href^='#']"));
  const sections = sectionLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  const updateHeader = () => {
    header?.classList.toggle("is-scrolled", window.scrollY > 18);
  };

  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: "0px 0px -8% 0px"
    });

    revealElements.forEach((element) => revealObserver.observe(element));

    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        sectionLinks.forEach((link) => {
          const matchesSection = link.getAttribute("href") === `#${entry.target.id}`;
          link.classList.toggle("is-active", matchesSection);
        });
      });
    }, {
      rootMargin: "-35% 0px -55% 0px",
      threshold: 0
    });

    sections.forEach((section) => sectionObserver.observe(section));
  } else {
    revealElements.forEach((element) => element.classList.add("is-visible"));
  }
}


/**
 * Writes the current year into footer placeholders.
 * Inputs: elements marked with data-current-year.
 * Output: text content containing the current four-digit year.
 * Usage: called once during page initialization.
 */
function initializeCurrentYear() {

  const currentYear = String(new Date().getFullYear());
  document.querySelectorAll("[data-current-year]").forEach((element) => {
    element.textContent = currentYear;
  });
}


document.addEventListener("DOMContentLoaded", initializeLandingPage);
