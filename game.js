(() => {
  'use strict';

  /**
   * Language -> Difficulty morph UI.
   *
   * Goal:
   * - Make the split/merge feel physically natural (1 button -> 3 buttons -> 1 button)
   *   without “jumping” or “blinking” during the motion.
   *
   * Key idea:
   * - Do NOT hide/disable the language buttons until AFTER ghost buttons exist.
   *   Otherwise some browsers drop :hover state immediately (pointer-events changes),
   *   changing the button rect before ghosts are created, which looks like a jump.
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
  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  // -----------------------------
  // Geometry helpers
  // -----------------------------

  /**
   * A small tolerance avoids infinite retries from subpixel rounding.
   * @param {DOMRect} a
   * @param {DOMRect} b
   */
  function rectAlmostEqual(a, b) {
    const EPS = 0.75;
    return (
      Math.abs(a.left - b.left) < EPS &&
      Math.abs(a.top - b.top) < EPS &&
      Math.abs(a.width - b.width) < EPS &&
      Math.abs(a.height - b.height) < EPS
    );
  }

  /**
   * Wait until a set of rects is stable for two consecutive frames.
   *
   * Why:
   * - On some devices/browsers, toggling classes can cause a 1-frame transient
   *   layout where rects are wrong. If we animate to those, the ghosts arrive
   *   at the wrong place and the UI appears to "snap" after the crossfade.
   *
   * @param {() => DOMRect[]} getRects
   * @param {(rects: DOMRect[]) => void} onStable
   * @param {number} [maxFrames]
   */
  function waitForStableRects(getRects, onStable, maxFrames = 12) {
    let prev = null;
    let frames = 0;

    function tick() {
      const rects = getRects();

      const hasAll = rects.length === 3;
      const allSized = rects.every((r) => r.width > 0 && r.height > 0);

      if (!hasAll || !allSized) {
        frames += 1;
        if (frames >= maxFrames) {
          onStable(rects);
          return;
        }
        window.requestAnimationFrame(tick);
        return;
      }

      if (prev && rects.every((r, i) => rectAlmostEqual(r, prev[i]))) {
        onStable(rects);
        return;
      }

      prev = rects;
      frames += 1;

      if (frames >= maxFrames) {
        onStable(rects);
        return;
      }
      window.requestAnimationFrame(tick);
    }

    window.requestAnimationFrame(tick);
  }

  /**
   * Single-rect variant of waitForStableRects().
   * @param {() => DOMRect} getRect
   * @param {(rect: DOMRect) => void} onStable
   * @param {number} [maxFrames]
   */
  function waitForStableRect(getRect, onStable, maxFrames = 12) {
    let prev = null;
    let frames = 0;

    function tick() {
      const rect = getRect();
      const sized = rect.width > 0 && rect.height > 0;

      if (!sized) {
        frames += 1;
        if (frames >= maxFrames) {
          onStable(rect);
          return;
        }
        window.requestAnimationFrame(tick);
        return;
      }

      if (prev && rectAlmostEqual(rect, prev)) {
        onStable(rect);
        return;
      }

      prev = rect;
      frames += 1;
      if (frames >= maxFrames) {
        onStable(rect);
        return;
      }
      window.requestAnimationFrame(tick);
    }

    window.requestAnimationFrame(tick);
  }

  // -----------------------------
  // Timing constants (ms)
  // -----------------------------

  const TIME = Object.freeze({
    TOAST_HIDE: 1200,

    // enterDifficulty()
    SPLIT_LABEL_SHOW: 120,
    // Crossfade at the end of the transform so ghosts and real buttons overlap perfectly
    // (prevents the "teleport/blink" feel during the last part of the motion).
    SPLIT_CROSSFADE: 420,
    // Must be >= SPLIT_CROSSFADE + opacity transition to prevent a 1-frame pop.
    SPLIT_CLEANUP: 640,

    // exitDifficulty()
    MERGE_LABEL_HIDE: 220,
    // Same reasoning as SPLIT_CROSSFADE: crossfade once the ghosts reach the target.
    MERGE_CROSSFADE: 420,
    MERGE_CLEANUP: 640,

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
    gamePickOverlay: $id('gamePickOverlay'),
    gamePickCancel: $id('gamePickCancel'),
  };

  // -----------------------------
  // State
  // -----------------------------

  const state = {
    toastTimer: null,
    isAnimating: false,
    pendingDiff: '',
  };

  // -----------------------------
  // Mini-game pick overlay (opened after selecting a difficulty)
  // -----------------------------

  function openGamePick(diff) {
    if (!els.gamePickOverlay) return;
    state.pendingDiff = diff || '';
    els.gamePickOverlay.classList.add('show');
    els.gamePickOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeGamePick() {
    if (!els.gamePickOverlay) return;
    els.gamePickOverlay.classList.remove('show');
    els.gamePickOverlay.setAttribute('aria-hidden', 'true');
  }

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

    state.isAnimating = true;
    els.body.classList.add('animating-morph');

    // Clear any overlay artifacts from previous transitions.
    closeGamePick();

    const lang = langBtn.dataset.lang || '';
    els.body.dataset.lang = lang;

    // Capture the source position BEFORE any layout changes.
    const srcRect = langBtn.getBoundingClientRect();

    // Make the difficulty container measurable in its *final layout*.
    //
    // Important:
    // - The ghosts must animate to the exact position where the real buttons
    //   will end up once the crossfade happens.
    // - If we measure before the "final" state classes are applied, some
    //   browsers show a 1-frame transient layout (wrong rects), which makes
    //   the ghosts "arrive wrong" and then the real buttons snap into place.
    //
    // We apply .is-ready early (final state), but keep it visually hidden
    // via .measuring until the ghosts arrive.
    els.diffs.classList.add('is-prep');
    els.diffs.classList.add('is-ready');
    els.diffs.classList.add('measuring');
    els.diffs.setAttribute('aria-hidden', 'true');

    // Create ghosts FIRST (so there is never a blank frame).
    const ghosts = [
      createGhost('assets/EASY.png'),
      createGhost('assets/NORMAL.png'),
      createGhost('assets/HARD.png'),
    ].filter(Boolean);

    ghosts.forEach((g) => {
      setGhostRect(g, srcRect);
      els.animLayer.appendChild(g);
    });

    // Start title morph via CSS variables.
    els.body.classList.add('difficulty-mode');

    // Measure targets once the destination layout is stable.
    const getTargetRects = () => {
      const targets = $$('.diff-btn', els.diffs);
      return targets.map((b) => b.getBoundingClientRect());
    };

    waitForStableRects(getTargetRects, (targetRects) => {
      const hasAll = targetRects.length === 3;
      const allSized = targetRects.every((r) => r.width > 0 && r.height > 0);

      // Fallback: if we still can't measure, skip the morph but still enter the screen.
      if (!hasAll || !allSized) {
        els.body.classList.add('langs-hidden');
        els.diffs.classList.remove('measuring');
        els.diffs.setAttribute('aria-hidden', 'false');
        ghosts.forEach((g) => g.remove());
        els.diffs.classList.remove('is-prep');
        els.body.classList.remove('animating-morph');
        state.isAnimating = false;
        return;
      }

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

        // Now that ghosts exist, hide/disable the real language buttons.
        // This prevents the “jump” caused by hover state being dropped too early.
        els.body.classList.add('langs-hidden');
      });

      // Show labels after the split starts so text doesn't overlap at the beginning.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.classList.add('show-label'));
      }, TIME.SPLIT_LABEL_SHOW);

      // Crossfade ghosts -> real difficulty buttons.
      // IMPORTANT: we only change opacity here (layout is already final),
      // so there is no last-frame snap.
      window.setTimeout(() => {
        els.diffs.classList.remove('measuring');
        els.diffs.setAttribute('aria-hidden', 'false');
        ghosts.forEach((g) => g.classList.add('fade-out'));
      }, TIME.SPLIT_CROSSFADE);

      // Cleanup after transitions finish.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.remove());
        els.diffs.classList.remove('is-prep');
        els.body.classList.remove('animating-morph');
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

    state.isAnimating = true;
    els.body.classList.add('animating-morph');

    const lang = els.body.dataset.lang || '';
    const langBtn = lang
      ? document.querySelector(`.lang-btn[data-lang="${lang}"]`)
      : null;
    const diffBtns = $$('.diff-btn', els.diffs);

    // Fallback (no lang selected / missing nodes)
    if (!langBtn || diffBtns.length !== 3 || !els.animLayer) {
      els.diffs.classList.remove('is-ready');
      els.diffs.classList.remove('measuring');
      els.diffs.classList.remove('is-prep');
      els.diffs.setAttribute('aria-hidden', 'true');
      els.body.classList.remove('difficulty-mode');
      els.body.dataset.lang = '';
      window.setTimeout(() => {
        els.body.classList.remove('animating-morph');
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

    // Hide the real difficulty buttons while keeping their *final layout* intact.
    // (We keep .is-ready so their rects remain the same until the crossfade ends.)
    els.diffs.classList.add('measuring');
    els.diffs.setAttribute('aria-hidden', 'true');

    // Keep language buttons hidden while we merge.
    // NOTE: .langs-hidden is kept until the merge finishes.
    els.body.classList.add('merging-mode');
    els.body.classList.add('langs-hidden');

    // Remove difficulty-mode on the next frame (avoids a 1-frame flash).
    window.requestAnimationFrame(() => {
      els.body.classList.remove('difficulty-mode');

      // Destination rect after layout returns to Language screen.
      // Wait for a stable rect to avoid a 1-frame transient wrong position.
      waitForStableRect(() => langBtn.getBoundingClientRect(), (dstRect) => {
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
      });

      // Fade labels out before they start overlapping near the end.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.classList.remove('show-label'));
      }, TIME.MERGE_LABEL_HIDE);

      // Crossfade ghosts out while language buttons fade in.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.classList.add('fade-out'));
        els.body.classList.remove('merging-mode');
        els.body.classList.remove('langs-hidden');
      }, TIME.MERGE_CROSSFADE);

      // Cleanup.
      window.setTimeout(() => {
        ghosts.forEach((g) => g.remove());
        els.diffs.classList.remove('is-ready');
        els.diffs.classList.remove('measuring');
        els.diffs.classList.remove('is-prep');
        els.body.dataset.lang = '';
        els.body.classList.remove('animating-morph');
        state.isAnimating = false;
      }, TIME.MERGE_CLEANUP);

    });
  }

  function navigateTo(url) {
    window.location.href = url;
  }

  // -----------------------------
  // Event wiring
  // -----------------------------

  if (els.backBtn) {
    els.backBtn.addEventListener('click', () => {
      // If the game-pick overlay is open, close it first.
      if (els.gamePickOverlay?.classList.contains('show')) {
        closeGamePick();
        return;
      }
      if (els.body.classList.contains('difficulty-mode')) {
        exitDifficulty();
        return;
      }
      navigateTo('./index.html');
    });
  }

  $$('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => enterDifficulty(btn));
  });

  // Difficulty is selected first; then we pick which mini-game to launch.
  $$('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const diff = btn.dataset.diff || 'normal';
      openGamePick(diff);
    });
  });

  // Overlay: click outside the dialog closes it.
  if (els.gamePickOverlay) {
    els.gamePickOverlay.addEventListener('click', (e) => {
      if (e.target === els.gamePickOverlay) closeGamePick();
    });
  }

  if (els.gamePickCancel) {
    els.gamePickCancel.addEventListener('click', closeGamePick);
  }

  $$('.pick-game-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const game = btn.dataset.game || 'bingo';
      const lang = els.body.dataset.lang || 'ja';
      const diff = state.pendingDiff || 'normal';

      const page = game === 'acidrain' ? 'acidrain.html' : 'bingo.html';
      const next = `./${page}?lang=${encodeURIComponent(lang)}&diff=${encodeURIComponent(diff)}`;
      navigateTo(next);
    });
  });

  // Prevent orphaned timers when the page is backgrounded or navigated away.
  window.addEventListener('pagehide', clearToastTimer);

  // NOTE: showToast() is currently unused on this screen,
  // but kept for future "Coming soon" variants.
})();
