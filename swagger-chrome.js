/**
 * The MARP bar on the API reference at `/api-docs`.
 *
 * Read by `app.js` and handed to `swagger-ui-express` as `customJsStr`, which
 * inlines it into the page. Script rather than markup because
 * swagger-ui-express renders from a template string with exactly three seams --
 * a stylesheet URL, a script URL, and an inline script -- and none of them take
 * HTML. The developer documentation carries the same bar, rendered directly by
 * its template, which is the better way round and is not available here.
 *
 * `tests/docs-branding.test.js` asserts the two carry the same links, because
 * this is the half that will be forgotten.
 *
 * It runs before Swagger UI has mounted. That is deliberate: the bar is
 * prepended to the body rather than to `#swagger-ui`, so it does not race the
 * React render and does not get thrown away by it.
 *
 * Styled by `swagger.css`, under *The MARP bar*.
 */
(function () {
  var bar = document.createElement('header');
  bar.className = 'marp-bar';

  bar.innerHTML = [
    '<a class="marp-bar__brand" href="/">',
    '<img src="/assets/images/marp-logo-compact.png" alt="MARP" height="26">',
    '</a>',
    '<span class="marp-bar__here">API reference</span>',
    '<div class="marp-bar__links">',
    '<a href="/developer-docs">Developer documentation</a>',
    '<a href="/">Platform</a>',
    '</div>'
  ].join('');

  document.body.insertBefore(bar, document.body.firstChild);
})();
