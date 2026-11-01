# Editor plugin

[한국어](README.ko.md)

Editor plugin: opens text files of the project in CodeMirror and saves them through the files sidecar. Other plugins extend it through the extension points `editor.extension` and `editor.formatter` ([docs/extension-points.md](docs/extension-points.md)). The plugin format is defined in the soksak core specification (`docs/spec/plugins.md`).

```sh
make test                                   # tests
make pack OUT=<folder> # the plugin release
make hooks                                  # once after cloning: check commit messages and records at commit time
```

`make check` runs the census check of the events kit and the record check of the records kit that `package.json` pins. The application validates `plugin.json` when it installs the release, and the registry check compares the exposed names of the release with the declarations of each listed core.

The checklist is [docs/features.md](docs/features.md).
