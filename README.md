# GitLab: collapse tests

A Tampermonkey userscript for GitLab merge request pages. It adds:

- a **Collapse tests** toggle button next to "Your review", shown only on the "Changes" tab. Pressed: all test files are marked "Viewed" and collapsed. Released: "Viewed" is removed and the files expand again;
- two counters next to the total file/line counter:
  - **w/o tests: N files +X −Y** — the changes without tests;
  - **to review: N files +X −Y** — the files that are not marked "Viewed" yet. It updates when you mark or unmark a file.

A test file is any `test*.py` inside a `tests/` directory at any depth (`tests/unit/test_foo.py`). `tests/conftest.py` and other helpers do not count as tests. The rule is the `TEST_FILE` constant at the top of the script.

Works in both diff views: Rapid Diffs and the classic view.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open [gitlab-collapse-tests.user.js](https://raw.githubusercontent.com/pycz2/gitlab-tests-collapse-userscript/main/gitlab-collapse-tests.user.js) and click "Install".

Tampermonkey checks for updates via `@updateURL`. Bump `@version` on every change, otherwise the update is not picked up.

## Limitations

- `@match` covers `gitlab.com` only. For a self-hosted GitLab, add your own `@match` line.
- The classic view relies on GitLab's internal Pinia stores (`legacyDiffs`, `codeReview`). If GitLab renames them, that part breaks.
