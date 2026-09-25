// Applies the chosen theme before the page is drawn, so it does not show up
// dark first. ThemeService takes over once Picsur has started.
(function () {
  var theme = 'dark';
  try {
    theme = localStorage.getItem('theme') || 'dark';
  } catch (e) {}
  var light =
    theme === 'light' ||
    (theme === 'system' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches);
  if (light) document.documentElement.classList.add('theme-light');
})();
