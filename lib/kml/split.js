import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { SaxesParser } from 'saxes';
import { nameParser, unwrapCensusName } from '../naming.js';
import { el, serialize, attrsToString, childElements, firstChild, removeChildren, textOf } from './xml.js';

/** Elements under the root <Document> that hold placemarks rather than document-level settings. */
const CONTAINERS = new Set(['Folder', 'Document']);

/**
 * Streams a KML file and calls `onPlacemark(name, kml, attributes)` once per unique place, where `kml`
 * is a complete, lossless KML document holding exactly that one Placemark and `attributes` are its
 * <SimpleData> fields (GEOID, NAMELSAD, …).
 *
 * Unlike v1 this never holds the whole source in memory: only the document header and the
 * placemark currently being read. That's what used to blow the JS heap on the ZCTA file.
 *
 * Output layout (unchanged from v1):
 *   <kml><Document>[header: Style minus Icon/LabelStyle, empty Schema, <name>{type}</name>]
 *     <Folder><name>{NAME}</name><Placemark id="{NAME}"><name>{NAME}</name>…geometry…</Placemark></Folder>
 *   </Document></kml>
 * where NAME is `{state}_{qualifiers…}_{place}` — just `{place}` for states and sources without a
 * state field, and qualifiers (e.g. City for neighborhoods) only when the type asks for them.
 */
export async function splitKml(
  file,
  { type, statefips = {}, stateabbrev = {}, qualifiers = [], onPlacemark, onProgress = () => {} },
) {
  const stats = { written: 0, duplicates: 0, skipped: [] };
  const seen = new Set();
  const pending = [];

  let declaration = null;
  let kmlAttrs = {};
  let documentAttrs = null;
  const header = [];
  let headerDone = false;
  let outerXml = null;

  // `stack` mirrors every open element; `capture` is the subtree we're currently keeping (or null).
  const stack = [];
  let capture = null;
  let captureDepth = 0;

  const finalizeHeader = () => {
    if (headerDone) return;
    headerDone = true;
    for (const node of header) {
      if (node.name === 'Style') removeChildren(node, 'IconStyle', 'LabelStyle');
      if (node.name === 'Schema') removeChildren(node, 'SimpleField');
    }
    const nameNode = firstChild({ children: header }, 'name');
    if (nameNode) nameNode.children = [{ text: type }];
    else header.push(el('name', {}, [{ text: type }]));

    const decl = declaration ? `<?xml${attrsToString(declaration)}?>` : '';
    outerXml = {
      open: `${decl}<kml${attrsToString(kmlAttrs)}><Document${attrsToString(documentAttrs ?? {})}>${header.map(serialize).join('')}`,
      close: '</Document></kml>',
    };
  };

  /** All <SimpleData> of a placemark as { field: value } — kept for the `ids` step, dropped from the KML. */
  const attributesOf = (placemark) => {
    const attrs = {};
    for (const extended of childElements(placemark, 'ExtendedData')) {
      for (const schemaData of childElements(extended, 'SchemaData')) {
        for (const data of childElements(schemaData, 'SimpleData')) attrs[data.attrs.name] = textOf(data);
      }
    }
    return attrs;
  };

  const placeName = (placemark, attrs) => {
    let state;
    if (statefips[attrs.STATEFP]) state = nameParser(statefips[attrs.STATEFP]);
    else if (stateabbrev[attrs.State?.toLocaleUpperCase()]) state = nameParser(stateabbrev[attrs.State.toLocaleUpperCase()]);

    const nameNode = firstChild(placemark, 'name');
    const raw = nameNode ? textOf(nameNode) : (attrs.NAME ?? attrs.Name);
    if (!raw) return null;
    const place = nameParser(unwrapCensusName(raw));
    const parts = type !== 'state' && state ? [state] : [];
    for (const q of qualifiers) if (attrs[q]) parts.push(nameParser(attrs[q]));
    return [...parts, place].join('_');
  };

  const emitPlacemark = (placemark) => {
    finalizeHeader();
    const attributes = attributesOf(placemark);
    const NAME = placeName(placemark, attributes);
    // GDAL moves the field it used for <name> out of ExtendedData; put it back for the `ids` step
    const nameNode = firstChild(placemark, 'name');
    if (nameNode && attributes.NAME === undefined && attributes.Name === undefined) {
      attributes.NAME = unwrapCensusName(textOf(nameNode));
    }
    if (!NAME) {
      stats.skipped.push(placemark.attrs.id ?? '(unnamed placemark)');
      return;
    }
    if (seen.has(NAME)) {
      stats.duplicates++;
      return;
    }
    seen.add(NAME);

    removeChildren(placemark, 'description', 'ExtendedData');
    placemark.attrs.id = NAME;
    if (nameNode) nameNode.children = [{ text: NAME }];
    else placemark.children.unshift(el('name', {}, [{ text: NAME }]));

    const kml = `${outerXml.open}<Folder><name>${serialize({ text: NAME })}</name>${serialize(placemark)}</Folder>${outerXml.close}`;
    stats.written++;
    pending.push(onPlacemark(NAME, kml, attributes));
  };

  const parser = new SaxesParser({ xmlns: false, position: false });

  parser.on('xmldecl', ({ version, encoding, standalone }) => {
    declaration = { version, encoding, standalone };
  });

  parser.on('opentag', ({ name, attributes }) => {
    const parent = stack.at(-1);
    stack.push(name);
    const node = el(name, { ...attributes });

    if (capture) {
      capture.at(-1).children.push(node);
      capture.push(node);
      return;
    }
    if (name === 'kml' && stack.length === 1) {
      kmlAttrs = node.attrs;
    } else if (name === 'Document' && parent === 'kml') {
      documentAttrs = node.attrs;
    } else if (name === 'Placemark') {
      capture = [node];
      captureDepth = stack.length;
    } else if (parent === 'Document' && stack.length === 3 && !CONTAINERS.has(name)) {
      // document-level settings: <name>, <Style>, <Schema>, <visibility>…
      if (!headerDone) header.push(node);
      capture = [node];
      captureDepth = stack.length;
    }
    // anything else (Folder/inner Document wrappers and their own <name>s) is dropped, as in v1
  });

  parser.on('text', (text) => {
    if (!capture || !text.trim()) return;
    capture.at(-1).children.push({ text: text.replace(/\s*[\r\n]+\s*/g, ' ').trim() });
  });

  parser.on('cdata', (cdata) => {
    if (capture) capture.at(-1).children.push({ cdata });
  });

  parser.on('closetag', () => {
    if (capture) {
      const node = capture.pop();
      if (stack.length === captureDepth) {
        capture = null;
        if (node.name === 'Placemark') emitPlacemark(node);
      }
    }
    stack.pop();
  });

  const encoding = await sniffEncoding(file);
  const stream = createReadStream(file, { encoding, highWaterMark: 1 << 20 });
  for await (const chunk of stream) {
    parser.write(chunk);
    if (pending.length) await Promise.all(pending.splice(0));
    onProgress(stream.bytesRead);
  }
  parser.close();
  await Promise.all(pending);
  return stats;
}

/** v1 used read-xml for this; census + GDAL KML is UTF-8 but honour a latin-1 declaration if we see one. */
async function sniffEncoding(file) {
  const handle = await open(file);
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(256), 0, 256, 0);
    const head = buffer.subarray(0, bytesRead).toString('latin1');
    const declared = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase();
    return ['iso-8859-1', 'latin1', 'latin-1', 'windows-1252'].includes(declared) ? 'latin1' : 'utf8';
  } finally {
    await handle.close();
  }
}
