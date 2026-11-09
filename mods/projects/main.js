import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, run, layout, theme } from "herdr";
import { QUERY, parse, dateSpec, gantt, months, day, isoOf } from "./model.js";

// A side panel beside Files, Changes and Issues: the GitHub Projects linked to the
// focused terminal's repository, as a table or a Roadmap-style chart. Read only.

const REFRESH = 60000;
const ROW = 26, PX = [3, 5, 8, 14], AXIS = 24;

function location(last) {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  if (pane && !pane.terminal && last) return last;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

// Only the panel that is on screen works.
function hidden() {
  const root = layout(), body = find(root, "panel-body");
  if (!body?.children?.some((c) => c.content?.mod === "projects")) return false;
  return find(root, "panel")?.hidden || find(body, body.active)?.content?.mod !== "projects";
}

function remembered(key) { try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; } }
const today = () => day(new Date().toISOString());

export default class Projects extends View {
  init(_props, cx) {
    this.repos = remembered("repos"); this.chosen = remembered("chosen"); this.mode = remembered("mode").mode ?? "gantt";
    this.zoom = 1; this.repo = null; this.data = {}; this.on = null;
    this.refresh(cx);
    cx.timer.every(REFRESH, (cx) => { if (!hidden()) this.refresh(cx); });
  }

  async repoFor(cwd, on) {
    const id = JSON.stringify([cwd, on]);
    if (!this.repos[id]) {
      const r = await exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd, on });
      if (r.code === 0) { this.repos[id] = r.stdout.trim(); localStorage.setItem("repos", JSON.stringify(this.repos)); }
    }
    return this.repos[id] ?? null;
  }

  refresh(cx) {
    const { cwd, on } = (this.last = location(this.last));
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const repo = cwd ? await this.repoFor(cwd, on) : null;
        if (repo) this.repo = repo;
        if (!this.repo) return;
        this.on = on;
        const [owner, name] = this.repo.split("/");
        const r = await exec("gh", ["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`], { on });
        this.data[this.repo] = parse(r.stdout || "{}");
        if (!r.stdout && r.stderr) this.data[this.repo] = { error: r.stderr.trim() };
      } catch (e) { if (this.repo) this.data[this.repo] = { error: String(e?.message ?? e) }; }
      finally { this.busy = false; cx.notify(); }
    });
  }

  current() {
    const d = this.data[this.repo];
    if (!d?.projects?.length) return null;
    return d.projects.find((p) => p.number === this.chosen[this.repo]) ?? d.projects[0];
  }

  chip(id, label, on, t, fn) {
    return div().id(id).h(24).px(9).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).when(on, (e) => e.font_semibold())
      .hover((s) => s.bg(on ? t.selected : t.hover)).on_click(fn).child(label);
  }

  note(t, title, body, extra) {
    return v_flex().flex_1().items_center().justify_center().gap(8).px(36)
      .child(div().font_semibold().text_color(t.muted).child(title))
      .child(div().text_size(12).text_color(t.dim).text_center().child(body))
      .when(Boolean(extra), (e) => e.child(div().text_size(12).text_color(t.accent).child(extra)));
  }

  statusColor(it, t) {
    const s = Object.entries(it.values).find(([k, v]) => v.type === "SELECT" && /status|state|状態|ステータス/i.test(k))?.[1]?.text ?? "";
    if (it.state === "CLOSED" || it.state === "MERGED" || /done|complete|closed|完了/i.test(s)) return t.ansi5;
    if (/progress|doing|review|進行|レビュー/i.test(s)) return t.ansi3;
    return t.dim;
  }

  table(p, t) {
    const cols = p.fields.filter((f) => ["SINGLE_SELECT", "DATE", "ITERATION"].includes(f.dataType)).slice(0, 4).map((f) => f.name);
    const cell = (it, c) => { const v = it.values[c]; return v?.date ?? v?.text ?? v?.title ?? ""; };
    return v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
      .child(h_flex().px(10).py(4).gap(8).text_size(11).font_semibold().text_color(t.dim)
        .child(div().w(40).child("#")).child(div().flex_1().min_w(0).child("Title")).children(cols.map((c) => div().w(92).truncate().child(c))))
      .children(p.items.map((it, i) => h_flex().id(`row-${i}`).px(10).py(5).gap(8).rounded(7).items_start().hover((s) => s.bg(t.hover))
        .child(div().w(40).text_color(this.statusColor(it, t)).child(it.number ? `#${it.number}` : "–"))
        .child(div().flex_1().min_w(0).text_color(t.foreground).child(it.title))
        .children(cols.map((c) => div().w(92).truncate().text_size(12).text_color(t.muted).child(cell(it, c))))));
  }

  chart(p, t) {
    const spec = dateSpec(p.fields);
    if (!spec) return this.note(t, "No date fields", "Add a Date or Iteration field to this Project and it shows here as a Roadmap.", "Switch to Table to see the items.");
    const g = gantt(p.items, spec, today());
    if (!g.rows.length) return this.note(t, "Nothing is scheduled", `No item has a value in ${spec.label} yet.`);
    const px = PX[this.zoom], width = (g.max - g.min + 1) * px, now = today();
    const bar = (r, i) => {
      const left = (r.start - g.min) * px, w = Math.max((r.end - r.start + 1) * px, 6);
      return div().id(`bar-${i}`).absolute().top(AXIS + i * ROW).left(0).w(width).h(ROW)
        .child(div().absolute().left(left).top(7).w(w).h(12).rounded(3).bg(this.statusColor(r.it, t)))
        .child(div().absolute().left(left + w + 6).top(4).text_size(12).text_color(t.muted).whitespace_nowrap().child(`${r.it.number ? `#${r.it.number} ` : ""}${r.it.title}`));
    };
    const height = AXIS + g.rows.length * ROW + 4;
    const chart = div().relative().w(width).h(height)
      .children(months(g.min, g.max).map((m) => div().absolute().left((m.day - g.min) * px).top(0).h(height).w(1).bg(t.border)
        .child(div().absolute().left(4).top(3).text_size(11).text_color(t.dim).whitespace_nowrap().child(m.label))))
      .children(g.rows.map(bar))
      .child(div().absolute().left((now - g.min) * px).top(0).w(1).h(height).bg(t.ansi1));
    return v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(6)
      .child(div().text_size(11).text_color(t.dim).child(`${spec.label} ・ today ${isoOf(now)}${g.unscheduled.length ? ` ・ ${g.unscheduled.length} without dates` : ""}`))
      .child(div().id("gantt-scroll").overflow_x_scrollbar().w_full().child(chart));
  }

  render(cx) {
    const t = theme(), d = this.data[this.repo], p = this.current();
    const panel = v_flex().id("projects").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13);
    if (!this.repo) return panel.child(this.note(t, "No repository yet", "Focus a terminal inside a GitHub repository and its Projects show up here."));
    let body;
    if (!d) body = this.note(t, "Loading Projects…", this.repo);
    else if (d.scope) body = this.note(t, "Projects need one more permission", "gh is signed in, but its token cannot read Projects.", "gh auth refresh -h github.com -s read:project");
    else if (d.error) body = this.note(t, "Could not load Projects", d.error);
    else if (!p) body = this.note(t, "No Projects linked", `${this.repo} has no open Project linked to it.`, "gh project link <number> --repo " + this.repo);
    else body = this.mode === "table" ? this.table(p, t) : this.chart(p, t);
    return panel
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Projects"))
        .child(div().flex_1().min_w(0).text_size(11).text_color(t.dim).text_right().truncate().child(this.repo))
        .child(this.chip("refresh", this.busy ? "Syncing" : "Refresh", false, t, (_e, cx) => { this.refresh(cx); cx.notify(); })))
      .when(Boolean(p), (e) => e.child(h_flex().flex_none().p(8).gap(6).items_center().border_b(1).border_color(t.border)
        .children(d.projects.map((x) => this.chip(`project-${x.number}`, x.title, x.number === p.number, t, (_e, cx) => { this.chosen[this.repo] = x.number; localStorage.setItem("chosen", JSON.stringify(this.chosen)); cx.notify(); })))
        .child(div().flex_1())
        .child(this.chip("mode-gantt", "Roadmap", this.mode === "gantt", t, (_e, cx) => { this.mode = "gantt"; localStorage.setItem("mode", JSON.stringify({ mode: "gantt" })); cx.notify(); }))
        .child(this.chip("mode-table", "Table", this.mode === "table", t, (_e, cx) => { this.mode = "table"; localStorage.setItem("mode", JSON.stringify({ mode: "table" })); cx.notify(); }))
        .when(this.mode === "gantt", (r) => r.child(this.chip("zoom-out", "−", false, t, (_e, cx) => { this.zoom = Math.max(0, this.zoom - 1); cx.notify(); }))
          .child(this.chip("zoom-in", "+", false, t, (_e, cx) => { this.zoom = Math.min(PX.length - 1, this.zoom + 1); cx.notify(); })))))
      .when(Boolean(p) && p.total > p.items.length, (e) => e.child(div().flex_none().px(14).py(4).text_size(11).text_color(t.dim).child(`Showing the first ${p.items.length} of ${p.total} items`)))
      .child(body);
  }
}
