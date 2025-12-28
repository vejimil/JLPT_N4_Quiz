/*
  difficulty.js
  - Title morphs upward on load
  - Selected language button (seed) splits into 3 difficulty buttons (FLIP animation)
  - Stores difficulty in localStorage, then navigates to NEXT_PAGE

  🔧 If you want a different next page, change NEXT_PAGE.
*/

const NEXT_PAGE = "game.html";     // <-- change if your game page has a different file name
const BACK_FALLBACK = "index.html"; // <-- change if your start page is not index.html

function getSelectedLanguageLabel(){
  // Try common keys (so this won't break even if you rename it)
  const candidates = [
    "selectedLanguage",
    "wow_selectedLanguage",
    "wow_language",
    "language",
    "lang",
  ];

  let raw = "";
  for (const k of candidates){
    const v = localStorage.getItem(k);
    if (v){ raw = v; break; }
  }

  // Normalize
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "LANGUAGE";

  const map = {
    ja: "JAPANESE",
    jp: "JAPANESE",
    japanese: "JAPANESE",
    ko: "KOREAN",
    kr: "KOREAN",
    korean: "KOREAN",
    en: "ENGLISH",
    english: "ENGLISH",
    fr: "FRENCH",
    french: "FRENCH",
    es: "SPANISH",
    spanish: "SPANISH",
  };

  return map[s] || s.toUpperCase();
}

function prefersReducedMotion(){
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function flipFromSeed(seedEl, targets){
  const seed = seedEl.getBoundingClientRect();

  // Record final rects
  const finals = targets.map(el => el.getBoundingClientRect());

  // Apply initial transform so each target starts on the seed
  targets.forEach((el, i) => {
    const f = finals[i];

    const seedCx = seed.left + seed.width / 2;
    const seedCy = seed.top + seed.height / 2;
    const fCx = f.left + f.width / 2;
    const fCy = f.top + f.height / 2;

    const dx = seedCx - fCx;
    const dy = seedCy - fCy;
    const sx = seed.width / f.width;
    const sy = seed.height / f.height;

    // Keep hover scale separate by putting the FLIP on a wrapper-like transform
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.style.opacity = "0";
    el.style.willChange = "transform, opacity";
    el.style.transition = "transform 700ms cubic-bezier(0.2, 0.9, 0.2, 1), opacity 420ms ease";
  });

  // Trigger animation to final state
  requestAnimationFrame(() => {
    targets.forEach((el, i) => {
      // stagger a tiny bit like your screenshots feel (subtle)
      const delay = i * 70;
      el.style.transitionDelay = `${delay}ms`;
      el.style.transform = "none";
      el.style.opacity = "1";
    });
  });

  // Cleanup after the last one
  const last = targets[targets.length - 1];
  const cleanup = () => {
    targets.forEach(el => {
      el.style.willChange = "";
      // keep transition for hover; remove FLIP transition after enter
      el.style.transition = "";
      el.style.transitionDelay = "";
    });
    last.removeEventListener("transitionend", cleanup);
  };
  last.addEventListener("transitionend", cleanup);
}

function main(){
  const backBtn = document.getElementById("backBtn");
  const seedBtn = document.getElementById("seedBtn");
  const seedLabel = document.getElementById("seedLabel");
  const diffWrap = document.getElementById("diffWrap");
  const diffBtns = Array.from(diffWrap.querySelectorAll(".diff-btn"));

  // Seed text = chosen language
  seedLabel.textContent = getSelectedLanguageLabel();

  // BACK
  backBtn.addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.href = BACK_FALLBACK;
  });

  // Click difficulty
  diffBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const difficulty = btn.dataset.difficulty;
      localStorage.setItem("wow_difficulty", difficulty);
      localStorage.setItem("difficulty", difficulty); // also store a generic key

      // Optional: keep it in URL too
      const url = new URL(NEXT_PAGE, location.href);
      url.searchParams.set("difficulty", difficulty);
      location.href = url.toString();
    });
  });

  // Animate in
  if (prefersReducedMotion()){
    document.body.classList.remove("pre-enter");
    document.body.classList.add("entered");
    // no FLIP
    seedBtn.style.opacity = "0";
    return;
  }

  // 1) layout first
  requestAnimationFrame(() => {
    // 2) do FLIP from seed -> difficulty buttons
    flipFromSeed(seedBtn, diffBtns);

    // 3) title morph + seed fade
    document.body.classList.remove("pre-enter");
    document.body.classList.add("entered");
  });
}

document.addEventListener("DOMContentLoaded", main);
