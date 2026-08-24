/** Minimal DOM builder — keeps view code declarative without a framework. */

export type Attrs = Record<string, string | number | boolean | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue;
      if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/** SVG twin of `h` — the dial and arc are inline SVG. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Array<Node | string>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag) as SVGElementTagNameMap[K];
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue;
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}
