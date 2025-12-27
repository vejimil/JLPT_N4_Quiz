(() => {
  const backBtn = document.getElementById('backBtn');
  const toastEl = document.getElementById('toast');

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => toastEl.classList.remove('show'), 1200);
  }

  // Back to index.html
  backBtn?.addEventListener('click', () => {
    // Prefer explicit index.html (as requested)
    window.location.href = 'index.html';
  });

  // Language buttons: placeholder until each language game exists
  document.querySelectorAll('.img-btn.lang').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      // TODO: Replace with your real routes later
      showToast(`Coming soon (${lang})`);

      // Keep URL clean; if you later want query param navigation, you can enable below.
      // const url = new URL(window.location.href);
      // url.searchParams.set('lang', lang);
      // window.location.href = url.toString();
    });
  });
})();
