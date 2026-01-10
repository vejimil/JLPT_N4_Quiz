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
  const overlayTitle = $('#overlayTitle');
  const resumeBtn = $('#resumeBtn');
  const backBtn = $('#backBtn');
  const retryBtn = $('#retryBtn');

  if (!elExample || !elBoard || !elAnswers || !elTimerMask || !elHp || !elUI || !elTopbar || !elTimerBar || !elPlayLayout) return;

  const lang = normalizeLang(qsParam('lang', 'ja'));
  const diff = normalizeDiff(qsParam('diff', 'normal'));
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
  let remainingTargets = 0;

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
    const baseAnsW = Math.min(availW * 0.92, pxVar('--ans-w', Math.min(availW * 0.92, 380)));
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
    const aspect = 3.0;

    // Prefer MORE columns on mobile so buttons are not huge and not stuck together.
    const maxCols = Math.min(5, choices);
    let best = null;

    for (let cols = maxCols; cols >= 2; cols--) {
      for (let s = 1.00; s >= 0.66; s -= 0.02) {
        const gap = Math.max(8, baseGap * s);
        const gridGap = Math.max(4, baseGridGap * s);
        const exGap = Math.max(3, baseExGap * s);
        const ansGap = Math.max(8, baseAnsGap * s);

        // Tile width cap by available width
        const tileMaxW = (availW - (size - 1) * gridGap) / size;
        const tile = Math.max(42, Math.min(tileMaxW, baseTileFromCSS) * s);

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
          // Objective: maximize tile first, then maximize gap (less crowded)
          if (!best || tile > best.tile || (Math.abs(tile - best.tile) < 0.2 && ansGap > best.ansGap)) {
            best = { cols, tile, gridGap, exTile, exGap, ansW, ansGap, gap };
          } else if (!best) {
            best = { cols, tile, gridGap, exTile, exGap, ansW, ansGap, gap };
          }
          break;
        }
      }
      if (best) break;
    }

    // If nothing fits, use max columns + minimum scale
    if (!best) {
      const cols = maxCols;
      const s = 0.66;

      const gap = Math.max(8, baseGap * s);
      const gridGap = Math.max(4, baseGridGap * s);
      const exGap = Math.max(3, baseExGap * s);
      const ansGap = Math.max(8, baseAnsGap * s);

      const tileMaxW = (availW - (size - 1) * gridGap) / size;
      const tile = Math.max(40, Math.min(tileMaxW, baseTileFromCSS) * s);
      const exTile = clamp(tile * 0.34, 12, tile * 0.5);
      const ansW = clamp(baseAnsW * s, 190, availW * 0.96);

      best = { cols, tile, gridGap, exTile, exGap, ansW, ansGap, gap };
    }

    root.style.setProperty('--ans-cols', String(best.cols));
    root.style.setProperty('--tile', best.tile.toFixed(2) + 'px');
    root.style.setProperty('--grid-gap', best.gridGap.toFixed(2) + 'px');
    root.style.setProperty('--ex-tile', best.exTile.toFixed(2) + 'px');
    root.style.setProperty('--ex-gap', best.exGap.toFixed(2) + 'px');
    root.style.setProperty('--ans-w', best.ansW.toFixed(2) + 'px');
    root.style.setProperty('--ans-gap', best.ansGap.toFixed(2) + 'px');
    root.style.setProperty('--gap', best.gap.toFixed(2) + 'px');
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
      const isTarget = targetIdxs.includes(i);
      const img = document.createElement('img');
      img.className = 'ex-tile';
      img.src = isTarget ? 'assets/Bingo_Panel_Red_Example.png' : 'assets/Bingo_Panel_Blue_Example.png';
      img.alt = '';
      elExample.appendChild(img);
    }
  }

  function renderAnswers(){
    elAnswers.innerHTML = '';

    const correct = targetIdxs.map(idx => ({
      tileIdx: idx,
      text: tiles[idx]?.pair?.a || '',
      isTarget: true,
    }));

    const decoyPool = tiles
      .map((t, idx) => ({ tileIdx: idx, text: t?.pair?.a || '', isTarget: false }))
      .filter(x => !targetIdxs.includes(x.tileIdx));

    const usedText = new Set(correct.map(c => c.text));
    const decoys = [];
    shuffle(decoyPool);
    for (const d of decoyPool) {
      if (decoys.length >= Math.max(0, cfg.choices - correct.length)) break;
      if (!d.text || usedText.has(d.text)) continue;
      usedText.add(d.text);
      decoys.push(d);
    }

    const all = shuffle(correct.concat(decoys));

    all.forEach(item => {
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
  }

  // ----------------------------
  // Overlay / timer
  // ----------------------------
  function openOverlay(title){
    overlayTitle.textContent = title;
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
        gameOver("Time's up");
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
    if (hearts <= 0) gameOver('Game Over');
  }

  function gameOver(title){
    if (done) return;
    done = true;
    openOverlay(title);
  }

  function win(){
    if (done) return;
    done = true;
    openOverlay('BINGO!');
  }

  function reset(){
    paused = false;
    done = false;
    hearts = 3;
    renderHearts();
    closeOverlay();

    let pairs = getPairs(lang);

    const minNeeded = totalTiles + cfg.choices;
    if (!pairs || pairs.length < minNeeded) {
      const base = (pairs || []).slice();
      const need = Math.max(0, minNeeded - base.length);
      for (let i = 0; i < need; i++) {
        base.push({ id: `dummy-${Date.now()}-${i}`, q1: `WORD ${i + 1}`, q2: '', a: `MEANING ${i + 1}` });
      }
      pairs = base;
    }

    const chosen = pickUnique(pairs, totalTiles);

    targetIdxs = pickPattern(gridSize, cfg.target);
    remainingTargets = cfg.target;

    tiles.length = 0;
    for (let i = 0; i < totalTiles; i++) {
      tiles.push({ pair: chosen[i], isTarget: targetIdxs.includes(i), solved: false });
    }

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
      if (paused) openOverlay('Paused');
      else closeOverlay();
    });

    resumeBtn.addEventListener('click', () => {
      if (done && overlayTitle.textContent !== 'Paused') return;
      paused = false;
      closeOverlay();
    });

    retryBtn.addEventListener('click', () => reset());

    backBtn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.pathname = url.pathname.replace(/bingo\.html$/i, 'game.html');
      url.searchParams.delete('diff');
      url.searchParams.delete('lang');
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
