# Call

[English](calls.md)

editor page 는 core 0.0.40 의 call 규칙(core `docs/spec/plugin-processes.md`, rule 3)을 따른다. call 에는 시간 한도가 없다. call 은 답, cancel, 상대의 끝으로 끝나며, 어떤 timer 도 call 을 끝내지 않는다. core 0.0.40 은 command 선언의 `timeout` member 를 거부하므로(`<where>: timeout is not a member of a command declaration`) `plugin.json` 은 command 의 `timeout` 을 선언하지 않는다.

test 의 call model `test/models/calls.mjs` 는 core 의 call layer(`packages/plugin-api/calls.js`)를 따르고 그 `calls.json` copy 를 재생한다.

- 답은 call 을 resolve 하고, error 답은 그 error 의 message 와 code 로 call 을 reject 한다.
- abort signal 이 있는 request 는 signal 이 abort 될 때 `{id, cancel: true}` 를 보내고, call 은 `cancelled` 로 reject 된다. cancel 된 call 에 온 답은 late reply 다. 그 지연과 함께 알려지고 call 에 전달되지 않는다.
- 상대의 끝은 열린 call 마다 `command <name> ended: <reason>` 으로 reject 하고, 각각에 `peer-lost` 를 알린 뒤 열린 call 을 알린다.
- 열린 call 이 바뀔 때마다 그 수와 가장 오래된 열린 call 의 시작을 `open-calls` 로 알린다. model 은 timer 를 시작하지 않는다.

page 는 bridge 의 report 중 `open-calls` 를 뺀 것을 call 의 오류로 저장한다. `peer-lost`, `late-reply`, snapshot 의 손실이다. bridge 는 `timeout` 을 알리지 않으므로 page 는 그것을 저장하지 않는다.

test 의 filesystem port(`test/filesystem-port.mjs`)는 별도의 fixture process 를 움직인다. 그 각 대기는 기다리는 fixture process 의 message, 그 입력으로의 write 의 끝, 또는 그 process 의 exit 로 끝난다. exit 는 exit 와 대기의 설명으로 대기를 reject 한다.

test 는 시간이나 정해진 턴 수가 아니라 event 로 기다린다. test 는 자기가 확인하는 일, 즉 page 가 보내는 posted message, 답, report, status 를 기다린다. 없음을 확인하는 test 는 처리를 끝내는 일을 먼저 기다린 뒤 없음을 확인한다. 대기는 그 event 로만 끝난다. 기다리는 event 가 오지 않는 test 는 runner 의 한도 120000 ms(test script 의 `--test-timeout`)에서 끝나며, 그 한도는 그 test 를 이름과 함께 실패시킨다. 어떤 test 도 자기 시간 한도를 두거나 턴 수로 settle 하지 않는다.
