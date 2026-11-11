export type Child = Node | string | false | null | undefined;
type Attrs = Record<
  string,
  string | number | boolean | null | undefined | ((event: Event) => void)
>;

/**
 * A tiny helper to build DOM elements: h('button', { class: 'x', onclick: fn }, 'Label').
 *
 * SECURITY: text is only ever added as TEXT NODES, never as HTML. So even if a server
 * reply contains "<img onerror=...>", it is shown as harmless text. We never use innerHTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') {
      el.addEventListener(name.slice(2), value); // "onclick" -> "click"
    } else {
      el.setAttribute(name, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
