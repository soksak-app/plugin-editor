# Core compatibility

[English](core-compatibility.md)

Editor package는 core release candidate `0.0.21`의 view manifest contract를 사용한다. `plugin.json`은 `surface.module` 없는 view composition을 선언하며, 공개 core `v0.0.20` reader는 이를 거부한다. 따라서 `package.json`은 현재 candidate를 허용하고 `0.0.20` 및 아직 검증하지 않은 이후 버전과의 호환성을 주장하지 않는 `engines.soksak: "^0.0.21"`을 선언한다. 이 contract를 포함하는 core release가 게시될 때까지 package release는 E26-1 gate에 둔다.

진단 `plugin.editor.view.content_frame` event는 공유 view-document observer가 예약한 animation frame마다 하나의 sample을 기록한다. 해당 frame 전에 root ResizeObserver delivery가 여러 번 오면 sample은 첫 delivery를 `firstResizeAtMs`, 최신 delivery를 `resizeAtMs`, 횟수를 `resizeCount`로 기록한다. `firstResizeAtMs <= resizeAtMs <= frameTimeMs`를 요구한다. Count가 1이면 첫 시각과 최신 시각이 같아야 하며, clock 해상도가 낮으면 여러 delivery의 두 시각도 같을 수 있다. Plugin은 이 source field 전체를 검증하고 그대로 전달한다. Event는 크기 관측이며 실제 화면 표시의 증거는 아니다.

`editor.diagnostics.content-trace`를 시작하면 editor view document의 `sourceClock` anchor를 반환한다. `documentTimeOriginMs`는 `performance.timeOrigin`, `sourceNowMs`는 즉시 읽은 `performance.now()`, `sourceResolutionMs`는 고정된 1 ms WebKit 정밀도 상한이다. 이 anchor는 성공한 시작에서만 반환되며 consumer가 view-document frame 시각을 native exposure 요청·응답 시각과 연결하게 한다.
