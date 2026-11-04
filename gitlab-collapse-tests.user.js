// ==UserScript==
// @name         GitLab: collapse tests
// @namespace    https://github.com/pycz2/gitlab-tests-collapse-userscript
// @version      2.2.0
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
  const BOX_ID = 'tm-controls';
  const STATS_ID = 'tm-code-stats';

  const CSS = `
    #${BOX_ID} { display: flex; align-items: center; gap: 12px; align-self: center; }
    #${BOX_ID} .tm-bar { display: flex; align-items: center; gap: 6px; }
    #${BOX_ID} .tm-track { display: flex; gap: 3px; width: 220px; height: 10px; }
    #${BOX_ID} .tm-seg {
      --c: #1f75cb; position: relative; flex-basis: 0; min-width: 6px; border-radius: 4px; overflow: hidden;
      background: color-mix(in srgb, var(--c) 22%, transparent); transition: box-shadow .2s;
    }
    #${BOX_ID} .tm-seg.tm-tests { --c: #9e5ad6; }
    #${BOX_ID} .tm-seg.tm-done { box-shadow: 0 0 6px 1px var(--c); }
    #${BOX_ID} .tm-fill { position: absolute; inset: 0 auto 0 0; background: var(--c); transition: width .2s; }
    #${BOX_ID} .tm-check { visibility: hidden; color: #2da160; font-weight: bold; font-size: 16px; line-height: 1; }
    #${BOX_ID} .tm-all .tm-seg { --c: #2da160; }
    #${BOX_ID} .tm-all .tm-check { visibility: visible; }
  `;

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
    seg.style.flexGrow = total;
    seg.firstChild.style.width = `${total ? (100 * done) / total : 0}%`;
    seg.classList.toggle('tm-done', allViewed(list));
    seg.title = `${label}: ${done}/${total} lines, ${viewedFiles}/${list.length} files viewed`;
  };

  const renderBar = (bar, files) => {
    const code = files.filter((f) => !isTest(f));
    const tests = files.filter(isTest);
    const [codeSeg, testSeg] = bar.querySelectorAll('.tm-seg');
    renderSegment(codeSeg, 'Code', code);
    renderSegment(testSeg, 'Tests', tests);
    bar.classList.toggle('tm-all', allViewed(files));
  };

  const renderButton = (btn, tests) => {
    const on = allViewed(tests);
    btn.classList.toggle('selected', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.disabled = tests.length === 0;
    btn.querySelector('.gl-button-text').textContent = `${on ? '✓ Tests collapsed' : 'Collapse tests'} (${tests.length})`;
  };

  const createControls = () => {
    // "Your review" exists only while a review is in progress, so anchor on the actions container itself.
    // It sits in the sticky MR header, so the controls stay visible while scrolling.
    const actions = document.querySelector('.merge-request-tabs-actions');
    if (!actions) return null;
    if (!document.getElementById('tm-style')) {
      const style = document.createElement('style');
      style.id = 'tm-style';
      style.textContent = CSS;
      document.head.append(style);
    }
    const box = document.createElement('div');
    box.id = BOX_ID;
    box.innerHTML =
      '<span class="tm-bar"><span class="tm-track">' +
      '<span class="tm-seg"><span class="tm-fill"></span></span>' +
      '<span class="tm-seg tm-tests"><span class="tm-fill"></span></span>' +
      '</span><span class="tm-check" title="Everything is viewed">✓</span></span>' +
      '<button type="button" class="btn gl-button btn-default btn-md" ' +
      'title="Mark all tests/**/test*.py files as viewed (collapse) or unviewed (expand)">' +
      '<span class="gl-button-text"></span></button>';
    box.querySelector('button').addEventListener('click', () => {
      const tests = testsOf(allFiles());
      const target = !allViewed(tests);
      for (const f of tests) if (f.viewed() !== target) f.set(target);
      tick();
    });
    const review = actions.querySelector('[data-testid="review-drawer-toggle"]');
    if (review) review.before(box);
    else actions.append(box);
    return box;
  };

  const tick = () => {
    const files = allFiles();
    renderStats(files);
    const box = document.getElementById(BOX_ID) || createControls();
    if (!box) return;
    // Tabs switch without a page reload, so show the controls only while "Changes" is active.
    const onChanges = document.querySelector('.merge-request-tabs .diffs-tab.active');
    box.style.display = onChanges && files.length ? '' : 'none';
    renderBar(box.querySelector('.tm-bar'), files);
    renderButton(box.querySelector('button'), testsOf(files));
  };

  // GitLab re-renders the header and the user can change "Viewed" by hand, so re-check every second.
  tick();
  setInterval(tick, 1000);
})();
