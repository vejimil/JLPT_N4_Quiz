/*
  Bingo gameplay (MVP + UI polish)
  - Desktop: example (left) / main board (center) / answers (right)
  - Mobile: stacked (example -> main -> answers -> timer)

  MOBILE GOAL:
  - NO SCROLL.
  - Keep layout centered.
  - Auto-shrink tile/gaps/answers so everything fits inside the viewport.

  Polish included:
  1) Correct pick: tile flashes (pixel-like)
  2) Wrong pick: answer shakes + flashes
  3) Text auto-fit: shrink font until it fits the box
*/

(() => {
  'use strict';
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

  // JLPT level (Japanese only). Mirror app.js: level -> vocab array.
  const JA_LEVEL_ORDER = ['n5n4', 'n3', 'n2', 'n1'];
  const JA_LEVEL_VOCABS = {
    n5n4: () => (typeof VOCAB !== 'undefined' ? VOCAB : (globalThis.VOCAB || [])),
    n3: () => (typeof VOCAB_N3 !== 'undefined' ? VOCAB_N3 : (globalThis.VOCAB_N3 || [])),
    n2: () => (typeof VOCAB_N2 !== 'undefined' ? VOCAB_N2 : (globalThis.VOCAB_N2 || [])),
    n1: () => (typeof VOCAB_N1 !== 'undefined' ? VOCAB_N1 : (globalThis.VOCAB_N1 || [])),
  };

  function normalizeJaLevel(level){
    const v = (level || '').toLowerCase();
    return JA_LEVEL_ORDER.includes(v) ? v : 'n5n4';
  }

  function normalizeCumulative(c){
    const v = String(c == null ? '' : c).toLowerCase();
    return v === '1' || v === 'true';
  }

  // Japanese vocab for a level; cumulative folds in all lower levels.
  // (ids are level-scoped ranges, so concatenation stays globally unique.)
  function getJaVocab(level, cumulative){
    const lv = normalizeJaLevel(level);
    if (!cumulative) return JA_LEVEL_VOCABS[lv]() || [];
    const idx = JA_LEVEL_ORDER.indexOf(lv);
    return JA_LEVEL_ORDER.slice(0, idx + 1).reduce(
      (acc, l) => acc.concat(JA_LEVEL_VOCABS[l]() || []),
      []
    );
  }

  const DIFF = {
    easy:   { size: 3, target: 4, choices: 6,  timeSec: 28 },
    normal: { size: 4, target: 5, choices: 10, timeSec: 28 },
    hard:   { size: 4, target: 6, choices: 10, timeSec: 22 },
  };

  const PATTERNS_3 = [
    [0, 1, 3, 4],
    [1, 2, 4, 5],
    [3, 4, 6, 7],
    [4, 5, 7, 8],
    [0, 2, 4, 6],
    [2, 4, 6, 8].slice(0, 4),
  ];

  const PATTERNS_4_5 = [
    [1, 4, 5, 6, 9],
    [2, 5, 6, 9, 10],
    [0, 1, 5, 6, 10],
    [3, 6, 7, 10, 11],
    [5, 6, 9, 10, 14],
    [1, 2, 6, 9, 13],
  ];

  const PATTERNS_4_6 = [
    [1, 4, 5, 6, 9, 13],
    [2, 5, 6, 9, 10, 14],
    [0, 1, 2, 5, 6, 10],
    [3, 6, 7, 10, 11, 14],
    [1, 5, 6, 9, 10, 14],
    [4, 5, 6, 9, 10, 11],
  ];

  function pickPattern(size, target){
    if (size === 3) return PATTERNS_3[Math.floor(Math.random() * PATTERNS_3.length)].slice(0, target);
    if (size === 4 && target === 5) return PATTERNS_4_5[Math.floor(Math.random() * PATTERNS_4_5.length)].slice();
    if (size === 4 && target === 6) return PATTERNS_4_6[Math.floor(Math.random() * PATTERNS_4_6.length)].slice();

    const total = size * size;
    const idxs = Array.from({length: total}, (_, i) => i);
    shuffle(idxs);
    return idxs.slice(0, target);
  }

  function getPairs(lang, level, cumulative){
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
    // Japanese: pool is the selected JLPT level (+ lower levels when cumulative).
    const SRC = getJaVocab(level, cumulative);
    const pool = (SRC || []).filter(v => v && v.jpKana && v.krMeaning);
    return pool.map(v => {
      const kanji = (v.jpKanji || '').trim();
      const kana = (v.jpKana || '').trim();
      const useKanji = kanji && kanji !== '-' && kanji !== '—' && kanji !== '(한자 없음)';
      return { id: v.id, q1: useKanji ? kanji : kana, q2: useKanji ? kana : '', a: String(v.krMeaning) };
    });
  }

  const elExample = $('#exampleBoard');
  const elBoard = $('#mainBoard');
  const elAnswers = $('#answers');
  const elTimerMask = $('#timerMask');
  const elHp = $('#hp');

  const elUI = $('.ui');
  const elTopbar = $('.topbar');
  const elTimerBar = $('.timer-bar');
  const elPlayLayout = $('.play-layout');
  const root = document.documentElement;

  const pauseBtn = $('#pauseBtn');
  const overlay = $('#overlay');
  const overlayTitleImg = $('#overlayTitleImg');
  const overlayTitleText = $('#overlayTitleText');
  const resumeBtn = $('#resumeBtn');
  const backBtn = $('#backBtn');
  const retryBtn = $('#retryBtn');

  // Overlay title assets by state (keep filenames as-is, including spaces/apostrophes).
  const OVERLAY_TITLES = {
    pause:   { src: 'assets/PAUSE.png', alt: 'PAUSE' },
    gameover:{ src: 'assets/GAME OVER.png', alt: 'GAME OVER' },
    timeup:  { src: 'assets/TIME’S UP.png', alt: "TIME'S UP" },
  };

  if (!elExample || !elBoard || !elAnswers || !elTimerMask || !elHp || !elUI || !elTopbar || !elTimerBar || !elPlayLayout) return;

  const lang = normalizeLang(qsParam('lang', 'ja'));
  const diff = normalizeDiff(qsParam('diff', 'normal'));
  const jaLevel = normalizeJaLevel(qsParam('level', 'n5n4'));
  const cumulative = normalizeCumulative(qsParam('cumulative', '0'));
  const cfg = DIFF[diff] || DIFF.normal;

  const gridSize = cfg.size;
  const totalTiles = gridSize * gridSize;

  let paused = false;
  let done = false;
  let hearts = 3;

  let startTs = 0;
  let rafId = 0;
  let remainingMs = 0;

  const tiles = [];
  let targetIdxs = [];
  let targetSet = new Set(); // O(1) membership checks; keep targetIdxs for stable order
  let remainingTargets = 0;

  /**
   * Build one round's immutable data from a vocabulary pool.
   *
   * Why: the round generation (random picks, target pattern selection) is pure game
   * logic and easier to test/review when it does not touch the DOM.
   *
   * IMPORTANT: Keep behavior identical:
   * - Randomness uses Math.random()
   * - targetIdxs order is preserved (affects answer ordering before shuffle)
   */
  function buildRound(pairs, total, size, targetCount){
    const chosen = pickUnique(pairs, total);
    const idxs = pickPattern(size, targetCount);
    const set = new Set(idxs);
    const roundTiles = Array.from({ length: total }, (_, i) => ({
      pair: chosen[i],
      isTarget: set.has(i),
      solved: false,
    }));
    return { chosen, targetIdxs: idxs, targetSet: set, tiles: roundTiles };
  }

  /**
   * Derive the answer button contents from current tiles.
   * Returns a shuffled list of items and an optional "single" item used for
   * the special mobile layout (10 = 3x3 + 1 centered).
   */
  function buildAnswerItems(tilesArr, idxs, set, choiceCount){
    const correct = idxs.map(idx => ({
      tileIdx: idx,
      text: tilesArr[idx]?.pair?.a || '',
      isTarget: true,
    }));

    const decoyPool = tilesArr
      .map((t, idx) => ({ tileIdx: idx, text: t?.pair?.a || '', isTarget: false }))
      .filter(x => !set.has(x.tileIdx));

    const usedText = new Set(correct.map(c => c.text));
    const decoys = [];
    shuffle(decoyPool);
    for (const d of decoyPool) {
      if (decoys.length >= Math.max(0, choiceCount - correct.length)) break;
      if (!d.text || usedText.has(d.text)) continue;
      usedText.add(d.text);
      decoys.push(d);
    }

    const all = shuffle(correct.concat(decoys));

    // Mobile readability preference: 10 answers should render as 3x3 + 1 centered.
    const wantsTenSpecial = (choiceCount === 10);
    let single = null;
    let list = all;
    if (wantsTenSpecial && all.length === 10) {
      list = all.slice(0, 9);
      single = all[9];
    }

    return { list, single };
  }

  // ----------------------------
  // Text auto-fit
  // ----------------------------
  function fitText(el, minPx){
    if (!el) return;
    el.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(el).fontSize);
    if (!fs || Number.isNaN(fs)) return;

    let guard = 0;
    while (guard < 28 && fs > minPx) {
      const tooTall = el.scrollHeight > el.clientHeight + 2;
      const tooWide = el.scrollWidth > el.clientWidth + 2;
      if (!tooTall && !tooWide) break;
      fs -= 1;
      el.style.fontSize = fs + 'px';
      guard += 1;
    }
  }

  function fitAllText(){
    $$('#mainBoard .txt').forEach(el => fitText(el, 10));
    $$('#answers .label').forEach(el => fitText(el, 11));
  }

  // ----------------------------
  // Mobile "fit without scroll"
  // ----------------------------
  function pxVar(name, fallback){
    const v = parseFloat(getComputedStyle(root).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  }

  function applyResponsiveSizing(){
    const isStacked = window.matchMedia('(orientation: portrait)').matches || window.innerWidth <= 900;

    if (!isStacked) {
      // Desktop: remove JS overrides
      root.style.removeProperty('--tile');
      root.style.removeProperty('--ex-tile');
      root.style.removeProperty('--gap');
      root.style.removeProperty('--grid-gap');
      root.style.removeProperty('--ex-gap');
      root.style.removeProperty('--ans-w');
      root.style.removeProperty('--ans-gap');
      root.style.setProperty('--ans-cols', '2');
      root.style.removeProperty('--title-h');
      root.style.removeProperty('--pause-w');
      root.style.removeProperty('--pause-h');
      root.style.removeProperty('--hp-h');

      elAnswers.dataset.cols = '2';
      elAnswers.dataset.count = String(cfg.choices);
      return;
    }

    const uiStyles = getComputedStyle(elUI);
    const rowGap = parseFloat(uiStyles.rowGap) || 0;

    // Available height for the middle row
    const availH = elUI.clientHeight - elTopbar.offsetHeight - elTimerBar.offsetHeight - rowGap * 2;

    // Width available for middle content
    const availW = elPlayLayout.clientWidth;

    if (!(availH > 0) || !(availW > 0)) return;

    const baseGap = pxVar('--gap', 12);
    const baseGridGap = pxVar('--grid-gap', 8);
    const baseExGap = pxVar('--ex-gap', 6);
    const baseAnsGap = pxVar('--ans-gap', 12);

    // Keep answer container inside screen (a bit smaller than layout width)
    const baseAnsW = Math.min(availW * 0.96, pxVar('--ans-w', Math.min(availW * 0.96, 440)));
    const baseTileFromCSS = pxVar('--tile', Math.min(availW / gridSize, 72));

    // Slightly shrink topbar on very short screens
    if (window.innerHeight < 740) {
      const scaleTop = clamp(window.innerHeight / 740, 0.84, 1);
      const curTitle = pxVar('--title-h', 62);
      const curPauseH = pxVar('--pause-h', 50);
      const curPauseW = pxVar('--pause-w', 160);
      const curHp = pxVar('--hp-h', 46);

      root.style.setProperty('--title-h', clamp(curTitle * scaleTop, 32, curTitle) + 'px');
      root.style.setProperty('--pause-h', clamp(curPauseH * scaleTop, 32, curPauseH) + 'px');
      root.style.setProperty('--pause-w', clamp(curPauseW * scaleTop, 110, curPauseW) + 'px');
      root.style.setProperty('--hp-h', clamp(curHp * scaleTop, 26, curHp) + 'px');
    }

    const choices = cfg.choices;
    const size = gridSize;

    // Use a slightly bigger aspect ratio to reduce height on mobile
    const aspect = 3.2;

    // Prefer FEWER columns on mobile (bigger buttons).
    // For 10 choices: default to 3x3 + 1 centered (user preference).
    const maxCols = Math.min(5, choices);
    let best = null;

    const preferredCols = (() => {
      // User preference: on small screens, 10 choices should be 3x3 + 1 (centered).
      // So we FORCE 3 columns first and only fall back if it truly cannot fit.
      if (choices === 10) return [3, 4];
      if (choices === 6)  return [3, 2, 4];
      return [3, 4, 2, 5];
    })();

    for (const cols of preferredCols) {
      for (let s = 1.00; s >= 0.55; s -= 0.02) {
        const gap = Math.max(10, baseGap * s);
        const gridGap = Math.max(4, baseGridGap * s);
        const exGap = Math.max(3, baseExGap * s);
        const ansGap = Math.max(10, baseAnsGap * s);

        // Tile width cap by available width
        const tileMaxW = (availW - (size - 1) * gridGap) / size;
        const tile = Math.max(36, Math.min(tileMaxW, baseTileFromCSS) * s);

        // Example tiles smaller
        const exTile = clamp(tile * 0.36, 12, tile * 0.52);

        const ansW = clamp(baseAnsW * s, 200, availW * 0.96);

        const mainH = size * tile + (size - 1) * gridGap;
        const exH = size * exTile + (size - 1) * exGap;

        const rows = Math.ceil(choices / cols);
        const btnW = (ansW - (cols - 1) * ansGap) / cols;
        if (!(btnW > 0)) continue;

        const btnH = btnW / aspect;
        const answersH = rows * btnH + (rows - 1) * ansGap;

        const total = exH + gap + mainH + gap + answersH;

        if (total <= (availH - 6)) {
          // Objective: make answer buttons readable.
          // 1) maximize button width, 2) maximize main tile (readability), 3) maximize spacing
          if (!best || btnW > best.btnW || (Math.abs(btnW - best.btnW) < 0.5 && tile > best.tile) || (Math.abs(btnW - best.btnW) < 0.5 && Math.abs(tile - best.tile) < 0.5 && ansGap > best.ansGap)) {
            best = { cols, tile, gridGap, exTile, exGap, ansW, ansGap, gap, btnW };
          }
          break;
        }
      }
      if (best) break;
    }

    // If nothing fits, use max columns + minimum scale
    if (!best) {
      const cols = (choices === 10) ? 3 : maxCols;
      const s = 0.66;

      const gap = Math.max(10, baseGap * s);
      const gridGap = Math.max(4, baseGridGap * s);
      const exGap = Math.max(3, baseExGap * s);
      const ansGap = Math.max(10, baseAnsGap * s);

      const tileMaxW = (availW - (size - 1) * gridGap) / size;
      const tile = Math.max(34, Math.min(tileMaxW, baseTileFromCSS) * s);
      const exTile = clamp(tile * 0.34, 12, tile * 0.5);
      const ansW = clamp(baseAnsW * s, 190, availW * 0.96);

      best = { cols, tile, gridGap, exTile, exGap, ansW, ansGap, gap, btnW: (ansW - (cols - 1) * ansGap) / cols };
    }

    root.style.setProperty('--ans-cols', String(best.cols));
    root.style.setProperty('--tile', best.tile.toFixed(2) + 'px');
    root.style.setProperty('--grid-gap', best.gridGap.toFixed(2) + 'px');
    root.style.setProperty('--ex-tile', best.exTile.toFixed(2) + 'px');
    root.style.setProperty('--ex-gap', best.exGap.toFixed(2) + 'px');
    root.style.setProperty('--ans-w', best.ansW.toFixed(2) + 'px');
    root.style.setProperty('--ans-gap', best.ansGap.toFixed(2) + 'px');
    root.style.setProperty('--gap', best.gap.toFixed(2) + 'px');

    // For CSS helpers (e.g., centering last answer in 3-col layout)
    elAnswers.dataset.cols = String(best.cols);
    elAnswers.dataset.count = String(choices);
    
  }

  function scheduleFitNow(){
    requestAnimationFrame(() => {
      applyResponsiveSizing();
      requestAnimationFrame(() => fitAllText());
    });
  }

  // Run quickly at breakpoint changes (prevents "momentary clipping")
  window.addEventListener('resize', scheduleFitNow, { passive: true });
  window.addEventListener('orientationchange', scheduleFitNow);

  // Also observe layout size changes (mobile browser UI showing/hiding)
  try {
    const ro = new ResizeObserver(() => scheduleFitNow());
    ro.observe(elUI);
    ro.observe(elPlayLayout);
  } catch(e) {}

  // ----------------------------
  // Rendering
  // ----------------------------
  function renderHearts(){
    const imgs = $$('.hp-heart', elHp);
    imgs.forEach((img, i) => {
      const alive = i < hearts;
      img.src = alive ? 'assets/HP_Red.png' : 'assets/HP_Black.png';
    });
  }

  function makeTileButton(i, pair){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile';
    btn.dataset.idx = String(i);

    const img = document.createElement('img');
    img.src = 'assets/Bingo_Panel_Blue.png';
    img.alt = '';

    const label = document.createElement('div');
    label.className = 'txt';

    if (pair && pair.q2) {
      label.textContent = pair.q1;
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = pair.q2;
      label.appendChild(sub);
    } else {
      label.textContent = pair ? pair.q1 : '';
    }

    btn.appendChild(img);
    btn.appendChild(label);
    return btn;
  }

  function flashTile(btn){
    if (!btn) return;
    btn.classList.remove('flash');
    void btn.offsetWidth;
    btn.classList.add('flash');
    window.setTimeout(() => btn.classList.remove('flash'), 260);
  }

  function setTileSolved(i){
    const btn = elBoard.querySelector(`.tile[data-idx="${i}"]`);
    if (!btn) return;
    const img = $('img', btn);
    if (img) img.src = 'assets/Bingo_Panel_Red.png';
    flashTile(btn);
  }

  function renderBoard(){
    elBoard.style.setProperty('--grid-size', String(gridSize));
    elBoard.innerHTML = '';
    for (let i = 0; i < totalTiles; i++) {
      elBoard.appendChild(makeTileButton(i, tiles[i].pair));
    }
  }

  function renderExample(){
    elExample.style.setProperty('--grid-size', String(gridSize));
    elExample.innerHTML = '';
    for (let i = 0; i < totalTiles; i++) {
      const isTarget = targetSet.has(i);
      const img = document.createElement('img');
      img.className = 'ex-tile';
      img.src = isTarget ? 'assets/Bingo_Panel_Red_Example.png' : 'assets/Bingo_Panel_Blue_Example.png';
      img.alt = '';
      elExample.appendChild(img);
    }
  }

  function renderAnswers(){
    elAnswers.innerHTML = '';
    elAnswers.dataset.count = String(cfg.choices);

    const { list, single } = buildAnswerItems(tiles, targetIdxs, targetSet, cfg.choices);

    list.forEach(item => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-btn ans-btn clickable';
      b.dataset.tileIdx = String(item.tileIdx);
      b.dataset.isTarget = item.isTarget ? '1' : '0';

      const img = document.createElement('img');
      img.className = 'bg-img';
      img.src = 'assets/Bingo_Button_Answer.png';
      img.alt = '';

      const t = document.createElement('div');
      t.className = 'label';
      t.textContent = item.text;

      b.appendChild(img);
      b.appendChild(t);
      elAnswers.appendChild(b);
    });

    if (single) {
      const item = single;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-btn ans-btn ans-single clickable';
      b.dataset.tileIdx = String(item.tileIdx);
      b.dataset.isTarget = item.isTarget ? '1' : '0';

      const img = document.createElement('img');
      img.className = 'bg-img';
      img.src = 'assets/Bingo_Button_Answer.png';
      img.alt = '';

      const t = document.createElement('div');
      t.className = 'label';
      t.textContent = item.text;

      b.appendChild(img);
      b.appendChild(t);
      elAnswers.appendChild(b);
    }
  }

  // ----------------------------
  // Overlay / timer
  // ----------------------------
  function setOverlayVisibility(el, on){
    if (!el) return;
    el.style.display = on ? '' : 'none';
  }

  function setOverlayState(state){
    // state: 'pause' | 'gameover' | 'timeup' | 'win'
    if (!overlay) return;
    overlay.dataset.state = state;

    // Title: image first; text fallback (e.g., win).
    // NOTE: Keep the same asset filenames (including spaces/apostrophes) to preserve behavior.
    if (overlayTitleImg) {
      const title = OVERLAY_TITLES[state];
      if (title && title.src) {
        overlayTitleImg.src = title.src;
        overlayTitleImg.alt = title.alt || '';
        overlayTitleImg.style.display = '';
        if (overlayTitleText) overlayTitleText.style.display = 'none';
      } else {
        overlayTitleImg.style.display = 'none';
        if (overlayTitleText) {
          overlayTitleText.textContent = (state === 'win') ? 'BINGO!' : '';
          overlayTitleText.style.display = '';
        }
      }
    }

    // Actions: match the product-wide overlay style (Acid Rain is the source of truth).
    // We only control which buttons are shown and their flex order.
    // Pause: RESUME + BACK
    // GameOver/TimeUp/Win: BACK + RETRY
    if (state === 'pause') {
      setOverlayVisibility(resumeBtn, true);
      setOverlayVisibility(backBtn, true);
      setOverlayVisibility(retryBtn, false);

      if (resumeBtn) resumeBtn.style.order = '0';
      if (backBtn) backBtn.style.order = '1';
    } else {
      setOverlayVisibility(resumeBtn, false);
      setOverlayVisibility(backBtn, true);
      setOverlayVisibility(retryBtn, true);

      if (backBtn) backBtn.style.order = '0';
      if (retryBtn) retryBtn.style.order = '1';
    }
  }

  function openOverlay(state){
    setOverlayState(state);
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closeOverlay(){
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function setTimerCovered(frac){
    const p = clamp(frac, 0, 1) * 100;
    elTimerMask.style.width = p.toFixed(2) + '%';
  }

  function startTimer(){
    remainingMs = cfg.timeSec * 1000;
    startTs = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function tick(now){
    if (done) return;

    if (!paused) {
      const dt = now - startTs;
      startTs = now;
      remainingMs = Math.max(0, remainingMs - dt);

      setTimerCovered(1 - (remainingMs / (cfg.timeSec * 1000)));

      if (remainingMs <= 0) {
        gameOver('timeup');
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  // ----------------------------
  // Game flow
  // ----------------------------
  function loseHeart(){
    hearts = clamp(hearts - 1, 0, 3);
    renderHearts();
    if (hearts <= 0) gameOver('gameover');
  }

  function gameOver(state){
    if (done) return;
    done = true;
    openOverlay(state);
  }

  function win(){
    if (done) return;
    done = true;
    openOverlay('win');
  }

  function reset(){
    paused = false;
    done = false;
    hearts = 3;
    renderHearts();
    closeOverlay();

    // -------- Round data (pure rules) --------
    let pairs = getPairs(lang, jaLevel, cumulative);

    // Ensure we always have enough pairs to fill the board + decoys.
    const minNeeded = totalTiles + cfg.choices;
    if (!pairs || pairs.length < minNeeded) {
      const base = (pairs || []).slice();
      const need = Math.max(0, minNeeded - base.length);
      for (let i = 0; i < need; i++) {
        base.push({ id: `dummy-${Date.now()}-${i}`, q1: `WORD ${i + 1}`, q2: '', a: `MEANING ${i + 1}` });
      }
      pairs = base;
    }

    const round = buildRound(pairs, totalTiles, gridSize, cfg.target);
    targetIdxs = round.targetIdxs;
    targetSet = round.targetSet;
    remainingTargets = cfg.target;

    tiles.length = 0;
    tiles.push(...round.tiles);

    renderExample();
    renderBoard();
    renderAnswers();

    setTimerCovered(0);

    // Fit immediately (no momentary clipping)
    scheduleFitNow();

    startTimer();
  }

  // ----------------------------
  // Input
  // ----------------------------
  function bind(){
    pauseBtn.addEventListener('click', () => {
      if (done) return;
      paused = !paused;
      if (paused) openOverlay('pause');
      else closeOverlay();
    });

    resumeBtn.addEventListener('click', () => {
      if (!overlay || overlay.dataset.state !== 'pause') return;
      paused = false;
      closeOverlay();
    });

    retryBtn.addEventListener('click', () => reset());

    backBtn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.pathname = url.pathname.replace(/bingo\.html$/i, 'game.html');
      url.searchParams.delete('diff');
      url.searchParams.delete('lang');
      url.searchParams.delete('level');
      url.searchParams.delete('cumulative');
      window.location.href = url.toString();
    });

    elAnswers.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.ans-btn') : null;
      if (!btn) return;
      if (paused || done || btn.disabled) return;

      const tileIdx = Number(btn.dataset.tileIdx);
      const isTarget = btn.dataset.isTarget === '1';
      if (!Number.isFinite(tileIdx) || tileIdx < 0 || tileIdx >= totalTiles) return;

      if (!isTarget) {
        btn.disabled = true;
        btn.classList.add('is-wrong');
        loseHeart();
        return;
      }

      const t = tiles[tileIdx];
      if (!t || !t.isTarget || t.solved) {
        btn.disabled = true;
        btn.classList.add('is-wrong');
        loseHeart();
        return;
      }

      t.solved = true;
      btn.disabled = true;
      btn.classList.add('is-correct');
      setTimeout(() => btn.classList.remove('is-correct'), 220);

      setTileSolved(tileIdx);

      remainingTargets -= 1;
      if (remainingTargets <= 0) win();
    });

    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  }

  function boot(){
    if ($$('.hp-heart', elHp).length === 0) {
      for (let i = 0; i < 3; i++) {
        const img = document.createElement('img');
        img.className = 'hp-heart';
        img.src = 'assets/HP_Red.png';
        img.alt = 'HP';
        elHp.appendChild(img);
      }
    }

    elExample.style.setProperty('--grid-size', String(gridSize));
    elBoard.style.setProperty('--grid-size', String(gridSize));

    bind();
    reset();

    // One extra fit after mobile browser UI settles
    setTimeout(() => scheduleFitNow(), 150);
  }

  window.addEventListener('load', boot);
})();
