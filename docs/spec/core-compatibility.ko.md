# Core compatibility

[English](core-compatibility.md)

Editor package는 `engines.soksak: "^0.0.36"`를 선언한다. 이 범위는 core version-range 규칙에 따라 core release `0.0.36`를 허용하고, 이전 version 및 검증하지 않은 이후 version과의 호환성을 주장하지 않는다. 0.0.35는 `plugin.json`이 선언하는 `exposes.element`를 받는 첫 core release인 F502-13의 core release의 version이고, core 0.0.34는 그것을 거부한다. `plugin.json`은 `surface.module` 없는 view composition도 선언하며, core release `0.0.24`부터 이를 받는다.

진단 `plugin.editor.view.content_frame` event는 공유 view-document observer가 예약한 animation frame마다 하나의 sample을 기록한다. 해당 frame 전에 root ResizeObserver delivery가 여러 번 오면 sample은 첫 delivery를 `firstResizeAtMs`, 최신 delivery를 `resizeAtMs`, 횟수를 `resizeCount`로 기록한다. `firstResizeAtMs <= resizeAtMs <= frameTimeMs`를 요구한다. Count가 1이면 첫 시각과 최신 시각이 같아야 하며, clock 해상도가 낮으면 여러 delivery의 두 시각도 같을 수 있다. Plugin은 이 source field 전체를 검증하고 그대로 전달한다. Event는 크기 관측이며 실제 화면 표시의 증거는 아니다.

`editor.diagnostics.content-trace`를 시작하면 editor view document의 `sourceClock` anchor를 반환한다. `documentTimeOriginMs`는 `performance.timeOrigin`, `sourceNowMs`는 즉시 읽은 `performance.now()`, `sourceResolutionMs`는 고정된 1 ms WebKit 정밀도 상한이다. 이 anchor는 성공한 시작에서만 반환되며 consumer가 view-document frame 시각을 native exposure 요청·응답 시각과 연결하게 한다.

성공한 시작 응답은 기존 `--card` paint marker에 사용하는 RGB 정수 배열인 `markerColor`도 반환한다. Consumer는 Editor 내부 구현 세부에서 색을 추정하지 않고 이 선언된 색으로 캡처 pixel을 분류한다. Read와 stop 응답에는 이 field를 추가하지 않는다.
