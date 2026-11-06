# 저장

[English](saving.md)

저장에 성공하면 그 write로 보낸 문서를 저장된 문서로 기록한다. 응답을 기다리는 동안 편집한 내용은 editor에 남고 수정 상태를 유지하며, 빈 문서의 첫 저장도 같다. 다음 저장은 그 편집 내용을 쓰며 현재 문서가 해당 write와 같을 때만 수정 상태를 해제한다. write가 돌려준 version은 다음 일반 저장이 쓰는 version이다. 충돌 감지, 명시적 덮어쓰기와 원래 줄바꿈도 이 계약에 포함된다.

Editor는 이 상태를 `editor.document`와 `context.tab.modified`로 보고하며, 후자는 host의 닫기 판단이 사용하는 소비자 계약이다. Editor test는 선언된 tab interface와 통제된 files 응답을 쓰며 host 구현을 읽지 않는다. 닫기 판단의 test는 host가 소유한다. 이 test는 native application의 데이터 손실을 재현했다고 주장하지 않는다.

다른 변경이나 save와 겹친 watch read는 오래된 snapshot을 적용하기 전에 현재 파일을 다시 읽어야 한다. 지연된 save 응답은 더 최근에 관찰한 disk version과 충돌 표시를 보존하며, 명시적 덮어쓰기는 그 관찰한 version을 쓴다. Editor를 dispose하면 대기 중인 파일 요청을 취소하고 구독을 제거하며, 뒤늦은 save, watch, 저장 위치 응답이 tab을 갱신하거나 새 작업을 시작하지 못하게 한다. 요청과 명령의 실패는 계속 기록하지만 dispose한 tab에 새 오류를 표시하지 않는다.

뒤에 완료한 save와 명시적 reload도 이전 응답보다 우선한다. Disk 관찰, load한 문서와 완료한 save를 별도로 추적한다. Disk 관찰은 문서를 교체하지 않고 충돌을 보여줄 수 있지만, load한 문서는 이전 save 기준을 이어받으면 안 되기 때문이다. 통제된 case는 파일 operation의 효과가 발생한 뒤 응답을 지연한다. 응답의 교차 순서를 검증하며, 동시에 진행하는 native 파일 write나 가능한 모든 순서를 검증하지는 않는다. 대체된 reload는 `a newer file operation superseded the reload`로 거부되며, 명령 실패를 기록하지만 더 최신 operation의 tab 오류를 바꾸지 않는다. 대체된 첫 저장은 write를 시작하거나 재시도하기 전에 `a newer save superseded the first save`로 거부된다. 이미 완료한 write는 자기 version을 돌려주지만 오래된 응답이 현재 저장 기준을 바꾸지는 않는다. Contribution 결과는 읽어 온 대상 file identity에만 적용된다. 문서가 열리기 전에 받은 event는 초기화 뒤 새로 읽도록 보존된다. 저장된 disk version을 확인한 watch는 지역 편집을 보존하면서 충돌 표시를 해제한다.
