/*
  Acid Rain (Drag Choices into Falling Blocks)

  Core rules (per your spec):
  - A falling block shows either the "word side" or the "meaning side"
  - The bottom choices are the *opposite* side (direction can flip per round)
  - Interaction: you drag a choice into the falling block (the block is the target)
  - Missing an item (it reaches the bottom) costs 1 heart
  - Wrong match does NOT cost a heart (only gives feedback), to keep the game fair on touch devices
  - Pause / Game Over overlays reuse the same asset philosophy as Bingo

  Code-health goals:
  - Round generation is pure (easy to test/review)
  - DOM/animation is isolated to rendering + a single RAF loop
  - Defensive defaults for short vocab lists
*/

(() => {
  'use strict';

  // -----------------------------
  // Small utilities (pure)
  // -----------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  function shuffle(arr){
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickUnique(pool, n){
    const copy = pool.slice();
    shuffle(copy);
    return copy.slice(0, n);
  }

  function qsParam(name, fallback = ''){
    const u = new URL(window.location.href);
    return u.searchParams.get(name) || fallback;
  }

  function normalizeLang(lang){
    const v = (lang || '').toLowerCase();
    if (v === 'ja' || v === 'jp' || v === 'japanese') return 'ja';
    if (v === 'fr' || v === 'french') return 'fr';
    if (v === 'es' || v === 'spanish') return 'es';
    return 'ja';
  }

  function normalizeDiff(diff){
    const v = (diff || '').toLowerCase();
    if (v === 'easy') return 'easy';
    if (v === 'hard') return 'hard';
    return 'normal';
  }

  // -----------------------------
  // Assets (keep paths consistent with the rest of your project)
  // -----------------------------

  const ASSET = Object.freeze({
    dropBg: 'assets/Button_Question.png',
    title: 'assets/ACID RAIN.png',

    pauseBtnBg: 'assets/Button_Pause.png',
    pauseLabel: 'assets/PAUSE.png',

    hpRed: 'assets/HP_Red.png',
    hpBlack: 'assets/HP_Black.png',

    // Choice button background (reusing existing style).
    // If your project uses a different asset for “choice blocks”, change it here only.
    choiceBg: 'assets/Bingo_Button_Answer.png',

    // Overlay title assets (same naming rules as Bingo)
    overlayTitlePause: 'assets/PAUSE.png',
    overlayTitleGameOver: 'assets/GAME OVER.png',
  });

  // -----------------------------
  // Difficulty tuning
  // -----------------------------
  // Why these knobs:
  // - spawnEveryMs + fallSpeedPxSec control “pressure”
  // - maxActive prevents unfair clutter (especially on mobile)
  // - choices controls cognitive load
  const DIFF = Object.freeze({
    easy:   { choices: 5,  spawnEveryMs: 1350, fallSpeedPxSec: 240, maxActive: 3, roundGoal: 10 },
    normal: { choices: 5, spawnEveryMs: 1100, fallSpeedPxSec: 300, maxActive: 4, roundGoal: 14 },
    hard:   { choices: 5, spawnEveryMs: 900,  fallSpeedPxSec: 380, maxActive: 5, roundGoal: 16 },
  });

  // -----------------------------
  // Vocabulary adapter (matches Bingo’s data model)
  // -----------------------------
  function getPairs(lang){
    if (lang === 'fr') {
      const SRC = (typeof VOCAB_FR !== 'undefined') ? VOCAB_FR : (globalThis.VOCAB_FR || []);
      const pool = (SRC || []).filter(v => v && v.fr && v.en);
      return pool.map(v => ({ id: v.id, q1: String(v.fr), q2: '', a: String(v.en) }));
    }
    if (lang === 'es') {
      const SRC = (typeof VOCAB_ES !== 'undefined') ? VOCAB_ES : (globalThis.VOCAB_ES || []);
      const pool = (SRC || []).filter(v => v && v.es && v.en);
      return pool.map(v => ({ id: v.id, q1: String(v.es), q2: '', a: String(v.en) }));
    }
    const SRC = (typeof VOCAB !== 'undefined') ? VOCAB : (globalThis.VOCAB || []);
    const pool = (SRC || []).filter(v => v && v.jpKana && v.krMeaning);
    return pool.map(v => {
      const kanji = (v.jpKanji || '').trim();
      const kana = (v.jpKana || '').trim();
      const useKanji = kanji && kanji !== '-' && kanji !== '—' && kanji !== '(한자 없음)';
      return { id: v.id, q1: useKanji ? kanji : kana, q2: useKanji ? kana : '', a: String(v.krMeaning) };
    });
  }

  // -----------------------------
  // Pure round generation
  // -----------------------------

  /**
   * Round = a fixed set of N pairs + a direction (word->meaning OR meaning->word).
   *
   * Why: Keeping the “what should appear” logic pure makes it easy to maintain
   * when you later add a meta “game manager” that rotates mini-games.
   */
  function buildRound(allPairs, choiceCount){
    const minNeeded = Math.max(12, choiceCount); // small guard to avoid too small pools
    let pairs = (allPairs || []).slice();

    // Defensive: If vocab is too short, add dummy entries so the UI never breaks.
    if (pairs.length < minNeeded) {
      const need = minNeeded - pairs.length;
      for (let i = 0; i < need; i++) {
        pairs.push({ id: `dummy-${Date.now()}-${i}`, q1: `WORD ${i + 1}`, q2: '', a: `MEANING ${i + 1}` });
      }
    }

    const chosen = pickUnique(pairs, choiceCount);

    // Direction flips per round (your design decision).
    const fallSide = (Math.random() < 0.5) ? 'word' : 'meaning';
    const choiceSide = (fallSide === 'word') ? 'meaning' : 'word';

    return { chosen, fallSide, choiceSide };
  }

  function toTextParts(pair, side){
    // side: 'word' | 'meaning'
    if (side === 'meaning') return { main: pair.a || '', sub: '' };
    return { main: pair.q1 || '', sub: pair.q2 || '' };
  }

  // -----------------------------
  // DOM references (guarded)
  // -----------------------------

  const elField = $('#field');
  const elChoices = $('#choices');
  const elHp = $('#hp');

  const pauseBtn = $('#pauseBtn');
  const overlay = $('#overlay');
  const overlayTitleImg = $('#overlayTitleImg');
  const overlayTitleText = $('#overlayTitleText');
  const resumeBtn = $('#resumeBtn');
  const backBtn = $('#backBtn');
  const retryBtn = $('#retryBtn');

  if (!elField || !elChoices || !elHp || !pauseBtn || !overlay || !overlayTitleImg || !resumeBtn || !backBtn || !retryBtn) {
    // If HTML changes, we fail safely instead of throwing in production.
    return;
  }

  // -----------------------------
  // State
  // -----------------------------

  const lang = normalizeLang(qsParam('lang', 'ja'));
  const diff = normalizeDiff(qsParam('diff', 'normal'));
  const cfg = DIFF[diff] || DIFF.normal;

  const root = document.documentElement;

  let paused = false;
  let done = false;
  let hearts = 3;

  // “Round” state
  let round = null;           // { chosen, fallSide, choiceSide }
  let roundHits = 0;

  // Layout cache (recomputed on resize)
  let fieldRect = null;

  // Falling items
  let nextDropId = 1;
  const drops = new Map();    // id -> { id, pair, el, x, y, w, h, vy }

  // RAF loop
  let raf = 0;
  let lastTs = 0;
  let spawnAccMs = 0;

  // -----------------------------
  // UI helpers
  // -----------------------------

  function renderHearts(){
    elHp.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const img = document.createElement('img');
      img.className = 'hp-heart';
      img.src = (i < hearts) ? ASSET.hpRed : ASSET.hpBlack;
      img.alt = 'HP';
      elHp.appendChild(img);
    }
  }

  function setOverlayVisibility(el, on){
    if (!el) return;
    el.style.display = on ? '' : 'none';
  }

  function setOverlayState(state){
    // state: 'pause' | 'gameover'
    overlay.dataset.state = state;

    // Title image (text fallback kept for future states)
    overlayTitleText.style.display = 'none';
    overlayTitleImg.style.display = '';

    if (state === 'pause') {
      overlayTitleImg.src = ASSET.overlayTitlePause;
      overlayTitleImg.alt = 'PAUSE';

      setOverlayVisibility(resumeBtn, true);
      setOverlayVisibility(backBtn, true);
      setOverlayVisibility(retryBtn, false);
    } else {
      overlayTitleImg.src = ASSET.overlayTitleGameOver;
      overlayTitleImg.alt = 'GAME OVER';

      setOverlayVisibility(resumeBtn, false);
      setOverlayVisibility(backBtn, true);
      setOverlayVisibility(retryBtn, true);
    }
  }

  function openOverlay(state){
    cancelActiveDrag();
    setOverlayState(state);
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closeOverlay(){
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function loseHeart(){
    hearts = clamp(hearts - 1, 0, 3);
    renderHearts();
    if (hearts <= 0) gameOver();
  }

  function gameOver(){
    if (done) return;
    done = true;
    cancelActiveDrag();
    openOverlay('gameover');
  }

  // -----------------------------
  // Text fit (keeps long vocab readable)
  // -----------------------------

  function fitText(el, minPx){
    if (!el) return;
    el.style.fontSize = ''; // start from CSS default
    let fs = parseFloat(getComputedStyle(el).fontSize) || 16;

    // Reduce font size until it fits. Hard cap iterations to stay fast on mobile.
    for (let i = 0; i < 14; i++) {
      if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) break;
      fs = Math.max(minPx, fs - 1);
      el.style.fontSize = fs + 'px';
      if (fs <= minPx) break;
    }
  }

  function renderTextBlock(container, parts){
    container.innerHTML = '';

    const main = document.createElement('div');
    main.className = 'main';
    main.textContent = parts.main || '';
    container.appendChild(main);

    if (parts.sub) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = parts.sub;
      container.appendChild(sub);
    }

    // Fit after DOM paints sizes.
    requestAnimationFrame(() => fitText(container, 11));
  }

  // -----------------------------
  // Layout (responsive choice columns + rect caches)
  // -----------------------------

  function computeChoiceCols(){
    const w = window.innerWidth;

    // Why: fixed “one perfect layout” breaks on small widths.
    // We choose columns to keep buttons tappable and prevent overflow.
    if (w < 520) return Math.min(cfg.choices, 3);
    if (w < 900) return Math.min(cfg.choices, 5);
    return cfg.choices; // desktop: single row when possible
  }

  function recacheRects(){
    fieldRect = elField.getBoundingClientRect();
  }

  let resizeRaf = 0;
  function scheduleRecache(){
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      root.style.setProperty('--choice-cols', String(computeChoiceCols()));
      recacheRects();

      // Re-fit all texts after relayout
      $$('.choice-text', elChoices).forEach(t => fitText(t, 11));
      drops.forEach(d => {
        const t = d.el.querySelector('.drop-text');
        if (t) fitText(t, 11);
      });
    });
  }

  // -----------------------------
  // Round rendering
  // -----------------------------

  function renderChoices(){
    elChoices.innerHTML = '';

    // Update CSS choice columns before we insert (reduces reflow surprises)
    root.style.setProperty('--choice-cols', String(computeChoiceCols()));

    for (const pair of round.chosen) {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.type = 'button';
      btn.dataset.pairId = String(pair.id);

      btn.innerHTML = `
        <img class="choice-bg" src="${ASSET.choiceBg}" alt="" />
        <div class="choice-text" aria-hidden="true"></div>
      `;

      const textEl = btn.querySelector('.choice-text');
      renderTextBlock(textEl, toTextParts(pair, round.choiceSide));

      elChoices.appendChild(btn);

      // New interaction: drag *choices* into the falling block.
      btn.addEventListener('pointerdown', onChoicePointerDown, { passive: false });
    }

    // Rect cache must happen after DOM insertion.
    requestAnimationFrame(recacheRects);
  }

  function startNewRound(){
    cancelActiveDrag();
    roundHits = 0;

    const pairs = getPairs(lang);
    round = buildRound(pairs, cfg.choices);

    // Clear active drops to avoid “unfair leftovers” when direction flips.
    drops.forEach(d => d.el.remove());
    drops.clear();

    renderChoices();
    scheduleRecache();
  }

  // -----------------------------
  // Falling drops
  // -----------------------------

  function makeDropEl(){
    const el = document.createElement('div');
    el.className = 'drop';
    el.innerHTML = `
      <img class="drop-bg" src="${ASSET.dropBg}" alt="" />
      <div class="drop-text" aria-hidden="true"></div>
    `;
    return el;
  }

  function spawnDrop(){
    if (paused || done) return;
    if (!round || !fieldRect) return;
    if (drops.size >= cfg.maxActive) return;

    const pair = round.chosen[Math.floor(Math.random() * round.chosen.length)];
    const el = makeDropEl();
    const textEl = el.querySelector('.drop-text');
    renderTextBlock(textEl, toTextParts(pair, round.fallSide));

    elField.appendChild(el);

    // Measure after insertion (needed for correct bounds).
    const w = el.offsetWidth || 180;
    const h = el.offsetHeight || 60;

    const margin = 6;
    const maxX = Math.max(margin, (fieldRect.width - w - margin));
    const x = clamp(margin + Math.random() * (fieldRect.width - w - margin * 2), margin, maxX);
    const y = -h - (Math.random() * 40);

    const id = String(nextDropId++);
    el.dataset.dropId = id;

    const drop = {
      id,
      pair,
      el,
      x,
      y,
      w,
      h,
      vy: cfg.fallSpeedPxSec,
    };

    drops.set(id, drop);
    applyDropTransform(drop);
  }

  function applyDropTransform(drop){
    // Used also by shake animation: store tx/ty as CSS variables for keyframes.
    drop.el.style.setProperty('--tx', drop.x + 'px');
    drop.el.style.setProperty('--ty', drop.y + 'px');
    drop.el.style.transform = `translate3d(${drop.x}px, ${drop.y}px, 0)`;
  }

  function removeDrop(drop){
    drops.delete(drop.id);
    drop.el.remove();
  }

  // -----------------------------
  // Choice -> drop detection (generous snapping)
  // -----------------------------

  function findClosestDropForPoint(clientX, clientY){
    if (!fieldRect) return null;

    let best = null;
    let bestDist = Infinity;

    drops.forEach(drop => {
      // Drop rect in viewport coordinates.
      const l = fieldRect.left + drop.x;
      const t = fieldRect.top + drop.y;
      const r = l + drop.w;
      const b = t + drop.h;

      const cx = (l + r) / 2;
      const cy = (t + b) / 2;

      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy);

      // Accept either a direct overlap or a radius hit (touch-friendly).
      const overlaps = clientX >= l && clientX <= r && clientY >= t && clientY <= b;
      const radius = Math.max(drop.w, drop.h) * 0.65;

      if (overlaps || dist <= radius) {
        if (dist < bestDist) {
          bestDist = dist;
          best = drop;
        }
      }
    });

    return best;
  }

  function flashChoice(btn){
    if (!btn) return;
    btn.classList.remove('flash');
    // Force reflow to restart animation deterministically
    void btn.offsetWidth;
    btn.classList.add('flash');
  }

  // -----------------------------
  // Drag interactions (Choice -> Drop)
  // -----------------------------

  // Single active drag at a time (keeps mobile behavior predictable).
  let activeDrag = null;

  function cancelActiveDrag(){
    if (!activeDrag) return;

    try {
      activeDrag.sourceBtn.classList.remove('is-drag-source');
    } catch {}

    if (activeDrag.ghost && activeDrag.ghost.parentNode) {
      activeDrag.ghost.parentNode.removeChild(activeDrag.ghost);
    }

    activeDrag = null;
  }

  function createChoiceGhost(sourceBtn){
    const rect = sourceBtn.getBoundingClientRect();
    const ghost = sourceBtn.cloneNode(true);

    ghost.classList.add('choice-ghost');
    ghost.classList.remove('flash');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;

    // Lock the ghost size so it doesn't reflow when moved around the page.
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';

    document.body.appendChild(ghost);

    // Position at the source button initially.
    ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;

    return { ghost, rect };
  }

  function onChoicePointerDown(e){
    if (paused || done) return;
    if (!round) return;
    if (activeDrag) return;

    const sourceBtn = e.currentTarget;
    const pairId = sourceBtn?.dataset?.pairId || '';
    if (!pairId) return;

    const { ghost, rect } = createChoiceGhost(sourceBtn);

    // Offset: keep the finger attached at the grab point.
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;

    activeDrag = {
      pointerId: e.pointerId,
      pairId,
      sourceBtn,
      ghost,
      offX,
      offY,
      x: rect.left,
      y: rect.top,
    };

    sourceBtn.classList.add('is-drag-source');
    sourceBtn.setPointerCapture(e.pointerId);

    // Prevent browser gestures (especially iOS) while dragging upward.
    e.preventDefault();
  }

  function moveActiveDrag(e){
    if (!activeDrag) return;
    if (activeDrag.pointerId !== e.pointerId) return;

    const x = e.clientX - activeDrag.offX;
    const y = e.clientY - activeDrag.offY;

    activeDrag.x = x;
    activeDrag.y = y;
    activeDrag.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    // Prevent accidental scrolling on touch browsers.
    e.preventDefault();
  }

  function endActiveDrag(e){
    if (!activeDrag) return;
    if (activeDrag.pointerId !== e.pointerId) return;

    // Keep a local ref because we null out activeDrag during cleanup.
    const drag = activeDrag;
    activeDrag = null;

    // Evaluate: did we drop close enough to a falling block?
    recacheRects();
    const targetDrop = findClosestDropForPoint(e.clientX, e.clientY);

    if (targetDrop) {
      const isCorrect = (String(drag.pairId) === String(targetDrop.pair.id));

      // Feedback: the source button flashes so the player knows *which* option they used.
      flashChoice(drag.sourceBtn);

      if (isCorrect) {
        removeDrop(targetDrop);
        roundHits += 1;

        if (roundHits >= cfg.roundGoal) {
          startNewRound();
        }
      } else {
        targetDrop.el.classList.remove('wrong');
        void targetDrop.el.offsetWidth;
        targetDrop.el.classList.add('wrong');
      }
    }

    // Cleanup ghost + source styling.
    drag.sourceBtn.classList.remove('is-drag-source');
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);

    // Prevent a stray click after drag release on some browsers.
    e.preventDefault();
  }

  function onGlobalPointerMove(e){
    moveActiveDrag(e);
  }

  function onGlobalPointerUp(e){
    endActiveDrag(e);
  }

  // -----------------------------
  // Main loop (RAF)
  // -----------------------------

  function tick(ts){
    raf = requestAnimationFrame(tick);

    if (!lastTs) lastTs = ts;
    const dtMs = ts - lastTs;
    lastTs = ts;

    if (paused || done) return;

    if (!fieldRect) recacheRects();

    // Spawn pacing: dt-based accumulator makes pause/resume consistent.
    spawnAccMs += dtMs;
    while (spawnAccMs >= cfg.spawnEveryMs) {
      spawnAccMs -= cfg.spawnEveryMs;
      spawnDrop();
    }

    // Update falling motion.
    const dt = dtMs / 1000;

    drops.forEach(drop => {
      drop.y += drop.vy * dt;

      // Bottom = field height (choices are outside the field).
      const bottomY = fieldRect.height - drop.h;

      if (drop.y >= bottomY) {
        removeDrop(drop);
        loseHeart();
        return;
      }

      applyDropTransform(drop);
    });
  }

  // -----------------------------
  // Controls
  // -----------------------------

  function bind(){
    pauseBtn.addEventListener('click', () => {
      if (done) return;
      paused = !paused;
      if (paused) openOverlay('pause');
      else closeOverlay();
    });

    resumeBtn.addEventListener('click', () => {
      if (overlay.dataset.state !== 'pause') return;
      paused = false;
      closeOverlay();
    });

    retryBtn.addEventListener('click', () => reset());

    backBtn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.pathname = url.pathname.replace(/acidrain\.html$/i, 'game.html');
      url.searchParams.delete('diff');
      url.searchParams.delete('lang');
      window.location.href = url.toString();
    });

    // Drag move/up are global to handle cases where the pointer leaves the element.
    window.addEventListener('pointermove', onGlobalPointerMove, { passive: false });
    window.addEventListener('pointerup', onGlobalPointerUp, { passive: false });
    window.addEventListener('pointercancel', onGlobalPointerUp, { passive: false });

    // Auto-pause when the tab is hidden (prevents “unfair” heart loss offscreen).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !done) {
        paused = true;
        openOverlay('pause');
      }
    });

    window.addEventListener('resize', scheduleRecache);
    window.addEventListener('orientationchange', scheduleRecache);

    // Prevent desktop dblclick zoom / selection quirks
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  }

  function reset(){
    cancelActiveDrag();
    paused = false;
    done = false;
    hearts = 3;
    renderHearts();
    closeOverlay();

    // Reset timing so resume is stable.
    lastTs = 0;
    spawnAccMs = 0;

    startNewRound();
  }

  function boot(){
    renderHearts();
    bind();
    reset();

    // Initial rect cache after layout settles
    setTimeout(() => scheduleRecache(), 120);

    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  window.addEventListener('load', boot);
})();
