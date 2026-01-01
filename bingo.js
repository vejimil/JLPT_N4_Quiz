/*
  Bingo gameplay (MVP)
  - Desktop layout: example board (left) / main board (center) / answers (right)
  - Mobile layout: stacked (example -> main -> answers)
  - Pattern is shown on the example board; player must pick the answers that belong to the pattern.
  - Wrong pick costs 1 heart. Time-out => game over.

  Query params:
    bingo.html?lang=ja|fr|es&diff=easy|normal|hard
*/

(() => {
  // ----------------------------
  // 0) Helpers
  // ----------------------------
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

  // ----------------------------
  // 1) Config
  // ----------------------------
  const DIFF = {
    easy:   { size: 3, target: 4, choices: 6,  timeSec: 28 },
    normal: { size: 4, target: 5, choices: 10, timeSec: 28 },
    hard:   { size: 4, target: 6, choices: 10, timeSec: 22 },
  };

  // Pattern templates (indices in row-major)
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
    if (size === 3) {
      return PATTERNS_3[Math.floor(Math.random() * PATTERNS_3.length)].slice(0, target);
    }
    if (size === 4 && target === 5) {
      return PATTERNS_4_5[Math.floor(Math.random() * PATTERNS_4_5.length)].slice();
    }
    if (size === 4 && target === 6) {
      return PATTERNS_4_6[Math.floor(Math.random() * PATTERNS_4_6.length)].slice();
    }
    const total = size * size;
    const idxs = Array.from({length: total}, (_, i) => i);
    shuffle(idxs);
    return idxs.slice(0, target);
  }

  // ----------------------------
  // 2) Vocab adapters
  // ----------------------------
  // NOTE: vocab-*.js define globals using `const VOCAB...`.
  // Those are *not* available as window.VOCAB (only as lexical globals).
  // So we must read them via `typeof VOCAB !== 'undefined'` checks.
  function getPairs(lang){
    if (lang === 'fr') {
      const SRC = (typeof VOCAB_FR !== 'undefined') ? VOCAB_FR : (globalThis.VOCAB_FR || []);
      const pool = (SRC || []).filter(v => v && v.fr && v.en);
      return pool.map(v => ({
        id: v.id,
        q1: String(v.fr),
        q2: '',
        a: String(v.en),
      }));
    }

    if (lang === 'es') {
      const SRC = (typeof VOCAB_ES !== 'undefined') ? VOCAB_ES : (globalThis.VOCAB_ES || []);
      const pool = (SRC || []).filter(v => v && v.es && v.en);
      return pool.map(v => ({
        id: v.id,
        q1: String(v.es),
        q2: '',
        a: String(v.en),
      }));
    }

    // ja (default)
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

  // ----------------------------
  // 3) DOM refs
  // ----------------------------
  const elExample = $('#exampleBoard');
  const elBoard = $('#mainBoard');
  const elAnswers = $('#answers');
  const elTimerMask = $('#timerMask');
  const elHp = $('#hp');

  const pauseBtn = $('#pauseBtn');
  const overlay = $('#overlay');
  const overlayTitle = $('#overlayTitle');
  const resumeBtn = $('#resumeBtn');
  const backBtn = $('#backBtn');
  const retryBtn = $('#retryBtn');

  if (!elExample || !elBoard || !elAnswers || !elTimerMask || !elHp) return;

  // ----------------------------
  // 4) State
  // ----------------------------
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

  const tiles = [];
  let targetIdxs = [];
  let remainingTargets = 0;

  // ----------------------------
  // 5) Rendering
  // ----------------------------
  function renderHearts(){
    const imgs = $$('.hp-heart', elHp);
    imgs.forEach((img, i) => {
      const alive = i < hearts;
      img.src = alive ? 'assets/HP_Red.png' : 'assets/HP_Black.png';
      img.alt = alive ? 'HP' : 'Lost HP';
    });
  }

  function makeTileButton(i, pair){
    const btn = document.createElement('button');
    btn.type = 'button';
    // Match bingo.html CSS selectors
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

  function setTileSolved(i){
    const btn = elBoard.querySelector(`.tile[data-idx="${i}"]`);
    if (!btn) return;
    const img = $('img', btn);
    if (img) img.src = 'assets/Bingo_Panel_Red.png';
    btn.classList.add('is-solved');
  }

  function renderBoard(){
    elBoard.style.setProperty('--grid-size', String(gridSize));
    elBoard.innerHTML = '';
    for (let i = 0; i < totalTiles; i++) {
      const t = tiles[i];
      elBoard.appendChild(makeTileButton(i, t.pair));
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
    elAnswers.style.setProperty('--ans-cols', '2');

    const correct = targetIdxs.map(idx => ({
      tileIdx: idx,
      text: (tiles[idx] && tiles[idx].pair) ? tiles[idx].pair.a : '',
      isTarget: true,
    }));

    const decoyPool = tiles
      .map((t, idx) => ({ tileIdx: idx, text: (t && t.pair) ? t.pair.a : '', isTarget: false }))
      .filter(x => !targetIdxs.includes(x.tileIdx));

    const usedText = new Set(correct.map(c => c.text));
    const decoys = [];
    shuffle(decoyPool);
    for (const d of decoyPool) {
      if (decoys.length >= Math.max(0, cfg.choices - correct.length)) break;
      if (usedText.has(d.text)) continue;
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
  // 6) Game flow
  // ----------------------------
  function openOverlay(title){
    if (!overlay) return;
    overlayTitle.textContent = title;
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closeOverlay(){
    if (!overlay) return;
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function setTimerCovered(frac){
    const p = clamp(frac, 0, 1) * 100;
    elTimerMask.style.width = p.toFixed(2) + '%';
  }

  function loseHeart(){
    hearts -= 1;
    hearts = clamp(hearts, 0, 3);
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

  let remainingMs = 0;

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
      remainingMs -= dt;
      remainingMs = Math.max(0, remainingMs);

      const covered = 1 - (remainingMs / (cfg.timeSec * 1000));
      setTimerCovered(covered);

      if (remainingMs <= 0) {
        gameOver('Time’s up');
        return;
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  function reset(){
    paused = false;
    done = false;
    hearts = 3;
    renderHearts();
    closeOverlay();

    // Build fresh board
    let pairs = getPairs(lang);

    // Safety: if vocab failed to load or is too small, inject placeholder pairs
    // so the UI still renders (and you can spot the console/network issue).
    const minNeeded = totalTiles + cfg.choices;
    if (!pairs || pairs.length < minNeeded) {
      const base = (pairs || []).slice();
      const need = Math.max(0, minNeeded - base.length);
      for (let i = 0; i < need; i++) {
        base.push({
          id: `dummy-${Date.now()}-${i}`,
          q1: `WORD ${i + 1}`,
          q2: '',
          a: `MEANING ${i + 1}`,
        });
      }
      pairs = base;
    }

    const chosen = pickUnique(pairs, totalTiles);

    targetIdxs = pickPattern(gridSize, cfg.target);
    remainingTargets = cfg.target;

    tiles.length = 0;
    for (let i = 0; i < totalTiles; i++) {
      tiles.push({
        pair: chosen[i],
        isTarget: targetIdxs.includes(i),
        solved: false,
      });
    }

    renderExample();
    renderBoard();
    renderAnswers();

    setTimerCovered(0);
    startTimer();
  }

  // ----------------------------
  // 7) Input
  // ----------------------------
  function bind(){
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        if (done) return;
        paused = !paused;
        if (paused) openOverlay('Paused');
        else closeOverlay();
      });
    }

    if (resumeBtn) resumeBtn.addEventListener('click', () => {
      if (done && overlayTitle.textContent !== 'Paused') return;
      paused = false;
      closeOverlay();
    });

    if (retryBtn) retryBtn.addEventListener('click', () => reset());

    if (backBtn) backBtn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.pathname = url.pathname.replace(/bingo\.html$/i, 'game.html');
      url.searchParams.delete('diff');
      url.searchParams.delete('lang');
      window.location.href = url.toString();
    });

    elAnswers.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.ans-btn') : null;
      if (!btn) return;
      if (paused || done) return;
      if (btn.disabled) return;

      const tileIdx = Number(btn.dataset.tileIdx);
      const isTarget = btn.dataset.isTarget === '1';

      if (Number.isNaN(tileIdx) || tileIdx < 0 || tileIdx >= totalTiles) return;

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
      setTileSolved(tileIdx);

      remainingTargets -= 1;
      if (remainingTargets <= 0) win();
    });

    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  }

  // ----------------------------
  // 8) Boot
  // ----------------------------
  function boot(){
    elExample.style.setProperty('--grid-size', String(gridSize));
    elBoard.style.setProperty('--grid-size', String(gridSize));

    if ($$('.hp-heart', elHp).length === 0) {
      for (let i = 0; i < 3; i++) {
        const img = document.createElement('img');
        img.className = 'hp-heart';
        img.src = 'assets/HP_Red.png';
        img.alt = 'HP';
        elHp.appendChild(img);
      }
    }

    renderHearts();
    bind();
    reset();
  }

  window.addEventListener('load', boot);
})();
