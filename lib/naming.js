/**
 * Turns a human place name into a file-safe slug.
 * Behaviour is identical to v1's `nameparser` so output filenames don't change:
 *   "Portland-Auburn, ME"  -> "portland-auburn_me"
 *   "Coeur d'Alene"        -> "coeur_dalene"
 *   "Cañon City"           -> "canon_city"
 */
export function nameParser(name) {
  return String(name)
    .replaceAll('/', '-')
    .replace(/['"(),&]/g, '')
    .replaceAll(' ', '_')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Loose key for matching place names across Census, Google Ads, Microsoft Advertising and ad reports:
 * "St. Mary's County, Maryland" and "st marys county|maryland" both -> "stmaryscountymaryland".
 * The map viewer (viewer/app.js) carries an identical copy — keep them in sync.
 */
export function matchKey(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .join('')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replaceAll('&', 'and')
    .replace(/[^a-z0-9]/g, '');
}

/** Census KML names look like `<at><openparen>Abanda<closeparen>`; unwrap them. */
export function unwrapCensusName(raw) {
  const match = /<at><openparen>(.*?)<closeparen>/s.exec(raw);
  return match ? match[1] : raw;
}
