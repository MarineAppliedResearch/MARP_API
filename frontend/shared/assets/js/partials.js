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
