# View 측정

[English](view-measurement.md)

View benchmark `e2e/benchmark/editor-view.test.mjs`는 editor view 를 core 의 pass value(core `docs/spec/plugin-processes.md#pass-values`)로
판정한다. Pass value (iii)은 process 가 이미 실행 중인 view 의 첫 표시를 plugin 과 host 의 DOM mount baseline 에 300 ms 를 더한 값으로 제한하고, (iii-b)는 새 process 의
첫 표시를 같은 합으로 제한한다. 기록된 baseline 이 없는 plugin 은 300 ms 만으로 판정한다. 이 문서는 plugin 이 소유하는 editor view 의 baseline 을 기록한다.

## DOM mount baseline

Baseline 은 core 가 workbench page 의 editor surface mount 를 제거하기 전에 Wails 와 Tauri host 에서 잰, mount 시작부터 끝까지 시간의 중앙값이다. 이 기록이 고정된 기준이다.
mygo host 의 baseline 은 둘 중 낮은 값이다.

| Host | DOM mount baseline |
| --- | --- |
| wailsv3 | 13 ms |
| tauriv2 | 35 ms |
| mygo | 13 ms, wailsv3 와 tauriv2 중 낮은 값 |

`e2e/benchmark/editor-view.test.mjs`의 `baselinesMs`가 기록된 값을 담고, `@soksak/window-check/view-metrics.mjs`의 `domMountBaselineMs`가 각 host 의
baseline 을 준다.
