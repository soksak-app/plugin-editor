# 변경 기록

[English](CHANGELOG.md)

## 미배포

- F239-77-editor: 일치하는 설치 diagnostic cohort로 로컬 schema-3 catalog acceptance를 완료한다. 현재 SDK가 source 9개와 pending rule 0개, event 17개를 검사하며 양쪽 host 설치본의 catalog가 source와 정확히 일치하고 application log audit을 통과한다. Public publication은 별도다.

- F252-contract-editor-1: view bridge model이
  `view.bridge.runtime-log-without-level-query`를 재생한다. Red: 제외를 해제한 뒤
  model에 `log` 단계가 없어 사례가 실패했다. Green:
  `node --test test/model-view-bridge.test.mjs`가 skip 없이 18/18 통과하며,
  runtime 동작은 바뀌지 않았다.

- F239-77-editor: Editor event catalog를 event name, level과 required/optional
  field 의미를 바꾸지 않고 schema 3 JSON Schema로 변환한다. Red: 현재 core의
  event checker가 schema 2 catalog를 거부하고 compact field 이름을 schema
  keyword로 처리했다. Green: 현재 core `events-check`가 선언 17개와 source emit을
  모두 받는다. Package test는 기존 skip 한 건을 포함해 143개 중 142개 통과하고,
  현재 core source에 대한 manifest, exposure, engines, events, records 및 contract-copy
  검사가 통과한다. Runtime acceptance는 대기 중이다.

- E29: Editor `0.0.7`은 공개 core `v0.0.20`이 `surface.module` 없는 view composition을 거부하므로 `engines.soksak` `^0.0.21`을 선언한다. Red: `test/core-version.test.mjs`가 `">=0.0.18" !== "^0.0.21"`로 실패했다. Green: 같은 test가 1/1 통과하고 candidate manifest와 copied contract 검사, candidate engines 및 events 검사가 통과한다. `make check`는 pinned SDK engines 검사에서 중단되며 pin이 `v0.0.20`이기 때문이다. 일치하는 core release가 게시될 때까지 package release를 gate에 둔다. SDK pin, plugin version, archive, registry는 바꾸지 않았다.

- E27-1: package metadata와 중복되는 package version assertion을 제거하고, manifest test는 선언한 files sidecar 범위를 검증한다.

- E27: 설치된 plugin record와 shared contribution module을 `soksak://core`에서 load한다. Red: owning view test가 `sok://core/installed-plugins.json`을 기록해 canonical URL assertion에서 실패했다. Green: 같은 test가 통과한다. bridge model은 canonical URL에서도 view wire를 설치하며, 현재 source, test, fixture URL은 canonical scheme을 사용한다. `make test`는 명시된 skip 1개를 제외한 141개 test가 통과하고, `CORE_PLUGIN_API_DIR=<core>/packages/plugin-api make check`도 통과한다. Package 0.0.6을 로컬 pack했으며 공개하지 않았다.
- E28: 허용되지 않은 전역 installed-plugin record fetch 대신 선언된 view bridge로 editor extension point를 조회한다. Red: owning view test가 `extension`, `formatter` bridge call을 관측하지 못해 실패했다. Green: 같은 test가 두 call과 전역 fetch 부재를 확인하며 `make test`, `CORE_PLUGIN_API_DIR=<core>/packages/plugin-api make check`가 통과한다. Package 0.0.7은 로컬 pack 상태이며 공개하지 않았다.

- E26: 필수 process display identity를 선언하는 files sidecar 0.0.8 이상을 요구하고 plugin version을 0.0.5로 올린다. Red: owning manifest test가 기존 `>=0.0.5` 범위에서 실패했다. Green: 새 dependency 범위와 version으로 통과한다.

- F238-c-28: view 페이지는 doctype으로 시작하고 import map을 갖지 않는다. host가 doctype 뒤에 이를 넣는다. `scripts/check-plugin.mjs`의 page 검사는 더 이상 map 복사본을 비교하지 않는다(core F212.12-1-10-6). Red: CORE_PLUGIN_API_DIR로 `make check`가 `view page has an import map`으로 실패했다. Green: `make test`가 141개 중 140개 통과와 1개 생략으로 통과하고, CORE_PLUGIN_API_DIR로 `make check`가 0으로 끝난다.
- F238-c-27: 계약 사본 `test/fixtures/contract/contributions.json`은 core main을 따른다. 사본은 probe를 `hybrid` composition과 `module`로 담고 있었고, core main은 일곱 case를 `page: ui/page.html`을 가진 `view` composition으로 게시한다. Red: CORE_PLUGIN_API_DIR로 `make check`가 계약 사본 검사에서 실패하며, 사본이 게시된 `contract/contributions.json`과 다르다고 보고했다. Green: 사본이 core main 파일과 같고, contributions model replay가 model 변경 없이 9개 중 9개를 통과하며, CORE_PLUGIN_API_DIR로 `make check`가 0으로 끝난다.
- F212.12-1-10-2: view 페이지 map이 core view import map의 screen-hash 항목을 가진다. `checkViewPage`가 이 항목을 요구한다. 시험은 다섯 항목을 단언한다. Red: `the view page carries the import map of the view and the page script` 시험이 `actual: 4, expected: 5`로 실패했고, CORE_PLUGIN_API_DIR 검사가 같은 누락 항목으로 실패했다. Green: `make test`가 141개 중 140개 통과와 1개 생략으로 통과하고, `make check`의 view page 검사가 통과한다. `make check`의 다음 검사는 fixture `test/fixtures/contract/contributions.json`이 core의 게시된 contract와 달라 실패하며, 이는 이 변경 밖이다.
- F238-c-25: pre-push 훅이 `make push-check`를 실행한다. 이것은 ci workflow와 같이 `make test`, `make check`, push 범위의 commit message 검사를 실행한다. Red: push-check header test와 pre-push 훅 test가 실패했고, `.githooks/pre-push`는 없었다. Green: `test/makefile.test.mjs`가 4개 중 4개를 통과한다. `make check`는 고정 SDK에서 실패하며 이것은 F238-c-26이 기록한다.
- F252-contract-editor: 복사한 계약 파일을 core origin/main에 맞췄다(`create-binder.json`, `expose.json`, `view-commands.json`이 바뀌었다). replay model은 새 함수 매개변수 bind와 command cids를 포괄하며, 노출 replay에 `inspect` 단계가 추가되었다.
- F252-editor: 읽기 전용 파일의 저장 거부와 연결된 서식 도구가 없는 서식 실행 거부는 텍스트를 tab 오류로 표시하고 호출자에게 던진다. 잘못된 정규식은 찾기 막대에 메시지를 표시하고 `plugin.editor.find.invalid`로 기록한다. tab이 끝나거나 대체된 뒤의 Markdown 이미지 실패는 `plugin.editor.markdown.image`로 기록한다. 메시지가 없는 던져진 값은 텍스트로 표시한다. 거부된 `runtime.log` 기록은 `runtime.error {where: "log"}`로 표시하고 콘솔에도 남긴다.
- F238-b-10-2: `test/test-script.test.mjs`는 test 명령이 `test/` 아래의 모든 test 파일을 선택함을 고정하므로, 이후의 test 하위 디렉터리가 빠질 수 없다. `make test`는 130개를 실행한다(이전 129개).
- F238-b-10-1: core view bridge 계약 사본을 현재 core 사례 집합으로 새로 고쳤다. `view.bridge.runtime-log-without-level-query`가 `view.bridge.runtime-log-level-gate`를 대신하며, view는 level 질의를 부르지 않는다. 이 저장소에서는 model test(`test/model-view-bridge.test.mjs`)가 새 id로 사례를 미포괄 목록에 적고, `test/models/view-bridge.mjs`의 주석이 이를 가리킨다.
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
- F238-c-13.1, F238-c-13.2, F238-c-13.3: model은 공개된 contributions, binder keydown, view event case를 재생한다. bridge는 구독 전에 도착한 event를 버리며, page는 초기 theme을 `window.sokTheme`에서 읽는다. `CORE_PLUGIN_API_DIR`을 core main으로 지정하면 `make check`가 통과한다.
- F238-c-23.1: `scripts/check-plugin.mjs`는 `CORE_PLUGIN_API_DIR`에서 SDK를 읽는다.
- F238-c-13.5: view page의 exposure port에는 unregister가 없다. view channel이 registration의 제거를 게시하지 않기 때문이다. dispose는 로컬 listener, binding, 선언만 끝내며, model은 복사한 dispose case를 재생한다.
- F238-c-13.6: page의 call은 core calls.json의 10000ms 제한과 late-reply 보고를 지킨다. model은 case 4개를 fake clock에서 재생한다.
- E14: view page는 view에 input chain이 없으므로 sidecar send마다 명시적인 빈 correlation identifier 목록을 보낸다. `open`, `save`, `watch.start`, `watch.change` trace 이벤트는 이미 선언되고 테스트되어 있었다.
