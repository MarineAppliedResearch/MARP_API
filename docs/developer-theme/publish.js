/**
 * The MARP developer documentation template.
 *
 * jsdoc resolves a template by its directory: it reads `tmpl/` and copies
 * `static/` from whatever `opts.template` points at, and calls `publish` from
 * this file. So a template that wants its own markup has to be its own
 * directory, even when it wants none of its own logic.
 *
 * This carries none. The nav builder, the section ordering, the search index
 * and the source-file rendering are all docdash's and stay docdash's, so a
 * version bump is a real upgrade rather than a merge. What MARP forks is the
 * part that decides how the site looks: `tmpl/layout.tmpl` and
 * `static/styles/`. See `README.md` beside this file for the whole diff.
 *
 * @module docs/developer-theme
 */
module.exports = require('docdash/publish.js');
