# Editor plugin

[한국어](README.ko.md)

Editor plugin: opens text files of the project in CodeMirror and saves them through the files sidecar. Other plugins extend it through the extension points `editor.extension` and `editor.formatter` ([docs/extension-points.md](docs/extension-points.md)). The plugin format is defined in the soksak core specification (`docs/spec/plugins.md`).

```sh
make test                                   # tests
make pack OUT=<folder> SOK=<core>/target/debug/sok   # the plugin release
```

The checklist is [docs/features.md](docs/features.md).
