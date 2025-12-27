// game.js
// Language select screen navigation.

function goTo(url) {
  window.location.href = url;
}

document.addEventListener("DOMContentLoaded", () => {
  const backBtn = document.querySelector('[data-action="back"]');
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      // Adjust this destination if your main menu page differs.
      goTo("index.html");
    });
  }

  /** @type {NodeListOf<HTMLButtonElement>} */
  const langBtns = document.querySelectorAll(".lang-btn");
  langBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang || "ja";

      // If you already have dedicated pages, change these to e.g.
      //   ja -> 'index.html'
      //   fr -> 'fr.html'
      //   es -> 'es.html'
      // For now we pass a query param so one quiz page can branch on it.
      goTo(`index.html?lang=${encodeURIComponent(lang)}`);
    });
  });
});
