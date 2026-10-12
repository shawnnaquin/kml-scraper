// Campaign geo map: joins Google Ads / Microsoft Advertising / Meta / The Trade Desk location reports to the
// shapes in dist/simplified/<type> (via each layer's _index.json) and draws a choropleth on Google Maps.

/** Same as lib/naming.js#matchKey — keep them in sync. */
const matchKey = (...parts) =>
  parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .join('')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replaceAll('&', 'and')
    .replace(/[^a-z0-9]/g, '');

// Sequential single-hue ramp (light -> dark), 5 steps
const RAMP = ['#b7d3f6', '#6da7ec', '#3987e5', '#256abf', '#104281'];
const LAYER_ORDER = ['county', 'dma', 'city', 'zip', 'state', 'neighborhood', 'zillow'];
const ROWS = 'Report rows';

/** Ad platforms. Google covers every Google Ads account (search, PMax, display…) and DV360 — same location IDs. */
const PLATFORMS = {
  google: { label: 'Google Ads', hint: /\bcost\b|criteria|google|adwords|conv\. value|search impr/i },
  msft: { label: 'Microsoft Advertising', hint: /microsoft|bing|\bspend\b|location id/i },
  meta: { label: 'Meta', hint: /meta|facebook|\bfb\b|instagram|amount spent|reach|frequency|link clicks|dma region|ad set/i },
  ttd: { label: 'The Trade Desk', hint: /trade ?desk|\bttd\b|advertiser cost|partner cost|media cost|^metro$/i },
  other: { label: 'Other', hint: /$^/ },
};

/** Different platforms name the same metric differently; fold them so reports can be combined. */
const METRIC_ALIASES = [
  [/^(cost|spend|amount spent.*|advertiser cost.*|media cost.*|partner cost.*|total cost.*)$/i, 'Spend'],
  [/^(impr(essions|\.)?|impressions? \(.*\))$/i, 'Impressions'],
  [/^(clicks?|link clicks|clicks \(all\))$/i, 'Clicks'],
  [/^(conv(ersions|\.)?|all conv\.?|results|purchases|total conversions)$/i, 'Conversions'],
  [/^(conv\. value|conversion value|revenue|purchases conversion value)$/i, 'Conversion value'],
  [/^reach$/i, 'Reach'],
];
const canonicalMetric = (h) => METRIC_ALIASES.find(([re]) => re.test(h.trim()))?.[1] ?? h.trim();

const $ = (sel) => document.querySelector(sel);
const state = {
  map: null,
  index: null,
  lookup: null,
  reports: [],
  filters: new Map(), // "platform" or "platform|account" -> enabled
  matches: new Map(),
  unmatched: [],
  bins: [],
  metric: ROWS,
};
let nextReportId = 1;

// ---------- CSV ----------

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') (field += '"'), i++;
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) row.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const toNumber = (v) => {
  const s = String(v ?? '').replace(/[$€£,%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (s === '' || s === '--' || s === '-') return NaN;
  return Number(s);
};

const isIdCol = (h) => /(location|criteria|criterion|target|geo|region|metro|dma).*\bid\b|^id$|geo.?target|targeting key/i.test(h);
const isCodeCol = (h) => /zip|postal|code|dma|metro|^id$/i.test(h);
const isAccountCol = (h) => /^(account( name)?|customer( name)?|advertiser( name)?|ad account( name)?|partner( name)?|platform|channel|network|publisher)$/i.test(h);

/** Google exports start with a title + date-range line; Microsoft adds footers. Find the real header. */
function parseReport(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
  const text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(buffer).replace(/^﻿/, '');
  const firstLines = text.split(/\r?\n/, 10).join('\n');
  const delimiter = (firstLines.match(/\t/g) ?? []).length > (firstLines.match(/,/g) ?? []).length ? '\t' : ',';
  const rows = parseDelimited(text, delimiter);

  const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
  const headerAt = rows.findIndex((r) => r.length >= Math.max(2, width * 0.8) && r.every((c) => c.trim() && Number.isNaN(toNumber(c))));
  if (headerAt === -1) throw new Error('no header row found');
  const header = rows[headerAt].map((h) => h.trim());
  const body = rows
    .slice(headerAt + 1)
    .filter((r) => r.length >= header.length * 0.8 && !/^\s*total/i.test(r[0]) && !/^©|^report/i.test(r[0]))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));

  const numeric = (h) => body.length && body.filter((r) => !Number.isNaN(toNumber(r[h]))).length / body.length > 0.8;
  const idCols = header.filter(isIdCol);
  const metricCols = header.filter((h) => !isIdCol(h) && !isCodeCol(h) && numeric(h));
  const textCols = header.filter((h) => !metricCols.includes(h));
  const accountCol = header.find(isAccountCol) ?? null;

  const haystack = `${fileName} ${header.join(' ')}`;
  // most distinctive first: TTD/Meta exports also have "cost"-ish columns
  const platform = ['ttd', 'meta', 'msft', 'google'].find((p) => PLATFORMS[p].hint.test(haystack)) ?? 'other';
  const account = fileName.replace(/\.[^.]+$/, '');
  return { id: nextReportId++, name: fileName, platform, account, header, rows: body, idCols, metricCols, textCols, accountCol, delimiter };
}

// ---------- matching ----------

function buildLookup(index) {
  const byId = Object.fromEntries(['google', 'msft', 'meta', 'ttd'].map((k) => [k, new Map()]));
  const byKey = new Map();
  for (const p of index.places) {
    for (const [platform, id] of Object.entries(p.ids ?? {})) {
      if (!id) continue;
      byId[platform].set(String(id), p);
      byId[platform].set(String(id).replace(/\D/g, ''), p); // "DMA:535" also as "535"
    }
    for (const k of p.keys) byKey.set(k, byKey.has(k) && byKey.get(k) !== p ? null : p); // null = ambiguous
  }
  return { byId, byKey };
}

const col = (header, re) => header.find((h) => re.test(h));

/** Candidate match keys for a row, most specific first. */
function candidates(row, report) {
  const h = report.header;
  const stateCol = col(h, /^(region|state|state\/province|state or province|state name)$/i);
  const st = stateCol ? row[stateCol] : '';
  const out = [];
  const add = (...parts) => out.push(matchKey(...parts));
  const addLocation = (v) => {
    if (!v) return;
    const parts = v.split(/\s*[,|]\s*/).filter(Boolean);
    add(v);
    if (/^(united states|us|usa)$/i.test(parts.at(-1) ?? '')) add(parts.slice(0, -1).join(' '));
    add(parts.slice(0, 2).join(' '));
    add(parts[0]);
    if (st) add(parts[0], st);
  };
  for (const [re, withState] of [
    [/postal|zip/i, false],
    [/neighbou?rhood/i, true],
    [/city/i, true],
    [/county/i, true],
    [/metro|dma|market area/i, false],
  ]) {
    const c = col(h, re);
    if (c && row[c] && !report.idCols.includes(c)) withState && st ? add(row[c], st) : add(row[c]);
  }
  for (const c of h.filter((x) => /location|target|^name$|geo/i.test(x) && !report.idCols.includes(x))) addLocation(row[c]);
  if (st) add(st);
  return out;
}

function matchRow(row, report) {
  const { byId, byKey } = state.lookup;
  const idSpaces = report.platform in byId ? [report.platform] : Object.keys(byId);
  for (const c of report.idCols) {
    const raw = row[c]?.trim();
    if (!raw) continue;
    for (const p of idSpaces) {
      const hit = byId[p].get(raw) ?? byId[p].get(raw.replace(/\D/g, ''));
      if (hit) return hit;
    }
  }
  // ID-looking values in other columns: Meta "DMA:501" / "US:43215", TTD metro codes
  for (const c of report.textCols) {
    const raw = row[c]?.trim();
    if (!raw || !/^([A-Z]{2,3}:)?\d+$/.test(raw)) continue;
    for (const p of idSpaces) {
      const hit = byId[p].get(raw);
      if (hit) return hit;
    }
  }
  for (const k of candidates(row, report)) {
    const p = byKey.get(k);
    if (p) return p;
  }
  return null;
}

const rowAccount = (row, report) => (report.accountCol && row[report.accountCol]) || report.account;
const enabled = (platform, account) => state.filters.get(platform) !== false && state.filters.get(`${platform}|${account}`) !== false;

function runMatch() {
  state.matches = new Map();
  state.unmatched = [];
  if (!state.lookup) return draw();
  for (const report of state.reports) {
    for (const row of report.rows) {
      const account = rowAccount(row, report);
      if (!enabled(report.platform, account)) continue;
      const place = matchRow(row, report);
      if (!place) {
        state.unmatched.push(`[${PLATFORMS[report.platform].label}] ${report.textCols.map((c) => row[c]).filter(Boolean).join(' · ')}`);
        continue;
      }
      const m = state.matches.get(place.file) ?? { place, rows: 0, values: {}, byPlatform: {} };
      m.rows++;
      const per = (m.byPlatform[report.platform] ??= { rows: 0, values: {} });
      per.rows++;
      for (const c of report.metricCols) {
        const metric = canonicalMetric(c);
        const v = toNumber(row[c]) || 0;
        m.values[metric] = (m.values[metric] ?? 0) + v;
        per.values[metric] = (per.values[metric] ?? 0) + v;
      }
      state.matches.set(place.file, m);
    }
  }
  draw();
}

// ---------- map ----------

function loadMaps(key) {
  return new Promise((resolve, reject) => {
    window.__mapsReady = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__mapsReady`;
    s.onerror = () => reject(new Error('Could not load Google Maps'));
    document.head.append(s);
  });
}

async function initMap(key) {
  await loadMaps(key);
  const { Map } = await google.maps.importLibrary('maps');
  $('#map').innerHTML = '';
  state.map = new Map($('#map'), {
    center: { lat: 39.5, lng: -98.35 },
    zoom: 4,
    mapTypeControl: false,
    streetViewControl: false,
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'DARK' : 'LIGHT',
  });
  const data = state.map.data;
  data.setStyle((f) => ({ fillColor: colorFor(f.getProperty('_value')), fillOpacity: 0.75, strokeColor: '#ffffff', strokeWeight: 1, strokeOpacity: 0.9 }));
  const tip = $('#tooltip');
  data.addListener('mouseover', (e) => {
    data.overrideStyle(e.feature, { strokeWeight: 2.5, strokeColor: '#1f1f1d' });
    const m = state.matches.get(e.feature.getProperty('_file'));
    if (!m) return;
    tip.innerHTML = tooltipHtml(m);
    tip.hidden = false;
  });
  data.addListener('mousemove', (e) => {
    const ev = e.domEvent;
    if (ev) Object.assign(tip.style, { left: `${ev.clientX + 14}px`, top: `${ev.clientY + 14}px` });
  });
  data.addListener('mouseout', (e) => {
    data.revertStyle(e.feature);
    tip.hidden = true;
  });
  draw();
}

const fmt = (n) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const valueOf = (m) => (state.metric === ROWS ? m.rows : (m.values[state.metric] ?? 0));
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function tooltipHtml(m) {
  const p = m.place;
  const lines = [`<div class="t">${escapeHtml(p.label)}</div>`];
  const ids = Object.entries(p.ids ?? {})
    .filter(([, id]) => id)
    .map(([k, id]) => `${PLATFORMS[k].label}: ${escapeHtml(id)}`);
  if (ids.length) lines.push(`<div class="muted">${ids.join('<br>')}</div>`);
  const metric = state.metric;
  lines.push(`<div class="v"><strong>${escapeHtml(metric)}: ${fmt(valueOf(m))}</strong></div>`);
  const platforms = Object.entries(m.byPlatform);
  if (platforms.length > 1) {
    for (const [k, per] of platforms) {
      lines.push(`<div class="v muted">${PLATFORMS[k].label}: ${fmt(metric === ROWS ? per.rows : (per.values[metric] ?? 0))}</div>`);
    }
  }
  return lines.join('');
}

/** Quantile breaks so a few huge DMAs don't wash everything else out. */
function computeBins(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = Math.min(RAMP.length, new Set(sorted).size);
  if (n <= 1) return [];
  const breaks = [];
  for (let i = 1; i < n; i++) breaks.push(sorted[Math.floor((i / n) * sorted.length)]);
  return [...new Set(breaks)];
}

function colorFor(value) {
  if (value === undefined || value === null) return RAMP[2];
  if (!state.bins.length) return RAMP[3];
  const i = state.bins.findIndex((b) => value < b);
  const step = i === -1 ? state.bins.length : i;
  return RAMP[RAMP.length - (state.bins.length + 1) + step];
}

const shapeCache = new Map();
let drawToken = 0;

async function draw() {
  renderMetricOptions();
  renderSummary();
  renderTable();
  const matches = [...state.matches.values()];
  state.bins = computeBins(matches.map(valueOf));
  renderLegend();
  if (!state.map) return;
  const token = ++drawToken;
  const data = state.map.data;
  data.forEach((f) => data.remove(f));
  if (!matches.length) return;

  const bounds = new google.maps.LatLngBounds();
  const queue = [...matches];
  const worker = async () => {
    while (queue.length && token === drawToken) {
      const m = queue.shift();
      const url = `/data/${state.index.type}/${m.place.file}`;
      if (!shapeCache.has(url)) shapeCache.set(url, fetch(url).then((r) => r.json()));
      const geojson = await shapeCache.get(url);
      if (token !== drawToken) return;
      for (const f of data.addGeoJson(geojson)) {
        f.setProperty('_file', m.place.file);
        f.setProperty('_value', valueOf(m));
        f.getGeometry().forEachLatLng((ll) => bounds.extend(ll));
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (token === drawToken && !bounds.isEmpty()) state.map.fitBounds(bounds);
}

function zoomTo(file) {
  if (!state.map) return;
  const bounds = new google.maps.LatLngBounds();
  state.map.data.forEach((f) => f.getProperty('_file') === file && f.getGeometry().forEachLatLng((ll) => bounds.extend(ll)));
  if (!bounds.isEmpty()) state.map.fitBounds(bounds);
}

// ---------- panel ----------

function renderReports() {
  $('#reports').innerHTML = state.reports
    .map(
      (r) => `<li data-id="${r.id}">
        <div class="report-head"><span class="file" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
          <button type="button" class="link remove" aria-label="Remove ${escapeHtml(r.name)}">remove</button></div>
        <div class="row two">
          <select class="platform" aria-label="Platform">${Object.entries(PLATFORMS)
            .map(([k, p]) => `<option value="${k}" ${k === r.platform ? 'selected' : ''}>${p.label}</option>`)
            .join('')}</select>
          <input class="account" aria-label="Account label" value="${escapeHtml(r.account)}" ${r.accountCol ? `title="Accounts come from the '${escapeHtml(r.accountCol)}' column"` : ''}>
        </div>
        <div class="muted small">${r.rows.length.toLocaleString()} rows${r.accountCol ? ` · accounts from “${escapeHtml(r.accountCol)}”` : ''}</div>
      </li>`,
    )
    .join('');
}

/** Platform -> account checkboxes built from whatever reports are loaded (e.g. Google: SEM, SEIM). */
function renderFilters() {
  const tree = new Map();
  for (const r of state.reports) {
    const accounts = tree.get(r.platform) ?? new Set();
    if (r.accountCol) for (const row of r.rows) accounts.add(rowAccount(row, r));
    else accounts.add(r.account);
    tree.set(r.platform, accounts);
  }
  $('#filters').hidden = tree.size === 0;
  $('#filter-list').innerHTML = [...tree]
    .map(([platform, accounts]) => {
      const on = state.filters.get(platform) !== false;
      const accs = [...accounts].sort();
      return `<li><label class="check"><input type="checkbox" data-filter="${platform}" ${on ? 'checked' : ''}> ${PLATFORMS[platform].label}</label>
        ${accs.length ? `<ul>${accs
          .map((a) => {
            const key = `${platform}|${a}`;
            return `<li><label class="check"><input type="checkbox" data-filter="${escapeHtml(key)}" ${state.filters.get(key) !== false ? 'checked' : ''} ${on ? '' : 'disabled'}> ${escapeHtml(a)}</label></li>`;
          })
          .join('')}</ul>` : ''}</li>`;
    })
    .join('');
}

function renderMetricOptions() {
  const metrics = [...new Set(state.reports.flatMap((r) => r.metricCols.map(canonicalMetric))), ROWS];
  const sel = $('#metric');
  const current = state.metric;
  if (!metrics.includes(current)) {
    state.metric = metrics.find((m) => m === 'Spend') ?? metrics.find((m) => m === 'Clicks') ?? metrics[0];
  }
  sel.innerHTML = metrics.map((m) => `<option ${m === state.metric ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
  sel.disabled = !state.reports.length;
}

function renderSummary() {
  if (!state.reports.length) return ($('#summary').textContent = '');
  const total = state.reports.reduce((a, r) => a + r.rows.length, 0);
  const matchedRows = [...state.matches.values()].reduce((a, m) => a + m.rows, 0);
  $('#summary').textContent =
    `${matchedRows.toLocaleString()} of ${total.toLocaleString()} rows matched ` +
    `${state.matches.size.toLocaleString()} ${state.index?.type ?? ''} shapes · ${state.unmatched.length.toLocaleString()} unmatched (incl. filtered-in only)`;
  $('#unmatched').innerHTML = state.unmatched.slice(0, 500).map((u) => `<li>${escapeHtml(u)}</li>`).join('');
}

function renderLegend() {
  const el = $('#legend');
  if (!state.matches.size) return (el.innerHTML = '');
  const values = [...state.matches.values()].map(valueOf);
  const steps = state.bins.length ? RAMP.slice(RAMP.length - (state.bins.length + 1)) : [RAMP[3]];
  const ticks = state.bins.length ? [Math.min(...values), ...state.bins, Math.max(...values)] : [Math.min(...values), Math.max(...values)];
  el.innerHTML =
    `<div class="title">${escapeHtml(state.metric)}</div>` +
    `<div class="bar">${steps.map((c) => `<span style="background:${c}"></span>`).join('')}</div>` +
    `<div class="ticks">${ticks.map((t) => `<span>${fmt(t)}</span>`).join('')}</div>`;
}

function renderTable() {
  $('#table thead').innerHTML = `<tr><th>Place</th><th class="num">${escapeHtml(state.metric)}</th></tr>`;
  const rows = [...state.matches.values()].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 1000);
  $('#table tbody').innerHTML = rows
    .map((m) => `<tr data-file="${escapeHtml(m.place.file)}"><td>${escapeHtml(m.place.label)}</td><td class="num">${fmt(valueOf(m))}</td></tr>`)
    .join('');
}

async function loadLayer(type) {
  state.index = await (await fetch(`/data/${type}/_index.json`)).json();
  state.lookup = buildLookup(state.index);
  runMatch();
}

async function addReports(files) {
  for (const file of files) {
    try {
      state.reports.push(parseReport(await file.arrayBuffer(), file.name));
    } catch (err) {
      $('#summary').textContent = `Couldn't read ${file.name}: ${err.message}`;
    }
  }
  renderReports();
  renderFilters();
  runMatch();
}

async function main() {
  const layers = (await (await fetch('/api/layers')).json()).sort((a, b) => LAYER_ORDER.indexOf(a) - LAYER_ORDER.indexOf(b));
  const layerSel = $('#layer');
  layerSel.innerHTML = layers.length
    ? layers.map((l) => `<option>${l}</option>`).join('')
    : '<option disabled>no layers — run the pipeline (ids step) first</option>';
  layerSel.addEventListener('change', () => loadLayer(layerSel.value));
  if (layers.length) await loadLayer(layers[0]);

  $('#report').addEventListener('change', (e) => addReports([...e.target.files]).then(() => (e.target.value = '')));
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addReports([...e.dataTransfer.files]);
  });

  $('#reports').addEventListener('change', (e) => {
    const r = state.reports.find((x) => x.id === Number(e.target.closest('li[data-id]')?.dataset.id));
    if (!r) return;
    if (e.target.matches('.platform')) r.platform = e.target.value;
    if (e.target.matches('.account')) r.account = e.target.value.trim() || r.name;
    renderFilters();
    runMatch();
  });
  $('#reports').addEventListener('click', (e) => {
    if (!e.target.matches('.remove')) return;
    const id = Number(e.target.closest('li[data-id]').dataset.id);
    state.reports = state.reports.filter((r) => r.id !== id);
    renderReports();
    renderFilters();
    runMatch();
  });
  $('#filter-list').addEventListener('change', (e) => {
    if (!e.target.dataset.filter) return;
    state.filters.set(e.target.dataset.filter, e.target.checked);
    renderFilters();
    runMatch();
  });
  $('#metric').addEventListener('change', (e) => ((state.metric = e.target.value), draw()));
  $('#table tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-file]');
    if (tr) zoomTo(tr.dataset.file);
  });

  const { mapsApiKey } = await (await fetch('/api/config')).json();
  const key = mapsApiKey || localStorage.getItem('mapsApiKey');
  if (key) return initMap(key);
  $('#key-section').hidden = false;
  $('#save-key').addEventListener('click', () => {
    const k = $('#api-key').value.trim();
    if (!k) return;
    localStorage.setItem('mapsApiKey', k);
    $('#key-section').hidden = true;
    initMap(k);
  });
}

main();
