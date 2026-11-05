export const FILES = ["index.html", "return.html", "cancel.html", "store.js", "style.css", "sneaker.svg"];

/** Inject the Hollaback API origin into HTML pages. */
export function render(name, body, apiUrl) {
  return name.endsWith(".html") ? body.replaceAll("__HOLLABACK_API__", apiUrl.replace(/\/$/, "")) : body;
}
