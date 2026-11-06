// Behavior model of createBinder for the tests of the view page. It binds a control to a declared command, marks the
// control with data-command, data-params, data-value and data-live, and delegates the events of a root to the controls
// marked inside it. The conformance test replays the cases of test/fixtures/contract/create-binder.json.
//
// A change notification (notify) is sent for each event that a bound control or a delegated root receives, whether or not a
// command runs, as the cases of create-binder.json show. The `when` option is a predicate or an object whose fields the
// event must carry. After dispose, the listeners stay attached and report changes, but no command runs (create-binder.json,
// binder.delegate.dispatches-declared-controls).

/** The DOM events that a bound control reports as changes. */
const OBSERVED = ["click", "keydown", "input", "change"];

/** Whether the event passes the when option: a predicate, an object of expected fields, or no option. */
function matches(when, event) {
  if (when === null || when === undefined) return true;
  if (typeof when === "function") return Boolean(when(event));
  return Object.entries(when).every(([key, value]) => event[key] === value);
}

/**
 * Creates one binder over run(name, params, element), which runs a declared command and returns its result.
 * check(name) throws for an undeclared command. notify() is called once for each change of a binding.
 */
export function createBinder(run, { check = () => {}, notify = () => {} } = {}) {
  let disposed = false;

  const invoke = (command, params, element, failed) => {
    try {
      check(command);
      return run(command, params, element);
    } catch (error) {
      failed?.(error?.message ?? String(error));
      return undefined;
    }
  };

  const listen = (target, type, handler) => target.addEventListener(type, handler);

  return {
    /** Binds element to command: the event (click by default) runs the command with params, or with params(event). */
    bind(element, command, params, { event = "click", when = null, failed = null } = {}) {
      check(command);
      element.setAttribute("data-command", command);
      if (params !== undefined && typeof params !== "function") element.setAttribute("data-params", JSON.stringify(params));
      for (const type of new Set([...OBSERVED, event])) {
        listen(element, type, (ev) => {
          notify();
          if (disposed || type !== event || !matches(when, ev)) return;
          const values = typeof params === "function" ? params(ev) : params ?? {};
          invoke(command, values, element, failed);
        });
      }
      notify();
      return Promise.resolve();
    },

    /**
     * Dispatches the events of root to the controls marked inside it: a click runs the control's command; an input on a
     * field with data-live runs its command with the field value, and a change on any field with data-value runs it too.
     */
    delegate(root) {
      for (const type of ["click", "input", "change"]) {
        listen(root, type, (ev) => {
          notify();
          if (disposed) return;
          if (type === "click") {
            const control = ev.target.closest("[data-command]");
            if (!control || !root.contains(control)) return;
            invoke(control.getAttribute("data-command"), JSON.parse(control.getAttribute("data-params") ?? "{}"), control, null);
            return;
          }
          const field = ev.target.closest("[data-value]");
          if (!field || !root.contains(field)) return;
          if (type === "input" && !field.hasAttribute("data-live")) return;
          const params = JSON.parse(field.getAttribute("data-params") ?? "{}");
          invoke(field.getAttribute("data-command"), { ...params, [field.getAttribute("data-value")]: field.value }, field, null);
        });
      }
      notify();
      return Promise.resolve();
    },

    /**
     * The operable elements of root that lack a command or an element name, as {role, expose, command, text}. The role is the
     * ARIA role of the element (roleOf). The text is the aria-label, else the title, else the text content, trimmed and cut to
     * 40 characters.
     */
    audit(root) {
      return [...root.querySelectorAll(INTERACTIVE)]
        .filter((element) => !(element.hasAttribute("data-command") && element.hasAttribute("data-expose")))
        .map((element) => ({
          role: roleOf(element),
          expose: element.getAttribute("data-expose"),
          command: element.getAttribute("data-command"),
          text: (element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent).trim().slice(0, TEXT_LIMIT),
        }));
    },

    /** Runs a declared command directly. */
    run(command, params = {}) {
      check(command);
      return Promise.resolve(run(command, params, null));
    },

    /** Stops the commands of this binder; the listeners stay attached. */
    dispose() {
      disposed = true;
      notify();
      return Promise.resolve();
    },
  };
}

/** The selector of the operable elements that the audit examines (core binder.js#INTERACTIVE). */
export const INTERACTIVE = 'button, input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"])';
const TEXT_LIMIT = 40;

// The implicit ARIA role of an input of each type (HTML-AAM); a type that HTML-AAM maps to no role has none.
const INPUT_ROLES = {
  button: "button", image: "button", reset: "button", submit: "button", checkbox: "checkbox", radio: "radio", range: "slider",
  number: "spinbutton", search: "searchbox", email: "textbox", tel: "textbox", text: "textbox", url: "textbox",
};
// The implicit ARIA role of a tag that needs no attribute to have it (HTML-AAM), for the roles that element.rect reports.
const TAG_ROLES = Object.freeze({
  article: "article", dialog: "dialog", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", hr: "separator",
  img: "img", li: "listitem", meter: "meter", nav: "navigation", ol: "list", progress: "progressbar", search: "search", table: "table", td: "cell",
  th: "columnheader", tr: "row", ul: "list",
});
// The input types whose implicit role is combobox when the input names a list of suggestions (HTML-AAM).
const LIST_INPUTS = new Set(["email", "search", "tel", "text", "url"]);

/**
 * The ARIA role of an element, as the audit rows of core's interactive contract and element.rect of its expose contract report
 * it: the first token of its role attribute, else the implicit role of its tag and input type, else textbox for an editable
 * element, else null. A group only groups, so its role is null.
 */
export function roleOf(element) {
  const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return explicit === "group" ? null : explicit;
  const tag = element.localName;
  if (Object.hasOwn(TAG_ROLES, tag)) return TAG_ROLES[tag];
  if (tag === "a") return element.hasAttribute("href") ? "link" : null;
  if (tag === "button") return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return element.multiple || element.size > 1 ? "listbox" : "combobox";
  if (tag === "input") {
    if (element.hasAttribute("list") && LIST_INPUTS.has(element.type)) return "combobox";
    return Object.hasOwn(INPUT_ROLES, element.type) ? INPUT_ROLES[element.type] : null;
  }
  if (element.matches('[contenteditable]:not([contenteditable="false"])')) return "textbox";
  return null;
}
