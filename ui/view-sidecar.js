// The sidecar of the editor view page: the one dependency that plugin.json declares. The view calls runtime.sidecar.send,
// runtime.sidecar.on and runtime.sidecar.onFailure name it (core docs/spec/native-surfaces.md#view-surfaces, view calls).
export const SIDECAR = "@soksak/sidecar-files";
