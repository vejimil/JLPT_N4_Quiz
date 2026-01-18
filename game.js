(() => {
  'use strict';

  /**
   * Language -> Difficulty morph UI.
   *
   * This screen now follows the flow:
   *   Language -> Difficulty -> (popup) Game pick -> Navigate
   *
   * Why:
   * - You asked to pick the difficulty first, then choose which mini-game (Bingo / Acid Rain).
   * - This also scales naturally once you add more mini-games.
   */

  // -----------------------------
  // DOM helpers
  // -----------------------------

  /** @param {string} id */
  const $id = (id) => document.getElementById(id);

  /**
   * Query all matching elements as a stable Array.
   * @param {string} selector
   * @param {ParentNode} [root]
   */
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  // -----------------------------
  // Timing constants (ms)
  // -----------------------------

  const TIME = Object.freeze({
    TOAST_HIDE: 1200,

    // enterDifficulty()
    SPLIT_LABEL_SHOW: 120,
    SPLIT_CROSSFADE: 320,
    SPLIT_CLEANUP: 480,

    // exitDifficulty()
    MERGE_LABEL_HIDE: 220,
    MERGE_CROSSFADE: 320,
    MERGE_CLEANUP: 500,
    MERGE_REVEAL_CLEANUP: 560,

    // fallback branch (no morph possible)
    FALLBACK_ANIM_END: 460,
  });

  const GHOST_TRANSITION =
    'transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease';

  const GHOST_START_TRANSFORM = 'translate(0px, 0px) scale(1, 1)';

  // -----------------------------
  // DOM references
  // -----------------------------

  const els = {
    body: document.body,
    backBtn: $id('backBtn'),
    toast: $id('toast'),
    animLayer: $id('animLayer'),
    diffs: $id('diffs'),

    // Game pick overlay (opens after difficulty selection)
    gamePickOverlay: $id('gamePickOverlay'),
    gamePickCancel: $id('gamePickCancel'),
  };

  // -----------------------------
  // State
  // -----------------------------

  const state = {
    toastTimer: null,
    isAnimating: false,

    // When the user clicks a difficulty, we store it here until they pick the mini-game.
    pending: {
      lang: '',
      diff: '',
    },

    isGamePickOpen: false,
  };

  // -----------------------------
  // Toast
  // -----------------------------

  function clearToastTimer() {
    if (state.toastTimer !== null) {
      window.clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
  }

  /** @param {string} msg */
  function showToast(msg) {
    if (!els.toast) return;

    els.toast.textContent = msg;
    els.toast.classList.add('show');

    clearToastTimer();
    state.toastTimer = window.setTimeout(() => {
      // Guard: the element may disappear on navigation.
      if (els.toast) els.toast.classList.remove('show');
    }, TIME.TOAST_HIDE);
  }

  // -----------------------------
  // Game pick overlay (Difficulty -> Game)
  // -----------------------------

  /** @param {string} v */
  function normalizeGame(v) {
    return v === 'acidrain' ? 'acidrain' : 'bingo';
  }

  /** @param {string} v */
  function normalizeDiff(v) {
    return (v === 'easy' || v === 'hard') ? v : 'normal';
  }

  /** @param {string} v */
  function normalizeLang(v) {
    // Keep this conservative; other pages already default safely.
    return (v === 'fr' || v === 'es' || v === 'ja') ? v : 'ja';
  }

  /** @param {string} diff */
  function openGamePick(diff) {
    if (!els.gamePickOverlay) return;

    // Persist the user's intent, then ask for the remaining choice (mini-game).
    state.pending.lang = normalizeLang(els.body?.dataset?.lang || 'ja');
    state.pending.diff = normalizeDiff(diff);

    els.gamePickOverlay.classList.add('show');
    els.gamePickOverlay.setAttribute('aria-hidden', 'false');
    state.isGamePickOpen = true;
  }

  function closeGamePick() {
    if (!els.gamePickOverlay) return;

    els.gamePickOverlay.classList.remove('show');
    els.gamePickOverlay.setAttribute('aria-hidden', 'true');
    state.isGamePickOpen = false;
  }

  /** @param {string} game */
  function navigateToMiniGame(game) {
    const g = normalizeGame(game);
    const page = g === 'acidrain' ? 'acidrain.html' : 'bingo.html';

    const lang = normalizeLang(state.pending.lang || 'ja');
    const diff = normalizeDiff(state.pending.diff || 'normal');

    const next = `./${page}?lang=${encodeURIComponent(lang)}&diff=${encodeURIComponent(diff)}`;
    window.location.href = next;
  }

  // -----------------------------
  // Split/Merge animation helpers
  // -----------------------------

  /**
   * Create a ghost button used for the split/merge animation.
   * The ghost is non-interactive and lives in #animLayer.
   *
   * @param {string} labelSrc
   * @returns {HTMLButtonElement|null}
   */
  function createGhost(labelSrc) {
    if (!els.animLayer) return null;

    const b = document.createElement('button');
    b.className = 'ghost-btn';
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = `
      <img class="bg-img" src="assets/Button.png" alt="" />
      <img class="label-img" src="${labelSrc}" alt="" />
    `;

    // Keep transition/starting transform identical to the original.
    b.style.transition = GHOST_TRANSITION;
    b.style.transform = GHOST_START_TRANSFORM;

    return b;
  }

  /**
   * Place a ghost element at an absolute viewport rect.
   * @param {HTMLElement} el
   * @param {DOMRect} rect
   */
  function setGhostRect(el, rect) {
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';
  }

  /**
   * Enter Difficulty mode: split a selected language button into 3 ghost buttons
   * that morph into the real difficulty buttons.
   *
   * @param {HTMLElement} langBtn
   */
  function enterDifficulty(langBtn) {
    if (state.isAnimating) return;
    if (!langBtn || !els.diffs || !els.animLayer) return;
    if (els.body.classList.contains('difficulty-mode')) return;

    // If the user re-enters quickly, always reset the overlay.
    closeGamePick();

    state.isAnimating = true;

    // Clear any reveal animation class from previous transitions.
    els.body.classList.remove('lang-reveal');

    const lang = langBtn.dataset.lang || '';
    els.body.dataset.lang = lang;

    // Capture the source position BEFORE any layout changes.
    const srcRect = langBtn.getBoundingClientRect();

    // Title morph begins immediately via CSS variables.
    els.body.classList.add('difficulty-mode');

    // Hide targets until the split morph completes (prevents click/flash during animation).
    els.diffs.classList.remove('is-ready');
    els.diffs.classList.remove('is-prep');
    els.diffs.setAttribute('aria-hidden', 'true');

    // Measure targets AFTER difficulty layout is applied.
    window.requestAnimationFrame(() => {
      const targets = $$('.diff-btn', els.diffs);
      const targetRects = targets.map((b) => b.getBoundingClientRect());

      const ghosts = [
        createGhost('assets/EASY.png'),
        createGhost('assets/NORMAL.png'),
        createGhost('assets/HARD.png'),
      ].filter(Boolean);

      ghosts.forEach((g) => {
        setGhostRect(g, srcRect);
        els.animLayer.appendChild(g);
      });

      // Kick off the split morph.
      window.requestAnimationFrame(() => {
        ghosts.forEach((g, i) => {
          const tr = targetRects[i];
          if (!tr) return;

          const dx = tr.left - srcRect.left;
          const dy = tr.top - srcRect.top;
          const sx = tr.width / srcRect.width;
          const sy = tr.height / srcRect.height;

          g.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        });
      });

      // Show labels after the split starts so text doesn't overlap at the beginning.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.classList.add('show-label'));
      }, TIME.SPLIT_LABEL_SHOW);

      // Crossfade ghosts -> real difficulty buttons to avoid end-of-animation flicker.
      window.setTimeout(() => {
        els.diffs.classList.add('is-prep');
        els.diffs.classList.add('is-ready');
        els.diffs.setAttribute('aria-hidden', 'false');
        ghosts.forEach((g) => g.classList.add('fade-out'));
      }, TIME.SPLIT_CROSSFADE);

      // Cleanup after transitions finish.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.remove());
        els.diffs.classList.remove('is-prep');
        state.isAnimating = false;
      }, TIME.SPLIT_CLEANUP);
    });
  }

  /**
   * Exit Difficulty mode: morph EASY/NORMAL/HARD back into the selected language button.
   */
  function exitDifficulty() {
    if (state.isAnimating) return;
    if (!els.diffs) return;
    if (!els.body.classList.contains('difficulty-mode')) return;

    // Priority: if the game-pick popup is open, close it first.
    if (state.isGamePickOpen) {
      closeGamePick();
      return;
    }

    state.isAnimating = true;

    const lang = els.body.dataset.lang || '';
    const langBtn = lang ? document.querySelector(`.lang-btn[data-lang="${lang}"]`) : null;
    const diffBtns = $$('.diff-btn', els.diffs);

    // Fallback (no lang selected / missing nodes)
    if (!langBtn || diffBtns.length !== 3 || !els.animLayer) {
      els.diffs.classList.remove('is-ready');
      els.diffs.setAttribute('aria-hidden', 'true');
      els.body.classList.remove('difficulty-mode');
      els.body.dataset.lang = '';
      window.setTimeout(() => {
        state.isAnimating = false;
      }, TIME.FALLBACK_ANIM_END);
      return;
    }

    // Capture source rects (difficulty buttons)
    const srcRects = diffBtns.map((b) => b.getBoundingClientRect());

    // Create 3 ghosts at the difficulty button positions
    const ghosts = [
      createGhost('assets/EASY.png'),
      createGhost('assets/NORMAL.png'),
      createGhost('assets/HARD.png'),
    ].filter(Boolean);

    ghosts.forEach((g, i) => {
      setGhostRect(g, srcRects[i]);
      g.classList.add('show-label');
      els.animLayer.appendChild(g);
    });

    // Fade out real difficulty buttons (ghosts sit exactly on top, so no visual gap)
    els.diffs.classList.add('is-prep');
    els.diffs.classList.remove('is-ready');
    els.diffs.setAttribute('aria-hidden', 'true');

    // Keep language buttons hidden while we merge.
    els.body.classList.add('merging-mode');

    // Remove difficulty-mode on the next frame (avoids a 1-frame flash).
    window.requestAnimationFrame(() => {
      els.body.classList.remove('difficulty-mode');

      // Destination rect after layout returns to Language screen.
      const dstRect = langBtn.getBoundingClientRect();

      // Kick off the merge animation.
      window.requestAnimationFrame(() => {
        ghosts.forEach((g, i) => {
          const sr = srcRects[i];
          if (!sr) return;

          const dx = dstRect.left - sr.left;
          const dy = dstRect.top - sr.top;
          const sx = dstRect.width / sr.width;
          const sy = dstRect.height / sr.height;

          g.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        });
      });

      // Fade labels out before they start overlapping near the end.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.classList.remove('show-label'));
      }, TIME.MERGE_LABEL_HIDE);

      // Crossfade ghosts out while language buttons fade/slide in.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.classList.add('fade-out'));
        els.body.classList.remove('merging-mode');
        els.body.classList.add('lang-reveal');
      }, TIME.MERGE_CROSSFADE);

      // Cleanup.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.remove());
        els.diffs.classList.remove('is-prep');
        els.body.dataset.lang = '';
        state.isAnimating = false;
      }, TIME.MERGE_CLEANUP);

      // Remove reveal class after it plays.
      window.setTimeout(() => {
        els.body.classList.remove('lang-reveal');
      }, TIME.MERGE_REVEAL_CLEANUP);
    });
  }

  // -----------------------------
  // Event wiring
  // -----------------------------

  if (els.backBtn) {
    els.backBtn.addEventListener('click', () => {
      // If the popup is open, BACK should only dismiss it (least surprising).
      if (state.isGamePickOpen) {
        closeGamePick();
        return;
      }

      if (els.body.classList.contains('difficulty-mode')) {
        exitDifficulty();
        return;
      }

      window.location.href = './index.html';
    });
  }

  $$('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => enterDifficulty(btn));
  });

  // Difficulty click opens the game-pick overlay instead of navigating immediately.
  $$('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const diff = btn.dataset.diff || 'normal';
      openGamePick(diff);
    });
  });

  // Game pick buttons: choose the mini-game, then navigate.
  $$('.pick-game-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const game = btn.dataset.game || 'bingo';
      navigateToMiniGame(game);
    });
  });

  // Explicit cancel (BACK) button inside the overlay.
  if (els.gamePickCancel) {
    els.gamePickCancel.addEventListener('click', () => closeGamePick());
  }

  // Click-outside to dismiss (safe/expected behavior for a modal).
  if (els.gamePickOverlay) {
    els.gamePickOverlay.addEventListener('click', (e) => {
      if (e.target === els.gamePickOverlay) closeGamePick();
    });
  }

  // ESC closes the overlay (desktop ergonomics).
  window.addEventListener('keydown', (e) => {
    if (!state.isGamePickOpen) return;
    if (e.key === 'Escape') closeGamePick();
  });

  // Prevent orphaned timers when the page is backgrounded or navigated away.
  window.addEventListener('pagehide', clearToastTimer);

  // NOTE: showToast() is currently unused on this screen,
  // but kept for future "Coming soon" variants.
})();
