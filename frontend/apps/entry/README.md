# MARP Public Landing Page Prototype

This package is a standalone, static prototype for the public MARP landing page.
It is intentionally independent from the existing MARP frontend so its visual
language and responsive behavior can be reviewed before repository integration.

## Files

```text
marp-landing/
├── index.html
├── assets/
│   ├── css/landing.css
│   ├── js/landing.js
│   └── images/
└── README.md
```

## Local preview

From the `marp-landing` directory:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Prototype behavior

- Navigation links scroll to landing-page sections.
- Login controls open an accessible login dialog.
- The login form validates input but does not send credentials.
- API and developer documentation buttons use the intended production routes:
  `/api-docs` and `/developer-docs`.
- Layouts are provided for desktop, tablet, and mobile widths.

## Architecture notes

- HTML contains semantic content and a reusable inline SVG icon sprite.
- CSS is organized by component and owns all responsive behavior.
- JavaScript is limited to navigation, dialog, reveal, and header interactions.
- Large visual assets are normal image files; no Base64 images are embedded.
