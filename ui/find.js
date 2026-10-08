// Finding and replacing text in an editor state.
import { SearchQuery } from "./vendor/libraries.js";

/** A query from the fields of the find bar. An invalid field or regular expression is an error. */
export function createQuery({ query, replacement, caseSensitive, regexp }) {
  if (typeof query !== "string") throw new TypeError("editor.find requires query as a string");
  if (typeof replacement !== "string") throw new TypeError("editor.find requires replacement as a string");
  if (typeof caseSensitive !== "boolean" || typeof regexp !== "boolean") {
    throw new TypeError("editor.find requires caseSensitive and regexp as true or false");
  }
  if (regexp && query !== "") {
    try {
      new RegExp(query, "u");
    } catch (error) {
      throw new Error(`invalid regular expression: ${error.message}`);
    }
  }
  return new SearchQuery({ search: query, replace: replacement, caseSensitive, regexp, literal: true });
}

/** The matches of query in state, in document order, as {from, to, groups}. An empty query has none. */
export function findMatches(state, query) {
  if (query.search === "") return [];
  const found = [];
  const cursor = query.getCursor(state);
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    const { from, to, match } = step.value;
    if (from === to) continue;
    found.push({ from, to, groups: match ? [...match] : null });
  }
  return found;
}

/** The text that replaces a match: $& and $1 to $99 insert the match and its groups for a regular expression. */
export function replacementOf(query, match) {
  if (!query.regexp) return query.replace;
  return query.replace.replace(/\$(\$|&|\d{1,2})/g, (whole, name) => {
    if (name === "$") return "$";
    if (name === "&") return match.groups[0];
    const index = Number(name);
    if (index >= match.groups.length) return whole;
    // default: a group that did not take part in the match inserts nothing, as String.prototype.replace does.
    return match.groups[index] ?? "";
  });
}
