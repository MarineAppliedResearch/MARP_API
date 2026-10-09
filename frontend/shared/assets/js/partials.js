(function () {
  async function loadPartials() {
    var targets = document.querySelectorAll('[data-include]');
    for (var i = 0; i < targets.length; i += 1) {
      var node = targets[i];
      var includePath = node.getAttribute('data-include');
      if (!includePath) {
        continue;
      }

      try {
        var response = await fetch(includePath, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Partial load failed: ' + includePath);
        }

        node.innerHTML = await response.text();

        /* A partial can carry a control that wires itself, and by the time it lands the
           wiring has already been and gone: the shared account menu mounts on
           DOMContentLoaded, which is over before this fetch returns, so the header drew
           nobody for ever (#151). Mounting is idempotent, so asking again is safe. */
        if (window.MarpAccountMenu) {
          window.MarpAccountMenu.mountAll();
        }
      } catch (error) {
        console.error(error);
        node.innerHTML = '<!-- Failed to load ' + includePath + ' -->';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPartials);
  } else {
    loadPartials();
  }
})();
