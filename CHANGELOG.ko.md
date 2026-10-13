# 변경 기록

[English](CHANGELOG.md)

## 0.0.3 (2026-10-14)

- E18: 이벤트 계약(E15)과 빈 문서(E16)를 담은 version 0.0.3을 release한다. tag `v0.0.3`가 `editor-0.0.3.tgz`를 게시한다.
- E20: `@soksak/plugin-api`를 core release 0.0.12에서 받고, `engines.soksak`은 `>=0.0.12`이며, release workflow가 `CORE_RELEASE: v0.0.12`에서 `sok`를 build한다.
- E19: `make hooks`가 `.githooks`를 hook 폴더로 정해, commit message의 형식이나 용어 규칙, record 규칙을 어긴 commit이 만들어질 때 거부된다.
- E16.1: `params.path` 없는 tab은 빈 문서를 열고, 그 첫 저장은 `core.file.place`로 파일을 물은 뒤 그 파일을 쓰고 감시한다.
- E17: `make test`가 record 검사 `soksak-records`를 실행하고, CI가 push된 각 commit message의 형식을 `soksak-commits`로 검사한다.
- E15.4: `@soksak/plugin-api`를 core release 0.0.11에서 받고, `engines.soksak`은 `>=0.0.11`이며, `plugin.json`이 event 카탈로그 `events.json`을 가리킨다.
- E15.6, E15.5: plugin event는 level이 저장될 때만 비싼 field를 만들고, plugin에는 `cids`를 가진 입력이 없다.
- E15: 전달자 `ui/events.js`가 넘기는 event 이름에 `events: forwarded`를 표시하므로, core의 catalog 검사가 `emitEvent` 호출에서 이름을 읽는다.
- E15: plugin이 event 카탈로그 `events.json`을 선언하고, 열기, 읽기, 저장, watch, 디스크 판단, 서식, 실패한 기여, 닫기, files sidecar에 대한 모든 요청, 모든 명령의 결과를 `context.runtime.log`로 event에 남긴다. `make test`가 `soksak-events`를 실행한다. 테스트: `test/events.test.mjs`(3)와 `test/editor.test.mjs`의 event case 9개이며 `pnpm test`가 26개 case를 통과한다. `plugin.json`의 member `events`와 `pnpm exec`를 통한 검사 실행은 E15.4의 core release를 기다린다.
- E13: 문서와 주석이 plugin, sidecar, release를 그 말로 부른다.
