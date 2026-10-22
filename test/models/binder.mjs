// The operable elements that the audit examines (the selector of core's interactive contract).
const OPERABLE = 'button, input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"])';
const TEXT_LIMIT = 40;

// Behavior model of createBinder for the tests of the view page. It binds a control to a declared command, marks the
// control with data-command, data-params, data-value and data-live, and delegates the events of a root to the controls
// marked inside it. The conformance test replays the cases of test/fixtures/contract/create-binder.json that it covers.
// Untraced: the `when` option and the keydown dispatch. core publishes no case for them (core F248), so they are
// modeled here only as the view page needs them.

/**
 * Creates one binder over run(name, params, element), which runs a declared command and returns its result.
 * check(name) throws for an undeclared command. notify() is called once for each change of a binding.
 */
export function createBinder(run, { check = () => {}, notify = () => {} } = {}) {
  const listeners = [];

  const invoke = (command, params, element, failed) => {
    try {
      check(command);
      return run(command, params, element);
    } catch (error) {
      failed?.(error?.message ?? String(error));
      return undefined;
    }
  };

  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };

  return {
    /** Binds element to command: the event (click by default) runs the command with params, or with params(event). */
    bind(element, command, params = {}, { event = "click", when = null, failed = null } = {}) {
      check(command);
      element.setAttribute("data-command", command);
      if (typeof params !== "function") element.setAttribute("data-params", JSON.stringify(params));
      listen(element, event, (ev) => {
        if (when && !when(ev)) return;
        const values = typeof params === "function" ? params(ev) : params;
        notify();
        invoke(command, values, element, failed);
      });
      notify();
      return Promise.resolve();
    },

    /**
     * Dispatches the events of root to the controls marked inside it: a click runs the control's command; an input on a
     * field with data-live runs its command with the field value, and a change on any field with data-value runs it too.
     */
    delegate(root) {
      listen(root, "click", (ev) => {
        const control = ev.target.closest("[data-command]");
        if (!control || !root.contains(control)) return;
        notify();
        invoke(control.getAttribute("data-command"), JSON.parse(control.getAttribute("data-params") ?? "{}"), control, null);
      });
      for (const type of ["input", "change"]) {
        listen(root, type, (ev) => {
          const field = ev.target.closest("[data-value]");
          if (!field || !root.contains(field)) return;
          if (type === "input" && !field.hasAttribute("data-live")) { notify(); return; }
          notify();
          const params = JSON.parse(field.getAttribute("data-params") ?? "{}");
          invoke(field.getAttribute("data-command"), { ...params, [field.getAttribute("data-value")]: field.value }, field, null);
        });
      }
      notify();
      return Promise.resolve();
    },

    /**
     * The operable elements of root that lack a command or a dom name, as {tag, expose, command, text}. The text is the
     * aria-label, else the title, else the text content, trimmed and cut to 40 characters.
     */
    audit(root) {
      return [...root.querySelectorAll(OPERABLE)]
        .filter((element) => !(element.hasAttribute("data-command") && element.hasAttribute("data-expose")))
        .map((element) => ({
          tag: element.localName,
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

    /** Removes every listener of this binder. */
    dispose() {
      for (const remove of listeners.splice(0)) remove();
      notify();
      return Promise.resolve();
    },
  };
}
