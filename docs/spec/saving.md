# Saving

[한국어](saving.ko.md)

A successful save records the document sent in that write as the saved document. Edits made while the reply is pending remain in the editor and remain modified, including the first save of a blank document. A later save writes those edits and clears the modified state only if the document still equals that write. The version returned by the write is the version used by the next ordinary save. Conflict detection, explicit overwrite, and the original line breaks remain part of this contract.

The editor reports this state through `editor.document` and `context.tab.modified`; the latter is the consumer contract used by the host's close decision. Editor tests use the declared tab interface and controlled files replies, and do not read the host implementation. The host owns the test of its close decision. These tests do not claim native application data loss was reproduced.
