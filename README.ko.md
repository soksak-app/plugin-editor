# 편집기 plugin

[English](README.md)

편집기 plugin은 프로젝트의 text 파일을 CodeMirror로 열고 files sidecar로 저장한다. 다른 plugin은 확장 지점 `editor.extension`과 `editor.formatter`로 이를 확장한다([docs/extension-points.ko.md](docs/extension-points.ko.md)). Plugin 형식은 soksak core spec(`docs/spec/plugins.md`)이 정한다.

```sh
make test                                   # test
make pack OUT=<folder> SOK=<core>/target/debug/sok   # plugin release
```

Checklist는 [docs/features.md](docs/features.md)다.
