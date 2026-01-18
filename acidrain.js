/*
  Acid Rain (Drag Choices into Falling Blocks)

  Core rules:
  - A falling block shows either the "word side" or the "meaning side".
  - The bottom choices are the *opposite* side (direction can flip per round).
  - Interaction: drag a choice into a falling block (the block is the target).
  - Missing an item (it reaches the bottom) costs 1 heart.
  - Wrong match does NOT cost a heart (feedback only).

  Updates requested (2026-01-18):
  1) Falling speed felt too fast.
     - We now tune falling by *time-to-bottom* (seconds), not fixed px/sec.
     - Result: on wide (landscape) vs tall (portrait) screens, the time until a block
       hits the bottom stays consistent.

  2) Round logic felt repetitive.
     - Round clear goal is 10 matches (example value).
     - Each round has 10 unique word-meaning pairs.
     - Only 5 choices are shown at a time.
     - When you match correctly, the choice slot you used is replaced by a new pair,
       so you can eventually clear all 10 without seeing the same item spammed.

  Code-health goals:
  - Keep round generation pure and easy to reason about.
  - Keep DOM rendering + RAF loop isolated from game rules.
  - Defensive defaults so short vocab lists never break the UI.
*/

(() => {
  'use strict';

  // -----------------------------
  // Small utilities (pure)
  // -----------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function clamp(n, min, max){
    return Math.max(min, Math.min(max, n));
  }

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

    // Choice button background (reusing existing style)
    choiceBg: 'assets/Bingo_Button_Answer.png',

    // Overlay title assets
    overlayTitlePause: 'assets/PAUSE.png',
    overlayTitleGameOver: 'assets/GAME OVER.png',
  });

  // -----------------------------
  // Difficulty tuning
  // -----------------------------
  // Key change: "fallTimeSec" (time until a block hits the bottom)
  // This keeps gameplay consistent across different aspect ratios.
  const DIFF = Object.freeze({
    easy:   { choices: 5, spawnEveryMs: 1500, fallTimeSec: 11, maxActive: 3, roundGoal: 10 },
    normal: { choices: 5, spawnEveryMs: 1300, fallTimeSec: 10, maxActive: 4, roundGoal: 10 },
    hard:   { choices: 5, spawnEveryMs: 1100, fallTimeSec: 9,  maxActive: 5, roundGoal: 10 },
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

    // Default: Japanese (kanji/kana -> Korean meaning)
    const SRC = (typeof VOCAB !== 'undefined') ? VOCAB : (globalThis.VOCAB || []);
    const pool = (SRC || []).filter(v => v && v.jpKana && v.krMeaning);

    return pool.map(v => {
      const kanji = (v.jpKanji || '').trim();
      const kana = (v.jpKana || '').trim();
      const useKanji = kanji && kanji !== '-' && kanji !== '—' && kanji !== '(한자 없음)';
      return {
        id: v.id,
        q1: useKanji ? kanji : kana,
        q2: useKanji ? kana : '',
        a: String(v.krMeaning),
      };
    });
  }

  // -----------------------------
  // Pure round generation
  // -----------------------------

  function toTextParts(pair, side){
    // side: 'word' | 'meaning'
    if (side === 'meaning') return { main: pair.a || '', sub: '' };
    return { main: pair.q1 || '', sub: pair.q2 || '' };
  }

  function ensurePoolSize(pairs, needed){
    const out = (pairs || []).slice();
    if (out.length >= needed) return out;

    // Defensive: Add dummy entries so the UI never breaks.
    // IDs are unique-ish for this session, and won't collide with numeric ids.
    const need = needed - out.length;
    const seed = Date.now();

    for (let i = 0; i < need; i++) {
      out.push({ id: `dummy-${seed}-${i}`, q1: `WORD ${i + 1}`, q2: '', a: `MEANING ${i + 1}` });
    }
    return out;
  }

  /**
   * Round spec (requested):
   * - pool: roundGoal unique pairs
   * - active: first `choiceCount` pairs shown as choices
   * - stash: the remaining pairs that will be swapped in after correct matches
   * - direction flips per round
   */
  function buildRound(allPairs, roundGoal, choiceCount){
    const safeGoal = Math.max(1, Math.floor(roundGoal || 10));
    const safeChoices = Math.max(1, Math.floor(choiceCount || 5));

    const pairs = ensurePoolSize(allPairs, safeGoal);
    const pool = pickUnique(pairs, safeGoal);

    const fallSide = (Math.random() < 0.5) ? 'word' : 'meaning';
    const choiceSide = (fallSide === 'word') ? 'meaning' : 'word';

    const active = pool.slice(0, Math.min(safeChoices, pool.length));
    const stash = pool.slice(active.length);

    const byId = new Map();
    for (const p of pool) byId.set(String(p.id), p);

    return {
      pool,
      byId,
      active,
      stash,
      fallSide,
      choiceSide,
      lastSpawnId: null,
    };
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
    // If HTML changes, fail safely instead of throwing.
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

  // Round state
  let round = null;
  let roundHits = 0;

  // Layout cache (recomputed on resize)
  let fieldRect = null;

  // Falling items
  let nextDropId = 1;
  const drops = new Map();
  // id -> { id, pair, el, x, y, w, h, vy }

  // Choice dragging state
  let activeDrag = null;
  // { pointerId, pairId, sourceBtn, ghostEl, offX, offY }

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

    // Title image (text fallback kept for future)
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
    // Important: if the player is dragging a choice when pause/game over opens,
    // we must clean it up, otherwise a ghost element can remain on screen.
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
    openOverlay('gameover');
  }

  // -----------------------------
  // Text fit (keeps long vocab readable)
  // -----------------------------

  function fitText(el, minPx){
    if (!el) return;

    // Reset to CSS default.
    el.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(el).fontSize) || 16;

    // Reduce until it fits (cap iterations for mobile performance).
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

    requestAnimationFrame(() => fitText(container, 11));
  }

  // -----------------------------
  // Layout (responsive choice columns + rect caches)
  // -----------------------------

  function computeChoiceCols(){
    const w = window.innerWidth;

    // Keep buttons tappable and prevent overflow.
    if (w < 520) return Math.min(cfg.choices, 3);
    if (w < 900) return Math.min(cfg.choices, 5);
    return cfg.choices; // desktop
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

      // Re-fit choice texts after relayout.
      $$('.choice-text', elChoices).forEach(t => fitText(t, 11));

      // If the field height changes, adjust existing drops' speed so the
      // "time-to-bottom" remains roughly consistent after the resize.
      const vy = computeFallSpeedPxSec();
      drops.forEach(d => { d.vy = vy; });
    });
  }

  // -----------------------------
  // Round rendering
  // -----------------------------

  function clearChoices(){
    elChoices.innerHTML = '';
  }

  function renderChoiceButton(pair){
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

    // Pointer-based dragging.
    btn.addEventListener('pointerdown', (e) => onChoicePointerDown(e, btn), { passive: false });

    return btn;
  }

  function renderChoices(){
    clearChoices();
    root.style.setProperty('--choice-cols', String(computeChoiceCols()));

    for (const pair of round.active) {
      elChoices.appendChild(renderChoiceButton(pair));
    }
  }

  function startNewRound(){
    roundHits = 0;

    const pairs = getPairs(lang);
    round = buildRound(pairs, cfg.roundGoal, cfg.choices);

    // Clear active drops to avoid unfair leftovers when direction flips.
    drops.forEach(d => d.el.remove());
    drops.clear();

    renderChoices();
    scheduleRecache();
  }

  // -----------------------------
  // Falling drops
  // -----------------------------

  function computeFallSpeedPxSec(){
    // Goal: "it should take fallTimeSec seconds to hit the bottom"
    if (!fieldRect || !fieldRect.height) return 80;
    const t = Math.max(1, cfg.fallTimeSec || 10);
    return fieldRect.height / t;
  }

  function makeDropEl(){
    const el = document.createElement('div');
    el.className = 'drop';
    el.innerHTML = `
      <img class="drop-bg" src="${ASSET.dropBg}" alt="" />
      <div class="drop-text" aria-hidden="true"></div>
    `;
    return el;
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

  function removeAllDropsForPair(pairId){
    const want = String(pairId);
    drops.forEach(d => {
      if (String(d.pair.id) === want) removeDrop(d);
    });
  }

  function getEnabledChoiceButtons(){
    return $$('.choice-btn', elChoices).filter(btn => !btn.disabled);
  }

  function pickSpawnPairId(){
    if (!round || !fieldRect) return null;

    const activeDropPairIds = new Set(Array.from(drops.values()).map(d => String(d.pair.id)));
    const candidates = getEnabledChoiceButtons()
      .map(b => String(b.dataset.pairId || ''))
      .filter(id => id && !activeDropPairIds.has(id));

    if (!candidates.length) return null;

    // Anti-repeat: avoid spawning the same pair twice in a row when possible.
    if (candidates.length >= 2 && round.lastSpawnId && candidates.includes(round.lastSpawnId)) {
      const filtered = candidates.filter(id => id !== round.lastSpawnId);
      if (filtered.length) {
        const id = filtered[Math.floor(Math.random() * filtered.length)];
        round.lastSpawnId = id;
        return id;
      }
    }

    const id = candidates[Math.floor(Math.random() * candidates.length)];
    round.lastSpawnId = id;
    return id;
  }

  function spawnDrop(){
    if (paused || done) return;
    if (!round || !fieldRect) return;
    if (drops.size >= cfg.maxActive) return;

    const pairId = pickSpawnPairId();
    if (!pairId) return;

    const pair = round.byId.get(String(pairId));
    if (!pair) return;

    const el = makeDropEl();
    const textEl = el.querySelector('.drop-text');
    renderTextBlock(textEl, toTextParts(pair, round.fallSide));

    elField.appendChild(el);

    // Measure after insertion.
    const w = el.offsetWidth || 180;
    const h = el.offsetHeight || 60;

    const margin = 6;
    const maxX = Math.max(margin, (fieldRect.width - w - margin));
    const x = clamp(margin + Math.random() * (fieldRect.width - w - margin * 2), margin, maxX);

    // Spawn just above the visible field.
    // Using -h ensures the travel distance until the bottom edge hits is ~fieldRect.height,
    // which makes time-to-bottom consistent across block sizes.
    const y = -h;

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
      vy: computeFallSpeedPxSec(),
    };

    drops.set(id, drop);
    applyDropTransform(drop);
  }

  // -----------------------------
  // Choice dragging (choice -> drop)
  // -----------------------------

  function createChoiceGhost(btn, startX, startY){
    const rect = btn.getBoundingClientRect();
    const ghost = btn.cloneNode(true);

    // Inline styles so we don't depend on extra CSS.
    ghost.style.position = 'fixed';
    ghost.style.left = '0px';
    ghost.style.top = '0px';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.margin = '0';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    ghost.style.opacity = '0.95';
    ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;

    document.body.appendChild(ghost);

    // Offset keeps the pointer attached at the grab point.
    const offX = startX - rect.left;
    const offY = startY - rect.top;

    return { ghost, offX, offY };
  }

  function cancelActiveDrag(){
    if (!activeDrag) return;

    try {
      activeDrag.sourceBtn.style.opacity = '';
      activeDrag.sourceBtn.style.filter = '';
    } catch (_) {}

    if (activeDrag.ghostEl) activeDrag.ghostEl.remove();
    activeDrag = null;
  }

  function onChoicePointerDown(e, btn){
    if (paused || done) return;
    if (activeDrag) return; // one drag at a time

    const pairId = String(btn.dataset.pairId || '');
    if (!pairId) return;

    // Visual feedback on the source while dragging.
    btn.style.opacity = '0.55';
    btn.style.filter = 'brightness(1.1)';

    const { ghost, offX, offY } = createChoiceGhost(btn, e.clientX, e.clientY);

    activeDrag = {
      pointerId: e.pointerId,
      pairId,
      sourceBtn: btn,
      ghostEl: ghost,
      offX,
      offY,
    };

    // Ensure we keep getting events even if the pointer leaves the button.
    btn.setPointerCapture(e.pointerId);

    // Prevent browser gestures during drag (especially on mobile).
    e.preventDefault();
  }

  function moveActiveDrag(e){
    if (!activeDrag) return;
    if (activeDrag.pointerId !== e.pointerId) return;

    const x = e.clientX - activeDrag.offX;
    const y = e.clientY - activeDrag.offY;
    activeDrag.ghostEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    // Prevent scroll on touch.
    e.preventDefault();
  }

  function flashChoice(btn){
    if (!btn) return;
    btn.classList.remove('flash');
    // Force reflow to restart animation deterministically.
    void btn.offsetWidth;
    btn.classList.add('flash');
  }

  function findClosestDropForPoint(clientX, clientY){
    // Compare distance to the center of each drop in viewport coords.
    let best = null;
    let bestDist = Infinity;

    drops.forEach(drop => {
      const rect = drop.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy);

      // Threshold: either overlap or within a generous radius.
      const overlaps =
        clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom;

      const radius = Math.max(rect.width, rect.height) * 0.6;

      if (overlaps || dist <= radius) {
        if (dist < bestDist) {
          bestDist = dist;
          best = drop;
        }
      }
    });

    return best;
  }

  function advanceChoiceSlot(sourceBtn){
    // Replace the matched slot with a new pair from the stash.
    const next = round.stash.shift();

    if (!next) {
      // No more new pairs: hide this slot.
      sourceBtn.disabled = true;
      sourceBtn.style.visibility = 'hidden';
      return;
    }

    sourceBtn.dataset.pairId = String(next.id);
    const textEl = sourceBtn.querySelector('.choice-text');
    if (textEl) renderTextBlock(textEl, toTextParts(next, round.choiceSide));

    // The available spawn pool changed, so don't force an immediate repeat.
    round.lastSpawnId = null;

    // Re-fit after the new text paints.
    requestAnimationFrame(() => {
      if (textEl) fitText(textEl, 11);
    });
  }

  function endActiveDrag(e){
    if (!activeDrag) return;
    if (activeDrag.pointerId !== e.pointerId) return;

    const drag = activeDrag;
    activeDrag = null;

    // Restore source visuals.
    drag.sourceBtn.style.opacity = '';
    drag.sourceBtn.style.filter = '';

    // Determine target (closest drop near the pointer release).
    const target = findClosestDropForPoint(e.clientX, e.clientY);

    if (target) {
      flashChoice(drag.sourceBtn);

      const isCorrect = (String(target.pair.id) === String(drag.pairId));

      if (isCorrect) {
        // Correct: remove target drop(s), progress the round, and refresh this choice slot.
        removeAllDropsForPair(drag.pairId);
        roundHits += 1;

        advanceChoiceSlot(drag.sourceBtn);

        if (roundHits >= cfg.roundGoal) {
          startNewRound();
        }
      } else {
        // Wrong: feedback only.
        target.el.classList.remove('wrong');
        void target.el.offsetWidth;
        target.el.classList.add('wrong');
      }
    }

    if (drag.ghostEl) drag.ghostEl.remove();

    // Prevent click-after-drag on some browsers.
    e.preventDefault();
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

    // Drag move/up are global: pointer may leave the button while dragging.
    window.addEventListener('pointermove', (e) => moveActiveDrag(e), { passive: false });
    window.addEventListener('pointerup', (e) => endActiveDrag(e), { passive: false });
    window.addEventListener('pointercancel', () => cancelActiveDrag(), { passive: true });

    // Auto-pause when the tab is hidden (prevents unfair heart loss offscreen).
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
    paused = false;
    done = false;
    hearts = 3;
    renderHearts();
    closeOverlay();

    cancelActiveDrag();

    // Reset timing so resume is stable.
    lastTs = 0;
    spawnAccMs = 0;

    startNewRound();
  }

  function boot(){
    renderHearts();
    bind();
    reset();

    // Initial rect cache after layout settles.
    setTimeout(() => scheduleRecache(), 120);

    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  window.addEventListener('load', boot);
})();
