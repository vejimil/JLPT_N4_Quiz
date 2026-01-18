(() => {
  'use strict';

  /**
   * Language -> Difficulty morph UI.
   *
   * Refactor intent:
   * - Keep user-visible behavior identical.
   * - Make timing/constants/state explicit.
   * - Keep DOM access centralized and guarded.
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
  };

  // -----------------------------
  // State
  // -----------------------------

  const state = {
    toastTimer: null,
    isAnimating: false,
  };

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

  // -----------------------------
  // Layout measurement helpers
  // -----------------------------

  /**
   * Compare two numbers with a small tolerance.
   * We need this because fractional pixels + fonts can produce sub-pixel jitter
   * for 1 frame during class toggles.
   */
  const approxEq = (a, b, eps) => Math.abs(a - b) <= eps;

  /** @param {DOMRect} a @param {DOMRect} b @param {number} eps */
  function rectApproxEq(a, b, eps) {
    return (
      approxEq(a.left, b.left, eps) &&
      approxEq(a.top, b.top, eps) &&
      approxEq(a.width, b.width, eps) &&
      approxEq(a.height, b.height, eps)
    );
  }

  /**
   * Snapshot a DOMRect into a plain object so it can't mutate between frames.
   * @param {DOMRect} r
   */
  function snapRect(r) {
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  /**
   * Some browsers can return transient (1-frame) incorrect rects right after
   * toggling classes that affect layout/visibility. This helper waits until the
   * rect(s) are stable for a couple frames (or times out) before proceeding.
   *
   * @param {() => DOMRect} getRect
   * @param {(rect: DOMRect) => void} onStable
   */
  function waitForStableRect(getRect, onStable) {
    const EPS = 0.5;
    const MAX_FRAMES = 20;
    const NEED_STABLE_FRAMES = 2;

    let last = null;
    let stableCount = 0;
    let frames = 0;

    const tick = () => {
      frames += 1;

      /** @type {DOMRect|null} */
      let rect = null;
      try {
        const r = getRect();
        if (r) rect = /** @type {any} */ (snapRect(r));
      } catch {
        // If layout can't be read (detached DOM), just finish with last.
      }

      if (rect && last && rectApproxEq(rect, last, EPS)) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }

      if (rect) last = rect;

      if (stableCount >= NEED_STABLE_FRAMES || frames >= MAX_FRAMES) {
        // Prefer the most recent rect we successfully captured.
        onStable(/** @type {any} */ (rect || last || getRect()));
        return;
      }

      window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(tick);
  }

  /**
   * Stable measurement for multiple buttons.
   * @param {() => DOMRect[]} getRects
   * @param {(rects: DOMRect[]|null) => void} onStable
   */
  function waitForStableRects(getRects, onStable) {
    const EPS = 0.5;
    const MAX_FRAMES = 20;
    const NEED_STABLE_FRAMES = 2;

    /** @type {{left:number,top:number,width:number,height:number}[]|null} */
    let last = null;
    let stableCount = 0;
    let frames = 0;

    const rectsApproxEq = (a, b) => {
      if (!a || !b) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        if (!rectApproxEq(a[i], b[i], EPS)) return false;
      }
      return true;
    };

    const tick = () => {
      frames += 1;

      /** @type {{left:number,top:number,width:number,height:number}[]|null} */
      let rects = null;
      try {
        const rs = getRects();
        if (Array.isArray(rs)) rects = rs.map((r) => snapRect(r));
      } catch {
        // ignore
      }

      if (rects && last && rectsApproxEq(rects, last)) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }

      if (rects) last = rects;

      if (stableCount >= NEED_STABLE_FRAMES || frames >= MAX_FRAMES) {
        onStable(/** @type {any} */ (rects || last));
        return;
      }

      window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(tick);
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

    // Clear any reveal animation class from previous transitions.
    els.body.classList.remove('lang-reveal');

    const lang = langBtn.dataset.lang || '';
    els.body.dataset.lang = lang;

    // Capture the source position BEFORE any layout changes.
    const srcRect = langBtn.getBoundingClientRect();

    // Title morph begins immediately via CSS variables.
    els.body.classList.add('difficulty-mode');
    els.diffs.classList.remove('is-ready');
    els.diffs.classList.remove('is-prep');
    els.diffs.setAttribute('aria-hidden', 'true');

    // Make the destination container measurable *before* we read target rects.
    //
    // Some browsers return transient/wrong rects for children inside a
    // visibility:hidden parent (even though spec-wise it should still be
    // measurable). When that happens, ghosts animate to a wrong spot and then
    // the real buttons “teleport” at the crossfade.
    //
    // `.is-prep` flips only `visibility: visible` while keeping opacity 0.
    els.diffs.classList.add('is-prep');

    // Measure targets AFTER difficulty layout is applied *and stable*.
    waitForStableRects(
      () => $$('.diff-btn', els.diffs).map((b) => b.getBoundingClientRect()),
      (targetRects) => {
        if (!targetRects || targetRects.length !== 3) {
          // Fail safe: show the real buttons rather than animating to a wrong place.
          els.diffs.classList.add('is-ready');
          els.diffs.setAttribute('aria-hidden', 'false');
          els.diffs.classList.remove('is-prep');
          state.isAnimating = false;
          return;
        }

        const ghosts = [
          createGhost('assets/EASY.png'),
          createGhost('assets/NORMAL.png'),
          createGhost('assets/HARD.png'),
        ].filter(Boolean);

        if (ghosts.length !== 3) {
          els.diffs.classList.add('is-ready');
          els.diffs.setAttribute('aria-hidden', 'false');
          els.diffs.classList.remove('is-prep');
          state.isAnimating = false;
          return;
        }

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
      }
    );
  }

  /**
   * Exit Difficulty mode: morph EASY/NORMAL/HARD back into the selected language button.
   */
  function exitDifficulty() {
    if (state.isAnimating) return;
    if (!els.diffs) return;
    if (!els.body.classList.contains('difficulty-mode')) return;

    state.isAnimating = true;

    const lang = els.body.dataset.lang || '';
    const langBtn = lang
      ? document.querySelector(`.lang-btn[data-lang="${lang}"]`)
      : null;
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
      // (Wait for stability: some browsers produce a transient 1-frame rect.)
      waitForStableRect(
        () => langBtn.getBoundingClientRect(),
        (dstRect) => {
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
        }
      );
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

  $$('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const diff = btn.dataset.diff || '';
      const lang = els.body.dataset.lang || '';
      const next = `./bingo.html?lang=${encodeURIComponent(lang || 'ja')}&diff=${encodeURIComponent(diff || 'normal')}`;
      navigateTo(next);
    });
  });

  // Prevent orphaned timers when the page is backgrounded or navigated away.
  window.addEventListener('pagehide', clearToastTimer);

  // NOTE: showToast() is currently unused on this screen,
  // but kept for future "Coming soon" variants.
})();
