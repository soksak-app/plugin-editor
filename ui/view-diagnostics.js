// Loads the diagnostic declaration from the installed editor package. A release build stages no declaration or module.
export async function loadDiagnostics(pageHref = window.location.href) {
  let response;
  try {
    response = await fetch(new URL("../diagnostics.json", pageHref).href);
  } catch (error) {
    throw new Error(`the diagnostics declaration of the editor view cannot be read: ${error?.message ?? error}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`the diagnostics declaration of the editor view answered ${response.status}`);
  const declaration = await response.json();
  return { declaration, attach: (await import("./editor-diagnostics.js")).attach };
}
