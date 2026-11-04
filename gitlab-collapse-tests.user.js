// ==UserScript==
// @name         GitLab: collapse tests
// @namespace    https://github.com/pycz2/gitlab-tests-collapse-userscript
// @version      2.4.0
// @description  MR page: toggle button that marks all tests/**/test*.py files as viewed (collapsed) or unviewed (expanded), a code/tests review progress bar, and file/line stats without tests.
// @match        https://gitlab.com/*/-/merge_requests/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/pycz2/gitlab-tests-collapse-userscript/main/gitlab-collapse-tests.user.js
// @downloadURL  https://raw.githubusercontent.com/pycz2/gitlab-tests-collapse-userscript/main/gitlab-collapse-tests.user.js
// ==/UserScript==

(() => {
  'use strict';

  // File inside a `tests/` dir (any depth) with a `test*.py` name.
  const TEST_FILE = /(^|\/)tests\/(.+\/)?test[^/]*\.py$/;
  const STATS_ID = 'tm-code-stats';

  // Inline SVG icons (16x16, stroke = currentColor).
  const svg = (body, extra = '') =>
    `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
  const ICON_CODE = svg('<path d="M5 4.5 1.5 8 5 11.5M11 4.5l3.5 3.5-3.5 3.5M9.3 2.5l-2.6 11"/>');
  const ICON_TESTS = svg('<path d="M6 1.5h4M6.8 1.5v4.3L2.6 12.6a1.3 1.3 0 0 0 1.1 1.9h8.6a1.3 1.3 0 0 0 1.1-1.9L9.2 5.8V1.5M4.4 10h7.2"/>');
  const ICON_DONE =
    '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="8" fill="currentColor"/>' +
    '<path d="m4.6 8.2 2.3 2.3 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const CSS = `
    .tm-bar { display: flex; align-items: center; gap: 8px; align-self: center; }
    /* Narrower on small windows, so the bar does not cover the MR tabs. */
    .tm-track { display: flex; gap: 4px; width: clamp(160px, 18vw, 260px); height: 14px; }
    .tm-seg {
      --c1: #6aa5ff; --c2: #2f6fdb; --p: 0;
      position: relative; flex-basis: 0; min-width: 44px; border-radius: 999px;
      background: color-mix(in srgb, var(--c2) 16%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c2) 45%, transparent);
      transition: box-shadow .3s;
    }
    .tm-seg.tm-tests { --c1: #ffc861; --c2: #d98a12; }
    .tm-seg.tm-done {
      box-shadow: inset 0 0 0 1px var(--c1), 0 0 10px 1px color-mix(in srgb, var(--c1) 65%, transparent);
    }
    .tm-fill {
      position: absolute; inset: 0 auto 0 0; width: calc(var(--p) * 100%); border-radius: inherit;
      background: linear-gradient(90deg, var(--c2), var(--c1));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .3);
      transition: width .4s ease;
    }
    /* Round knob with the part icon; it rides on the fill edge. */
    .tm-knob {
      position: absolute; top: 50%; left: calc((100% - 18px) * var(--p)); width: 18px; height: 18px;
      transform: translateY(-50%); border-radius: 50%; display: grid; place-items: center; color: #fff;
      background: linear-gradient(180deg, var(--c1), var(--c2));
      box-shadow: 0 0 0 2px var(--gl-background-color-default, #18171d), 0 1px 3px rgba(0, 0, 0, .5);
      transition: left .4s ease;
    }
    /* The percentage sits on the side away from the knob. */
    .tm-pct {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding: 0 7px;
      font: 600 9px/1 var(--default-regular-font, sans-serif); font-variant-numeric: tabular-nums; letter-spacing: .02em;
      color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, .7); pointer-events: none;
    }
    .tm-pct.tm-left { justify-content: flex-start; }
    .tm-check { display: flex; color: #2da160; opacity: 0; transform: scale(.6); transition: opacity .3s, transform .3s; }
    .tm-all .tm-seg { --c1: #52d68f; --c2: #1f9d5c; }
    .tm-all .tm-check { opacity: 1; transform: scale(1); }
  `;

  const segment = (cls, title, icon) =>
    `<span class="tm-seg ${cls}"><span class="tm-fill"></span><span class="tm-pct"></span>` +
    `<span class="tm-knob" title="${title}">${icon}</span></span>`;
  const BAR_HTML =
    '<span class="tm-track">' +
    segment('tm-code', 'Code', ICON_CODE) +
    segment('tm-tests', 'Tests', ICON_TESTS) +
    `</span><span class="tm-check" title="Everything is viewed">${ICON_DONE}</span>`;

  const num = (el) => Number(el?.textContent.replace(/\D/g, '') || 0);

  // Rapid Diffs view: every file is a <diff-file> in the DOM.
  const rapidFiles = () =>
    [...document.querySelectorAll('diff-file')].map((el) => {
      let path = '';
      try {
        path = JSON.parse(el.dataset.fileData).new_path;
      } catch {}
      const box = el.querySelector('input[data-viewed-checkbox]');
      return {
        path,
        added: num(el.querySelector('.rd-stats-added')),
        removed: num(el.querySelector('.rd-stats-removed')),
        canView: Boolean(box && !box.disabled),
        viewed: () => Boolean(box?.checked),
        set: () => box.click(),
      };
    });

  // Classic view: virtual scrolling keeps most files out of the DOM, so use the Pinia stores.
  const classicFiles = () => {
    // ponytail: relies on GitLab internals (Pinia stores `legacyDiffs` and `codeReview`); fix here if GitLab renames them.
    const pinia = document.querySelector('.diff-file')?.__vue__?.$pinia;
    const diffs = pinia?._s.get('legacyDiffs');
    const review = pinia?._s.get('codeReview');
    if (!diffs || !review) return [];
    return diffs.diffFiles.map((f) => ({
      path: f.file_path,
      added: f.added_lines || 0,
      removed: f.removed_lines || 0,
      canView: true,
      viewed: () => Boolean(review.reviewedIds[f.code_review_id]),
      // Same calls as the "Viewed" checkbox handler (DiffFileHeader.toggleReview).
      set: (on) => {
        review.removeId(f.id);
        review.setReviewed(f.code_review_id, on);
        diffs.setFileCollapsedByUser({ filePath: f.file_path, collapsed: on });
      },
    }));
  };

  const allFiles = () => {
    const rapid = rapidFiles();
    return rapid.length ? rapid : classicFiles();
  };

  const isTest = (f) => TEST_FILE.test(f.path);
  const testsOf = (files) => files.filter((f) => f.canView && isTest(f));
  const allViewed = (list) => list.length > 0 && list.every((f) => f.viewed());
  const sum = (list, fn) => list.reduce((s, f) => s + fn(f), 0);
  // Changed lines; 1 for files without line stats (binary, renames), so they still count.
  const weight = (f) => f.added + f.removed || 1;
  const pct = (done, total) => (total ? Math.floor((100 * done) / total) : 0);

  const renderStats = (files) => {
    const total = document.querySelector('.diff-stats-contents');
    if (!total || !files.length) return;
    let stats = document.getElementById(STATS_ID);
    if (!stats) {
      stats = document.createElement('div');
      stats.id = STATS_ID;
      stats.className = 'gl-flex gl-items-center gl-gap-4 gl-ml-4 gl-font-bold';
      total.after(stats);
    }
    const group = (label, title, list) =>
      `<span class="gl-flex gl-items-center gl-gap-2" title="${title}">` +
      `<span class="gl-text-subtle">${label}: ${list.length} files</span>` +
      `<span class="gl-text-success">+${sum(list, (f) => f.added)}</span>` +
      `<span class="gl-text-danger">−${sum(list, (f) => f.removed)}</span></span>`;
    const html =
      group('w/o tests', `Files not matching ${TEST_FILE}`, files.filter((f) => !isTest(f))) +
      group('to review', 'Files not marked as viewed', files.filter((f) => !f.viewed()));
    // Rewrite only on change, so the tooltip does not flicker every second.
    if (stats.dataset.html !== html) stats.innerHTML = stats.dataset.html = html;
  };

  const renderSegment = (seg, label, list) => {
    const total = sum(list, weight);
    const done = sum(list.filter((f) => f.viewed()), weight);
    const viewedFiles = list.filter((f) => f.viewed()).length;
    seg.style.display = list.length ? '' : 'none';
    // Part width is proportional to the changed lines in that part.
    seg.style.flexGrow = total;
    seg.style.setProperty('--p', total ? done / total : 0);
    const pctEl = seg.querySelector('.tm-pct');
    pctEl.textContent = `${pct(done, total)}%`;
    pctEl.classList.toggle('tm-left', total > 0 && done / total >= 0.5);
    seg.classList.toggle('tm-done', allViewed(list));
    seg.title = `${label}: ${done}/${total} lines, ${viewedFiles}/${list.length} files viewed`;
  };

  const renderBar = (bar, files) => {
    const [codeSeg, testSeg] = bar.querySelectorAll('.tm-seg');
    renderSegment(codeSeg, 'Code', files.filter((f) => !isTest(f)));
    renderSegment(testSeg, 'Tests', files.filter(isTest));
    bar.classList.toggle('tm-all', allViewed(files));
  };

  const renderButton = (btn, tests) => {
    const on = allViewed(tests);
    btn.classList.toggle('selected', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.disabled = tests.length === 0;
    btn.querySelector('.gl-button-text').textContent = `${on ? '✓ Tests collapsed' : 'Collapse tests'} (${tests.length})`;
  };

  const toggleTests = () => {
    const tests = testsOf(allFiles());
    const target = !allViewed(tests);
    for (const f of tests) if (f.viewed() !== target) f.set(target);
    tick();
  };

  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    e.className = cls;
    e.innerHTML = html;
    return e;
  };

  // GitLab can render the MR actions (thread counter, "Your review") more than once,
  // e.g. in the floating header, so add the controls next to every copy.
  // "Your review" exists only while a review is in progress, so it is not the only anchor.
  const hosts = () =>
    new Set(
      [...document.querySelectorAll('.merge-request-tabs-actions, .discussions-counter, [data-testid="review-drawer-toggle"]')].map(
        (e) => (e.matches('.merge-request-tabs-actions') ? e : e.parentElement),
      ),
    );

  const mount = (host) => {
    const counter = [...host.children].find((c) => c.matches('.discussions-counter'));
    const review = [...host.children].find((c) => c.matches('[data-testid="review-drawer-toggle"]'));
    let bar = host.querySelector(':scope > .tm-bar');
    if (!bar) {
      // The bar goes left of all buttons.
      bar = el('div', 'tm-bar', BAR_HTML);
      host.prepend(bar);
    }
    let btn = host.querySelector(':scope > .tm-btn');
    if (!btn) {
      btn = el('button', 'tm-btn btn gl-button btn-default btn-md', '<span class="gl-button-text"></span>');
      btn.type = 'button';
      btn.title = 'Mark all tests/**/test*.py files as viewed (collapse) or unviewed (expand)';
      btn.addEventListener('click', toggleTests);
      if (review) review.before(btn);
      else if (counter) counter.after(btn);
      else host.append(btn);
    }
    return [bar, btn];
  };

  const tick = () => {
    const files = allFiles();
    renderStats(files);
    if (!document.getElementById('tm-style')) {
      const style = el('style', '', CSS);
      style.id = 'tm-style';
      document.head.append(style);
    }
    // Tabs switch without a page reload, so show the controls only while "Changes" is active.
    const show = Boolean(document.querySelector('.merge-request-tabs .diffs-tab.active') && files.length);
    for (const host of hosts()) {
      const [bar, btn] = mount(host);
      bar.style.display = btn.style.display = show ? '' : 'none';
      if (!show) continue;
      renderBar(bar, files);
      renderButton(btn, testsOf(files));
    }
  };

  // GitLab re-renders the header and the user can change "Viewed" by hand, so re-check every second.
  tick();
  setInterval(tick, 1000);
})();
