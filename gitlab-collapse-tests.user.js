// ==UserScript==
// @name         GitLab: collapse tests
// @namespace    https://github.com/pycz2/gitlab-tests-collapse-userscript
// @version      2.1.0
// @description  MR page: toggle button that marks all tests/**/test*.py files as viewed (collapsed) or unviewed (expanded), plus file/line stats without tests.
// @match        https://gitlab.com/*/-/merge_requests/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/pycz2/gitlab-tests-collapse-userscript/main/gitlab-collapse-tests.user.js
// @downloadURL  https://raw.githubusercontent.com/pycz2/gitlab-tests-collapse-userscript/main/gitlab-collapse-tests.user.js
// ==/UserScript==

(() => {
  'use strict';

  // File inside a `tests/` dir (any depth) with a `test*.py` name.
  const TEST_FILE = /(^|\/)tests\/(.+\/)?test[^/]*\.py$/;
  const BTN_ID = 'tm-collapse-tests';
  const STATS_ID = 'tm-code-stats';

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

  const testsOf = (files) => files.filter((f) => f.canView && TEST_FILE.test(f.path));
  const allViewed = (tests) => tests.length > 0 && tests.every((f) => f.viewed());

  const renderButton = (btn, tests) => {
    const on = allViewed(tests);
    btn.classList.toggle('selected', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.disabled = tests.length === 0;
    btn.querySelector('.gl-button-text').textContent = `${on ? '✓ Tests collapsed' : 'Collapse tests'} (${tests.length})`;
  };

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
      `<span class="gl-text-success">+${list.reduce((s, f) => s + f.added, 0)}</span>` +
      `<span class="gl-text-danger">−${list.reduce((s, f) => s + f.removed, 0)}</span></span>`;
    const html =
      group('w/o tests', `Files not matching ${TEST_FILE}`, files.filter((f) => !TEST_FILE.test(f.path))) +
      group('to review', 'Files not marked as viewed', files.filter((f) => !f.viewed()));
    // Rewrite only on change, so the tooltip does not flicker every second.
    if (stats.dataset.html !== html) stats.innerHTML = stats.dataset.html = html;
  };

  const tick = () => {
    const files = allFiles();
    renderStats(files);

    let btn = document.getElementById(BTN_ID);
    if (!btn) {
      const review = document.querySelector('.merge-request-tabs-actions [data-testid="review-drawer-toggle"]');
      if (!review) return;
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.className = 'gl-self-start btn gl-button btn-default btn-md';
      btn.title = 'Mark all tests/**/test*.py files as viewed (collapse) or unviewed (expand)';
      btn.innerHTML = '<span class="gl-button-text"></span>';
      btn.addEventListener('click', () => {
        const tests = testsOf(allFiles());
        const target = !allViewed(tests);
        for (const f of tests) if (f.viewed() !== target) f.set(target);
        tick();
      });
      review.before(btn);
    }
    // Tabs switch without a page reload, so show the button only while "Changes" is active.
    btn.style.display = document.querySelector('.merge-request-tabs .diffs-tab.active') ? '' : 'none';
    renderButton(btn, testsOf(files));
  };

  // GitLab re-renders the header and the user can change "Viewed" by hand, so re-check every second.
  tick();
  setInterval(tick, 1000);
})();
