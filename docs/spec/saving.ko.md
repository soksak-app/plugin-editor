# 저장

[English](saving.md)

저장에 성공하면 그 write로 보낸 문서를 저장된 문서로 기록한다. 응답을 기다리는 동안 편집한 내용은 editor에 남고 수정 상태를 유지하며, 빈 문서의 첫 저장도 같다. 다음 저장은 그 편집 내용을 쓰며 현재 문서가 해당 write와 같을 때만 수정 상태를 해제한다. write가 돌려준 version은 다음 일반 저장이 쓰는 version이다. 충돌 감지, 명시적 덮어쓰기와 원래 줄바꿈도 이 계약에 포함된다.

Editor는 이 상태를 `editor.document`와 `context.tab.modified`로 보고하며, 후자는 host의 닫기 판단이 사용하는 소비자 계약이다. Editor test는 선언된 tab interface와 통제된 files 응답을 쓰며 host 구현을 읽지 않는다. 닫기 판단의 test는 host가 소유한다. 이 test는 native application의 데이터 손실을 재현했다고 주장하지 않는다.
