/**
 * A tiny element tree + serializer, just enough for KML.
 * Nodes: { name, attrs, children } | { text } | { cdata }
 * Output is compact (no indentation), matching the v1 output byte-for-byte for census/GDAL KML.
 */

export const el = (name, attrs = {}, children = []) => ({ name, attrs, children });

const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function attrsToString(attrs) {
  let out = '';
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) out += ` ${key}="${escapeAttr(String(value))}"`;
  }
  return out;
}

export function serialize(node) {
  if ('text' in node) return escapeText(node.text);
  if ('cdata' in node) return `<![CDATA[${node.cdata.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
  const open = `<${node.name}${attrsToString(node.attrs)}`;
  if (node.children.length === 0) return `${open}/>`;
  return `${open}>${node.children.map(serialize).join('')}</${node.name}>`;
}

export const childElements = (node, name) => node.children.filter((c) => c.name === name);
export const firstChild = (node, name) => node.children.find((c) => c.name === name);
export const removeChildren = (node, ...names) => {
  node.children = node.children.filter((c) => !names.includes(c.name));
};

/** Text content of an element, CDATA included. */
export function textOf(node) {
  if (!node) return '';
  return node.children
    .map((c) => ('text' in c ? c.text : 'cdata' in c ? c.cdata : textOf(c)))
    .join('');
}
