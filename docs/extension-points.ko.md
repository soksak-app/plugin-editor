# 확장 지점

[English](extension-points.md)

편집기는 `plugin.json`에 확장 지점 두 개를 선언한다(core `docs/spec/plugins.md#extension-points`). 기여자는 `contributes`에 `range`, `module`, 선택 필드 `extensions`(점 없는 소문자 파일 이름 확장자 목록)를 가진 항목을 선언한다. `extensions`가 없는 항목은 모든 파일에 적용된다. 편집기는 탭이 열릴 때 연결된 각 항목의 module을 import하며, module을 불러오지 못하거나 export가 없거나 만드는 중 예외를 던진 항목은 `core.contributions`로 `invalid`를 보고한다.

## editor.extension 1.0.0

module은 `extension(file)`을 export한다. `file`은 `{path, extension, language}`로, project root 기준 경로, 소문자 이름 확장자 또는 `""`, 편집기가 정한 파일의 언어 또는 `null`이다. 이 함수는 CodeMirror extension을 반환하고, 편집기는 그것을 그 파일의 편집기에 더한다. 언어 지원, decoration, key binding, theme이 그런 extension이다.

이 지점은 편집기의 CodeMirror package를 공유한다: `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@lezer/common`, `@lezer/highlight`, `@lezer/lr`, `@marijn/find-cluster-break`, `crelt`, `style-mod`, `w3c-keyname`. 기여자는 각각을 `@soksak/shared/editor.extension/<package>`로 import하고 그 external import로 bundle하므로, 기여자와 편집기는 instance 하나를 쓴다. 다른 package는 기여자가 직접 bundle하며, 기여자가 bundle하는 언어 package도 공유 package를 같은 방법으로 import한다.

| 지점 version | Package |
| --- | --- |
| 1.0.0 | `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.14, `@codemirror/language` 6.13.1, `@codemirror/commands` 6.11.1, `@lezer/common` 1.5.3, `@lezer/highlight` 1.2.5, `@lezer/lr` 1.4.11, `@marijn/find-cluster-break` 1.0.4, `crelt` 1.0.7, `style-mod` 4.1.4, `w3c-keyname` 2.2.8 |

지점의 version은 공유 package를 따른다. 공유 package의 minor version은 minor 부분을, major version은 major 부분을 올린다.

## editor.formatter 1.0.0

module은 `format(text, file)`을 export하고(`file`은 위와 같다), 서식을 맞춘 text나 그 promise를 반환한다. `editor.format`은 `extensions`에 파일의 이름 확장자가 있거나 `extensions`가 없는 첫 연결 formatter를 실행하고, text를 그 결과로 한 번의 편집으로 바꾼다. 예외를 던지거나 text가 아닌 값을 반환한 formatter는 명령을 실패시키고, 명령은 그 실패를 탭의 오류로 보인다.
