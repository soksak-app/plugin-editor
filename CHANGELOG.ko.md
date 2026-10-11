# 변경 기록

[English](CHANGELOG.md)

## 미배포

- E15: 전달자 `ui/events.js`가 넘기는 event 이름에 `events: forwarded`를 표시하므로, core의 catalog 검사가 `emitEvent` 호출에서 이름을 읽는다.
- E15: plugin이 event 카탈로그 `events.json`을 선언하고, 열기, 읽기, 저장, watch, 디스크 판단, 서식, 실패한 기여, 닫기, files sidecar에 대한 모든 요청, 모든 명령의 결과를 `context.runtime.log`로 event에 남긴다. `make test`가 `soksak-events`를 실행한다. 테스트: `test/events.test.mjs`(3)와 `test/editor.test.mjs`의 event case 9개이며 `pnpm test`가 26개 case를 통과한다. `plugin.json`의 member `events`와 `pnpm exec`를 통한 검사 실행은 E15.4의 core release를 기다린다.
- E13: 문서와 주석이 plugin, sidecar, release를 그 말로 부른다.
