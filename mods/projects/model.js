// GitHub Projects (v2) data: the query, and the pure functions that turn it into rows and bars.
// No Herdr imports here, so it can be tested with plain node.

// What one Project item needs: its issue, pull request or draft, and its field values.
const ITEM = `
  content {
    __typename
    ... on Issue { number title url state }
    ... on PullRequest { number title url state }
    ... on DraftIssue { title }
  }
  fieldValues(first: 30) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldIterationValue { title startDate duration field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
    }
  }`;

// Only the items that have a value in a field ("has:\"Start date\""), for the chart:
// a big Project has thousands of items and the first 100 may hold none with dates.
export const DATED_QUERY = `
query($id: ID!, $q: String!) {
  node(id: $id) { ... on ProjectV2 { items(first: 100, query: $q) { totalCount nodes { ${ITEM} } } } }
}`;

export const QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 20) {
      nodes {
        id number title url closed
        views(first: 20) { nodes { name layout filter } }
        fields(first: 50) { nodes { __typename ... on ProjectV2FieldCommon { name dataType } } }
        items(first: 100) {
          totalCount
          nodes { ${ITEM} }
        }
      }
    }
  }
}`;

// "INSUFFICIENT_SCOPES" means the gh token lacks read:project.
export function parse(stdout) {
  let json;
  try { json = JSON.parse(stdout); } catch { return { error: "Could not read the answer from gh." }; }
  const errors = json.errors ?? [];
  if (errors.some((e) => e.type === "INSUFFICIENT_SCOPES")) return { scope: true };
  if (errors.length && !json.data?.repository) return { error: errors[0].message };
  const nodes = json.data?.repository?.projectsV2?.nodes ?? [];
  return { projects: nodes.filter((p) => !p.closed).map(project) };
}

// The answer of DATED_QUERY: { items, total } or null.
export function parseItems(stdout) {
  try {
    const it = JSON.parse(stdout).data?.node?.items;
    return it ? { items: it.nodes.map(item), total: it.totalCount } : null;
  } catch { return null; }
}

// The filter that keeps only items with a date, or null when there is no date field.
export function datedFilter(spec) {
  const name = spec?.kind === "iteration" ? spec.field : spec?.start;
  return name ? `has:"${name.replace(/"/g, "")}"` : null;
}

function project(p) {
  return {
    id: p.id, number: p.number, title: p.title, url: p.url,
    views: p.views.nodes,
    fields: p.fields.nodes.filter((f) => f.name),
    total: p.items.totalCount,
    items: p.items.nodes.map(item),
  };
}

function item(n) {
  const c = n.content ?? {};
  const values = {};
  for (const v of n.fieldValues.nodes) {
    const name = v.field?.name;
    if (!name) continue;
    if (v.__typename.endsWith("DateValue")) values[name] = { type: "DATE", date: v.date };
    else if (v.__typename.endsWith("IterationValue")) values[name] = { type: "ITERATION", title: v.title, startDate: v.startDate, duration: v.duration };
    else if (v.__typename.endsWith("SingleSelectValue")) values[name] = { type: "SELECT", text: v.name };
    else if (v.__typename.endsWith("TextValue")) values[name] = { type: "TEXT", text: v.text };
    else if (v.__typename.endsWith("NumberValue")) values[name] = { type: "NUMBER", text: String(v.number) };
  }
  return { title: c.title ?? "(untitled)", number: c.number ?? null, url: c.url ?? null, state: c.state ?? null, draft: c.__typename === "DraftIssue", values };
}

export const day = (iso) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000);
export const isoOf = (d) => new Date(d * 86400000).toISOString().slice(0, 10);

// Which fields give an item its dates. GitHub does not expose the Roadmap's own
// settings through the API, so: a start-ish and an end-ish DATE field by name,
// a single DATE field as a point, else an Iteration field.
export function dateSpec(fields) {
  // A Date field called "Archive" is not a schedule: only schedule-like names count.
  const SCHEDULE = /start|begin|end|target|due|finish|deadline|release|ship|date|開始|終了|期限|完了|予定|リリース/i;
  const dates = fields.filter((f) => f.dataType === "DATE" && SCHEDULE.test(f.name)).map((f) => f.name);
  const start = dates.find((n) => /start|begin|開始/i.test(n));
  const end = dates.find((n) => n !== start && /end|target|due|finish|deadline|終了|期限|完了/i.test(n));
  if (start || end || dates.length >= 2) {
    const s = start ?? dates.find((n) => n !== end) ?? end, e = end ?? dates.find((n) => n !== s) ?? s;
    return { kind: "dates", start: s, end: e, label: s === e ? s : `${s} → ${e}` };
  }
  if (dates.length === 1) return { kind: "dates", start: dates[0], end: dates[0], label: dates[0] };
  const it = fields.find((f) => f.dataType === "ITERATION");
  if (it) return { kind: "iteration", field: it.name, label: it.name };
  return null;
}

// { start, end } in whole days (end inclusive), or null when the item has no date.
export function span(it, spec) {
  if (!spec) return null;
  if (spec.kind === "iteration") {
    const v = it.values[spec.field];
    if (!v?.startDate) return null;
    const s = day(v.startDate);
    return { start: s, end: s + Math.max(1, v.duration ?? 1) - 1 };
  }
  const a = it.values[spec.start]?.date, b = it.values[spec.end]?.date;
  if (!a && !b) return null;
  const s = day(a ?? b), e = day(b ?? a);
  return { start: Math.min(s, e), end: Math.max(s, e) };
}

// Rows sorted by start, and the axis around them. today is a day number.
export function gantt(items, spec, today) {
  const rows = [], unscheduled = [];
  for (const it of items) {
    const sp = span(it, spec);
    (sp ? rows : unscheduled).push(sp ? { it, ...sp } : it);
  }
  rows.sort((x, y) => x.start - y.start || x.end - y.end);
  const all = rows.flatMap((r) => [r.start, r.end]).concat(today);
  const min = Math.min(...all) - 3, max = Math.max(...all) + 14;
  return { rows, unscheduled, min, max };
}

// First day of each month inside [min, max].
export function months(min, max) {
  const out = [];
  const d = new Date(min * 86400000);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  for (;;) {
    const first = Math.floor(Date.UTC(y, m, 1) / 86400000);
    if (first > max) break;
    if (first < min) { m++; if (m > 11) { m = 0; y++; } continue; }
    const dt = new Date(first * 86400000), mon = dt.getUTCMonth() + 1;
    out.push({ day: first, label: mon === 1 ? `${dt.getUTCFullYear()}年1月` : `${mon}月` });
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}
