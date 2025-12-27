// Start screen only (no gameplay yet)
(() => {
  const backBtn = document.getElementById("back-btn");
  const langBtns = Array.from(document.querySelectorAll(".lang-btn"));

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.location.href = "./index.html";
    });
  }

  langBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      // Visual selection
      langBtns.forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");

      // Save for future game implementation
      const lang = btn.getAttribute("data-lang") || "";
      try {
        localStorage.setItem("wow_game_lang", lang);
      } catch (_) {
        // ignore
      }

      // TODO: Later, navigate to your actual game scene.
      // For now, keep the user on this start screen.
    });
  });
})();
