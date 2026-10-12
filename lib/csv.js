/** RFC 4180-ish CSV parsing: quoted fields, "" escapes, CRLF, and a BOM. Good enough for Google/Microsoft geo files. */
export function parseCsv(text, delimiter = ',') {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Rows as objects keyed by the header row. */
export function parseCsvObjects(text, delimiter = ',') {
  const [header, ...rows] = parseCsv(text, delimiter);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

export function toCsv(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return `${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`;
}
