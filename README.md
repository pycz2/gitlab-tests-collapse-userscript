# GitLab: collapse tests

Userscript для Tampermonkey. На странице merge request в GitLab он добавляет:

- кнопку **Collapse tests** рядом с «Your review». Нажата — все тестовые файлы отмечены «Viewed» и свёрнуты. Отжата — «Viewed» снят, файлы развёрнуты;
- счётчик **w/o tests: N files +X −Y** рядом с общим счётчиком файлов и строк — изменения без тестов.

Тестовый файл — это `test*.py` в папке `tests/` на любом уровне вложенности (`tests/unit/test_foo.py`). `tests/conftest.py` и хелперы тестами не считаются. Правило задаёт константа `TEST_FILE` в начале скрипта.

Работает в обоих видах diffs: Rapid Diffs и классическом.

## Установка

1. Поставьте [Tampermonkey](https://www.tampermonkey.net/) в браузер.
2. Откройте [gitlab-collapse-tests.user.js](https://raw.githubusercontent.com/pycz2/gitlab-tests-collapse-userscript/main/gitlab-collapse-tests.user.js) и нажмите «Install».

Tampermonkey сам проверяет обновления по `@updateURL`. Чтобы обновление дошло, поднимайте `@version` при каждом изменении.

## Ограничения

- `@match` настроен только на `gitlab.com`. Для self-hosted GitLab добавьте свою строку `@match`.
- Классический вид использует внутренние Pinia store GitLab (`legacyDiffs`, `codeReview`). Если GitLab их переименует, эта часть сломается.
