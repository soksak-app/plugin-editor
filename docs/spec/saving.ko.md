# 저장

[English](saving.md)

저장에 성공하면 그 write로 보낸 문서를 저장된 문서로 기록한다. 응답을 기다리는 동안 편집한 내용은 editor에 남고 수정 상태를 유지하며, 빈 문서의 첫 저장도 같다. 다음 저장은 그 편집 내용을 쓰며 현재 문서가 해당 write와 같을 때만 수정 상태를 해제한다. write가 돌려준 version은 다음 일반 저장이 쓰는 version이다. 충돌 감지, 명시적 덮어쓰기와 원래 줄바꿈도 이 계약에 포함된다.

Editor는 이 상태를 `editor.document`와 `context.tab.modified`로 보고하며, 후자는 host의 닫기 판단이 사용하는 소비자 계약이다. Editor test는 선언된 tab interface와 통제된 files 응답을 쓰며 host 구현을 읽지 않는다. 닫기 판단의 test는 host가 소유한다. 이 test는 native application의 데이터 손실을 재현했다고 주장하지 않는다.

다른 변경이나 save와 겹친 watch read는 오래된 snapshot을 적용하기 전에 현재 파일을 다시 읽어야 한다. 지연된 save 응답은 더 최근에 관찰한 disk version과 충돌 표시를 보존하며, 명시적 덮어쓰기는 그 관찰한 version을 쓴다. Editor를 dispose하면 대기 중인 파일 요청을 취소하고 구독을 제거하며, 뒤늦은 save, watch, 저장 위치 응답이 tab을 갱신하거나 새 작업을 시작하지 못하게 한다. 요청과 명령의 실패는 계속 기록하지만 dispose한 tab에 새 오류를 표시하지 않는다.

뒤에 완료한 save와 명시적 reload도 이전 응답보다 우선한다. Disk 관찰, load한 문서와 완료한 save를 별도로 추적한다. Disk 관찰은 문서를 교체하지 않고 충돌을 보여줄 수 있지만, load한 문서는 이전 save 기준을 이어받으면 안 되기 때문이다. 통제된 case는 파일 operation의 효과가 발생한 뒤 응답을 지연한다. 응답의 교차 순서를 검증하며, 동시에 진행하는 native 파일 write나 가능한 모든 순서를 검증하지는 않는다. 대체된 reload는 `a newer file operation superseded the reload`로 거부되며, 명령 실패를 기록하지만 더 최신 operation의 tab 오류를 바꾸지 않는다. 대체된 첫 저장은 write를 시작하거나 재시도하기 전에 `a newer save superseded the first save`로 거부된다. 이미 완료한 write는 자기 version을 돌려주지만 오래된 응답이 현재 저장 기준을 바꾸지는 않는다. Contribution 결과는 읽어 온 대상 file identity에만 적용된다. 문서가 열리기 전에 받은 event는 초기화 뒤 새로 읽도록 보존된다. 저장된 disk version을 확인한 watch는 지역 편집을 보존하면서 충돌 표시를 해제한다.

Filesystem 통합 경계는 임시 project 파일, 실제 운영체제 파일 알림과 선언된 files 요청/응답 일부만 구현하는 별도 process를 쓴다. Editor의 공개 command, status, tab 보고로 저장, 실제 write를 멈춘 동안의 편집, 외부 변경 충돌/reload, 오래된 read 순서와 cleanup을 확인한다. Editor 변이 검사 중 fixture는 정상으로 유지한다. 이전 저장 기준 동작을 되살리거나 오래된 read 보호를 제거하면 같은 통합 assertion이 실패해야 한다. 이 경계는 통제된 응답 test를 보완하며 다른 package의 구현을 import하거나 시험하지 않는다.

통합 fixture는 text `read`, `readBytes`, version을 확인하는 in-place `write`, file `watch`와 `closed` JSONL message를 지원한다. Descriptor를 닫고 파일을 독립적으로 다시 읽어 확인한 뒤에만 write 성공을 응답한다. Native 알림은 반복될 수 있으며 소비자는 실제 bytes를 다시 읽는다. IPC 순서 제어는 실제 write의 첫 byte 전에 멈추며 성공 응답을 꾸며내지 않는다. 보류한 read는 원래 snapshot을 유지하고, 보류한 알림도 운영체제 event를 유지하면서 전달만 지연한다. Fixture는 directory/tree/git operation, metadata/link 동작이나 부분 write 실패를 다루지 않는다. Editor dispose는 요청 거부와 구독 해제를 소유하고, host 측 close는 close envelope, watcher/process 종료와 임시 directory 삭제를 소유한다. `node scripts/test-filesystem-mutations.mjs`는 정상 baseline과 격리한 editor 변이를 검사하며, 의도적으로 실패시킨 test도 지정된 동작 assertion과 성공한 cleanup을 요구한다. Loader, build, 취소나 timeout 실패는 변이 검출 증거로 인정하지 않는다.

Fixture process가 예기치 않게 끝나면 host adapter는 기록한 종료 원인으로 close를 거부하고 남은 모든 close 대기를 취소하며 임시 directory도 삭제한다. Fixture 소유 fault test가 이 정리 경로를 editor 변이 증거와 별도로 검증한다.

Shared editor 소비자 host는 plugin manifest의 `exposes.element` 선언에 따라 노출 element를 `exposure.element`로 등록한다. Filesystem 통합 test와 응답을 통제하는 test가 이 host를 함께 쓰므로 현재 exposure 계약에 함께 연결되어 실행된다.
