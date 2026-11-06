# Test build

[English](test-build.md)

Test source에서 SDK package 이름을 금지하는 검사는 `scripts/build-test.mjs`가 소유한다. Test 명령은 test를 실행하기 전에 이 build를 실행한다. `test/build-test.test.mjs`는 변경하지 않은 builder를 임시 fixture에서 실행한다. 선언된 UI import는 지역 model로 연결되고, 소비자 test는 build한 UI를 import하며, 금지된 scoped/legacy SDK import와 선언되지 않은 UI 의존성은 실패한다. 각 case가 끝나면 fixture 파일과 출력을 제거한다.

`test/sources.test.mjs`의 source 규칙은 독립적인 검사를 유지한다. 직접 UI import(dynamic import 포함), resolver hook, shared module 사용과 view host의 SDK 파일 경계가 대상이다. Builder의 SDK 이름 검사는 반복하지 않는다.
