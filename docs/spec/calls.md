# Calls

[한국어](calls.ko.md)

The editor page follows the call rule of core 0.0.40 (core `docs/spec/plugin-processes.md`, rule 3): a call has no time limit. It ends by its reply, by its cancel or by the end of its peer, and no timer ends it. `plugin.json` declares no `timeout` for a command, because core 0.0.40 refuses that member (`<where>: timeout is not a member of a command declaration`).

The call model of the tests, `test/models/calls.mjs`, follows the call layer of core (`packages/plugin-api/calls.js`) and replays the copy of its `calls.json`:

- A reply resolves the call, and an error reply rejects it with the message and the code of the error.
- A request with an abort signal sends `{id, cancel: true}` when the signal aborts, and the call is rejected with `cancelled`. A reply to a cancelled call is a late reply: it is reported with its delay and is not passed to the call.
- The end of the peer rejects each open call with `command <name> ended: <reason>` and reports `peer-lost` for each of them, then the open calls.
- Each change of the open calls is reported as `open-calls` with the count and the start of the oldest open call. The model starts no timer.

The page stores each report of the bridge except `open-calls` as an error of the calls: `peer-lost`, `late-reply` and the losses of a snapshot. The bridge reports no `timeout`, so the page stores none.

The filesystem port of the tests (`test/filesystem-port.mjs`) drives a separate fixture process. Each of its waits ends by the message of the fixture process that it waits for, by the end of the write to its input, or by the exit of that process, which rejects the wait with the exit and the description of the wait.

The tests wait by events, not by time and not by a number of turns. A test awaits the occurrence that it asserts, as the posted message, the reply, the report or the status that the page sends; a test that asserts an absence first awaits the occurrence that ends the handling and then asserts the absence. A wait ends only by its event. A test whose awaited event does not come ends at the runner limit of 120000 ms (`--test-timeout` of the test script), which fails that test with its name. No test sets its own time limit or settles by turns.
