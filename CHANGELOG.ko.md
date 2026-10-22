# 변경 기록

[English](CHANGELOG.md)

## 미배포

- E12.1: project-relative Markdown image를 위해 files sidecar 0.0.5 이상을 요구하고, `readBytes`로 크기 제한된 MIME Blob URL을 만들며 view lifecycle에 맞춰 revoke한다.
- E12.2: 큰 문서의 Markdown test가 macrotask 한 번 대신 제한된 turn 수 안에서 갱신된 제목 decoration을 기다린다. 이 대기는 간헐적으로 실패했다.
- E12: Markdown 파일의 제목, 강조, 링크, 목록, code, 안전한 scheme의 그림을 CodeMirror decoration으로 그 자리에서 렌더링한다. `editor.markdown.toggle`은 문서를 바꾸지 않고 보기를 전환한다.
- E24.7: view page의 오류와 그 call의 손실은 어떤 surface도 서빙하지 않는 host call 대신 `runtime.log`를 통해 error 이벤트 `plugin.editor.page.error`로 저장된다.
- E24.4: view page는 core가 자기 surface로 전달하는 exposure 요청(`status.get`, `status.watch`, `command.run` 등)에 자신의 값으로 `exposureReply`를 통해 답한다.
- E24.3: view page는 host가 주입하는 시작 값 `window.sokSurface`에서 exposure의 선언을 얻고, 그것이 없는 시작 값을 거부한다.
- E24.6, E24.2: `@soksak/plugin-api`는 view 장치를 가진 core main에서 온다. core는 view의 탭 보고와 이벤트 로그를 page가 보내는 형태로 서빙하고, level gate는 main page에서 전달 시점에 적용된다.
- E24.5: 의존성의 record 검사가 census 제외를 적용한다(core F224). lockfile이 `@soksak/plugin-api`를 그것을 실은 branch commit에 고정하고, `make test`가 vendor 파일이 커밋된 채 온전히 통과한다.
- E24: 표면이 view로 옮겨진다. `plugin.json`은 composition `{kind: "view", page: "ui/index.html"}`을 선언하고, view page는 `@soksak/plugin-api/view`의 view bridge 위에서 자신의 surface 문맥을 만들며, `ui/editor.js`는 동작을 유지한다. `@soksak/plugin-api`는 core branch `feat/view-kind-F212.7`에서 오고, release는 core release를 따른다. view의 탭 보고, 이벤트 로그, 시작 값과 status 경로는 core의 경로를 기다린다(E24.2~E24.4).
- E23: 새 커밋의 작성자는 `min-0-max <max@blue.tools>`다. `.mailmap`이 이전 이름 `min-median-max`를 잇고, 게시된 커밋은 다시 쓰지 않는다.

## 0.0.4 (2026-10-19)

- E22: 메모리 절약 선언(E21)을 담은 version 0.0.4를 release한다. tag `v0.0.4`가 core v0.0.18의 `sok`로 만든 `editor-0.0.4.tgz`를 게시한다.
- E21: 표면이 `surface.unload` `{format: 1, maxBytes: 8192}`를 선언하고, `{path, selection, scroll}`을 core 탭 상태로 쓰며, mount에서 파일, cursor, scroll 위치를 restore하고, formatter가 실행되는 동안 `keep("busy")`를 잡는다. `@soksak/plugin-api`와 `CORE_RELEASE`는 core 0.0.18에서 오고 `engines.soksak`이 이를 요구한다. Red: 탭 상태 case(`actual: undefined`), 거부 case, formatter case; Green: `make test` 35 of 35 통과.

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
- F238-c-13: test는 `scripts/build-test.mjs`가 `ui/`에서 만드는 test tree에서 실행된다. UI의 SDK import는 test model(`test/models/`)로, shared module은 vendor bundle로 해석되며, test source는 SDK 패키지 이름을 담지 않는다. `test/fixtures/contract/`의 복사된 contract case를 각 model에 대해 재생한다. Green: test 96개가 통과하고 2개를 건너뛴다.
- F238-c-15: resolver hook `test/shared-modules.mjs`와 그 `--import`를 지운다. build tree가 shared module을 해석한다.
- F238-c-16: test는 shared CodeMirror module을 package specifier가 아니라 `build/test/shared/`에서 import한다.
- F238-c-17: view host는 view wire model을 설치하며 SDK 파일을 읽지 않는다.
- F238-c-23: `make test`는 plugin test만 실행한다. `make check`는 `scripts/check-plugin.mjs`(manifest, view page, 복사된 contract case, test SDK table)와 SDK tool `soksak-exposure`, `soksak-engines`, `soksak-events`, `soksak-records`를 실행한다. `make check`는 아직 green이 아니다. 설치된 release가 `contract/`를 게시하지 않으며, `resolveContributions` gap(F238-c-13.1)이 남아 있다.
- F238-c-13.4: view page는 각 sidecar 호출에 선언된 sidecar(`@soksak/sidecar-files`, `plugin.json`의 의존성 하나)를 이름으로 쓰고, view bridge model은 sidecar 이름 없는 `runtime.sidecar()` 호출을 거부한다.
- F238-c-6: `@soksak/plugin-api`를 core `main` 대신 core release tag `v0.0.20`에 고정한다. `make test`는 통과한다. `make check`는 core release가 `view.js`와 `contract/`를 게시할 때까지 이 tag에 대해 실패한다.
- F238-c-24: `ci.yml`은 `make test` 다음에 `make check`를 실행하고, `release.yml`은 pack 전에 `make test`와 `make check`를 실행한다.
