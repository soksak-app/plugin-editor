# Core compatibility

[English](core-compatibility.md)

Editor package는 core release candidate `0.0.21`의 view manifest contract를 사용한다. `plugin.json`은 `surface.module` 없는 view composition을 선언하며, 공개 core `v0.0.20` reader는 이를 거부한다. 따라서 `package.json`은 현재 candidate를 허용하고 `0.0.20` 및 아직 검증하지 않은 이후 버전과의 호환성을 주장하지 않는 `engines.soksak: "^0.0.21"`을 선언한다. 이 contract를 포함하는 core release가 게시될 때까지 package release는 E26-1 gate에 둔다.
