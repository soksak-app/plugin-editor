# 편집기 plugin

[English](README.md)

편집기 plugin은 프로젝트의 text 파일을 CodeMirror로 열고 files sidecar로 저장한다. 다른 plugin은 확장 지점 `editor.extension`과 `editor.formatter`로 이를 확장한다([docs/extension-points.ko.md](docs/extension-points.ko.md)). Plugin 형식은 soksak core spec(`docs/spec/plugins.md`)이 정한다.

```sh
make test                                   # test
make pack OUT=<folder> # plugin release
make hooks                                  # clone 후 한 번: commit 때 commit message와 record를 검사
```

`make check`는 `package.json`이 pin한 events kit의 census 검사와 records kit의 record 검사를 실행한다. Application은 release를 설치할 때 `plugin.json`을 검증하고, registry 검사는 release의 노출 이름을 목록에 있는 각 core의 선언과 비교한다.

Checklist는 [docs/features.md](docs/features.md)다.
