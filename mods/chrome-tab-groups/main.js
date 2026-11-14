// chrome-tab-groups: the mod of the herdr-chrome-tab-groups layout. MIT.
//
// The mod of the Chrome Tab Groups layout. Its main part is the Spaces list:
// spaces in colored tab groups (like Chrome's), a tab tree
// under each space, drag and drop, and right-click menus. The same module also
// draws the sidebar's top bar and footer, and its own popups: `props().view`
// picks what this copy shows.
//   "list"        (default) the sidebar list
//   "bar"         the sidebar's top bar (search + sidebar fold buttons, no logo)
//   "footer"      the sidebar footer (Settings, Add machine)
//   "space-menu"  a space's right-click menu
//   "group-menu"  a group's menu, like a Chrome tab group's: its name, colors,
//                 ungroup

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  spaces,
  panes,
  machines,
  run,
  openOverlay,
  closeOverlay,
  exec,
  hc,
  home,
  watchFolder,
  shared,
  setShared,
  props,
  theme,
  updates,
  window as hostWindow,
} from "herdr";

// ---------------------------------------------------------------- constants

const MOD = "chrome-tab-groups";
const ICON = (name) => `mods/chrome-tab-groups/icons/${name}.svg`;

const KEY_GROUPS = "chrome-tab-groups.groups";
const KEY_COLORS = "space.colors";
const LS_SHUT = "spaces.shut";
const LS_MACHINES = "machines.folded";

const COLOR_NAMES = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
// Group pill tints ("" is grey).
const GROUP = {
  "": "#dadce0",
  ansi6: "#78d9ec",
  ansi3: "#fcad70",
  ansi4: "#8ab4f8",
  ansi5: "#c58af9",
  ansi2: "#81c995",
  ansi1: "#ff8bcb",
};
const GROUP_TEXT = "#202124";
// Space avatar tiles.
const TILE = {
  ansi6: "#22a99a",
  ansi3: "#e3814f",
  ansi4: "#5b8def",
  ansi5: "#8b7cf6",
  ansi2: "#3fae6a",
  ansi1: "#d9649a",
};
const TILE_NONE = "#80868b";

const RAIL_BELOW = 160;
const DRAG_START_PX = 4;

const READ_SCRIPT = 'cat "$HOME/.config/herdr-chrome-tab-groups.json" 2>/dev/null || true';
// The JSON travels as base64 ($1) so quotes and newlines survive any machine.
const WRITE_SCRIPT =
  'f="$HOME/.config/herdr-chrome-tab-groups.json"; mkdir -p "$HOME/.config" || exit 1; ' +
  '{ printf "%s" "$1" | base64 -d > "$f.tmp" 2>/dev/null || printf "%s" "$1" | base64 -D > "$f.tmp"; } ' +
  '&& [ -s "$f.tmp" ] && mv "$f.tmp" "$f"';

const SPACE_MENU_W = 230;
const GROUP_MENU_W = 250;
// How far below a group's header its vertical line starts.
const GROUP_LINE_TOP = 4;
const NAME_ROW = 44;
const SWATCH_ROW = 34;
const MENU_ROW = 28;
const MENU_SEP = 9;
const MENU_PAD = 6;

// ---------------------------------------------------------------- small helpers

function compact(list) {
  return list.filter((x) => x !== null && x !== undefined && x !== false);
}

function basename(p) {
  const s = String(p || "").replace(/[\/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

function dirname(p) {
  const s = String(p || "").replace(/[\/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i > 0 ? s.slice(0, i) : "/";
}

function machineKey(space) {
  return space && space.machine ? space.machine : "";
}

// A space's id as its own machine knows it (remote ids carry "<machine>/").
function localIdOf(spaceId, mk) {
  if (!mk) return spaceId;
  return spaceId.startsWith(mk) ? spaceId.slice(mk.length + 1) : spaceId;
}

function groupColor(name) {
  return GROUP[name || ""] || GROUP[""];
}

function loadList(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch (_e) {
    return [];
  }
}

function saveList(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch (_e) {
    // storage is a convenience; ignore failures
  }
}

// UTF-8 text to base64, without relying on btoa/Buffer being present.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(text) {
  const bytes = [];
  for (const ch of String(text)) {
    let c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

function newGroupId() {
  return "f" + Date.now().toString(36);
}

// ---------------------------------------------------------------- group data

function normGroup(f) {
  return {
    id: String(f.id || ""),
    name: String(f.name || ""),
    color: COLOR_NAMES.includes(f.color) ? f.color : "",
    folded: !!f.folded,
  };
}

function normData(d) {
  if (!d || typeof d !== "object") return { list: [], of: {}, at: 0 };
  const list = Array.isArray(d.list) ? d.list.filter((f) => f && f.id).map(normGroup) : [];
  const of = {};
  if (d.of && typeof d.of === "object") {
    for (const k of Object.keys(d.of)) of[k] = String(d.of[k] ?? "");
  }
  return { list, of, at: Number(d.at) || 0 };
}

function allGroups() {
  const v = shared(KEY_GROUPS);
  return v && typeof v === "object" ? v : {};
}

function groupData(mk) {
  return normData(allGroups()[mk]);
}

async function writeGroupFile(mk, data) {
  const text = JSON.stringify(data, null, 2) + "\n";
  const r = await exec("sh", ["-c", WRITE_SCRIPT, "sh", toBase64(text)], { on: mk || null, timeout: 15000 });
  if (r.code !== 0) throw new Error(r.stderr || "write failed");
}

// Applies `change` to a fresh copy of a machine's groups and shares it at once.
// Returns the new data, or null when `change` returned false. The list writes
// shared groups that are newer than the file back to it on its next round.
function shareGroups(mk, change) {
  const data = groupData(mk);
  if (change(data) === false) return null;
  data.at = Date.now();
  setShared(KEY_GROUPS, { ...allGroups(), [mk]: data });
  return data;
}

// Like shareGroups, and writes the file in the background right away.
function changeGroups(mk, change, cx) {
  const data = shareGroups(mk, change);
  if (!data) return;
  cx.spawn(async () => {
    try {
      await writeGroupFile(mk, data);
    } catch (e) {
      console.log("chrome-tab-groups: could not save groups", String(e));
    }
  });
}

// The least used color among the groups, first in the palette order on ties.
function nextGroupColor(list) {
  const used = {};
  for (const c of COLOR_NAMES) used[c] = 0;
  for (const f of list) if (used[f.color] !== undefined) used[f.color] += 1;
  let best = COLOR_NAMES[0];
  for (const c of COLOR_NAMES) if (used[c] < used[best]) best = c;
  return best;
}

// ---------------------------------------------------------------- group of a space

// The group a space was put in (by drag or menu), or "" when it's in none.
function groupIdFor(space, data) {
  const v = data.of[localIdOf(space.id, machineKey(space))];
  return v && data.list.some((f) => f.id === v) ? v : "";
}

// ---------------------------------------------------------------- git

function gitDir(dir, mk) {
  if (!dir || dir === "~") return mk ? "." : home();
  if (dir.startsWith("~/")) return mk ? dir.slice(2) : home() + dir.slice(1);
  return dir;
}

function absolutize(p, base) {
  if (!p) return p;
  if (p.startsWith("/") || /^[A-Za-z]:[\/\\]/.test(p)) return p;
  return base.replace(/\/+$/, "") + "/" + p;
}

async function readGit(dir, mk) {
  const on = mk || null;
  const where = gitDir(dir, mk);
  let r = await exec(
    "git",
    ["-C", where, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--git-dir"],
    { on, timeout: 8000 },
  );
  if (r.code !== 0) {
    r = await exec("git", ["-C", where, "rev-parse", "--show-toplevel", "--git-common-dir", "--git-dir"], {
      on,
      timeout: 8000,
    });
  }
  if (r.code !== 0) return { isRepo: false };
  const [top, commonRaw, gitdirRaw] = r.stdout.trim().split("\n");
  const common = absolutize(commonRaw, where).replace(/\/+$/, "");
  const gitdir = absolutize(gitdirRaw, where).replace(/\/+$/, "");
  const repo = basename(common) === ".git" ? basename(dirname(common)) : basename(common).replace(/\.git$/, "");
  const info = { isRepo: true, top, common, linked: gitdir !== common, repo, branch: "", ahead: 0, behind: 0 };
  const s = await exec(
    "git",
    ["-C", where, "status", "--porcelain=v2", "--branch", "--untracked-files=no", "--ignore-submodules"],
    { on, timeout: 8000 },
  );
  if (s.code === 0) {
    for (const line of s.stdout.split("\n")) {
      if (line.startsWith("# branch.head ")) {
        const b = line.slice(14).trim();
        info.branch = b === "(detached)" ? "" : b;
      } else if (line.startsWith("# branch.ab ")) {
        const m = /\+(\d+) -(\d+)/.exec(line);
        if (m) {
          info.ahead = Number(m[1]);
          info.behind = Number(m[2]);
        }
      }
    }
  }
  return info;
}

// ---------------------------------------------------------------- panes

function panesByTab() {
  const map = new Map();
  for (const p of panes()) {
    if (!map.has(p.tab)) map.set(p.tab, []);
    map.get(p.tab).push(p);
  }
  return map;
}

// Where a space works: its first terminal's directory, else the space's directory.
function workdirOf(space, byTab) {
  const tabs = [...space.tabs].sort((a, b) => a.index - b.index);
  for (const tab of tabs) {
    for (const p of byTab.get(tab.id) || []) {
      if (p.terminal && p.cwd) return p.cwd;
    }
  }
  return space.folder || "~";
}

function paneLabel(p) {
  const prog = p.program || {};
  if (!p.terminal) return p.title || p.mod || "mod";
  if (prog.agent || prog.shell) return prog.name || p.title || "terminal";
  return p.title || prog.name || "terminal";
}

const URGENCY = { blocked: 3, done: 2, working: 1, idle: 0 };
function mostUrgent(list) {
  let best = null;
  for (const s of list) {
    if (s && URGENCY[s] > 0 && (best === null || URGENCY[s] > URGENCY[best])) best = s;
  }
  return best;
}

// ---------------------------------------------------------------- top bar and footer

const DEFAULT_WIDTH = 268;

function isMac() {
  try {
    return hostWindow().platform === "macos";
  } catch (_e) {
    return false;
  }
}

function updateReady() {
  try {
    const u = updates();
    return !!(u && u.app && u.app.ready);
  } catch (_e) {
    return false;
  }
}

// Keeps a press on a control from dragging the window (the bar is window_drag).
function stopPress(el) {
  return el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
}

// Draws the "bar" and "footer" views for the main view below.
class Chrome {
  constructor(footer) {
    this.footer = footer;
    this.width = 0;
  }

  onSize(size, cx) {
    if (Math.abs(size.width - this.width) < 0.5) return;
    this.width = size.width;
    // The top bar spans the sidebar, so its width is the sidebar's width.
    if (!this.footer) {
      const collapsed = this.width < RAIL_BELOW;
      if (shared("sidebar.collapsed") !== collapsed) setShared("sidebar.collapsed", collapsed);
      if (!collapsed && shared("sidebar.width") !== Math.round(this.width)) {
        setShared("sidebar.width", Math.round(this.width));
      }
    }
    cx.notify();
  }

  toggleSidebar() {
    const narrow = this.width > 0 && this.width < RAIL_BELOW;
    if (narrow) {
      const saved = Number(shared("sidebar.width"));
      const px = saved >= RAIL_BELOW ? saved : DEFAULT_WIDTH;
      run("layout.resize", { id: "sidebar", px });
      setShared("sidebar.collapsed", false);
    } else {
      if (this.width >= RAIL_BELOW) setShared("sidebar.width", Math.round(this.width));
      run("layout.resize", { id: "sidebar", px: isMac() ? 76 : 44 });
      setShared("sidebar.collapsed", true);
    }
  }

  ghostButton(id, icon, tip, action) {
    const t = theme();
    return stopPress(
      div()
        .id(id)
        .size(26)
        .flex_none()
        .rounded(6)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(tip)
        .on_click((_e, cx) => {
          action();
          cx.stop_propagation();
        })
        .child(svg(ICON(icon)).size(15).text_color(t.muted)),
    );
  }

  renderBar() {
    const mac = isMac();
    const narrow = this.width > 0 && this.width < RAIL_BELOW;
    const row = h_flex()
      .id("root")
      .on_size_change((size, cx) => this.onSize(size, cx))
      .size_full()
      .items_center()
      .pl(mac ? 76 : 8)
      .pr(narrow ? 0 : 10)
      .gap(2);
    if (narrow) {
      return row.child(this.ghostButton("bar-sidebar", "sidebar", "Show sidebar", () => this.toggleSidebar()));
    }
    return row
      .child(div().flex_1())
      .child(this.ghostButton("bar-search", "search", "Search", () => run("mod.open", { name: "picker" })))
      .child(this.ghostButton("bar-sidebar", "sidebar", "Fold sidebar", () => this.toggleSidebar()));
  }

  footerRow(id, icon, label, color, dot, action) {
    const t = theme();
    const narrow = this.width > 0 && this.width < RAIL_BELOW;
    let row = h_flex()
      .id(id)
      .h(28)
      .px(8)
      .gap(8)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .text_size(12.5)
      .text_color(color)
      .hover((s) => s.bg(t.hover))
      .on_click(() => action());
    if (narrow) row = row.justify_center().px(0).tooltip(label);
    const glyph = div()
      .relative()
      .flex_none()
      .size(14)
      .child(svg(ICON(icon)).size(14).text_color(color))
      .when(dot && narrow, (el) =>
        el.child(div().absolute().top(-2).right(-2).size(6).rounded_full().bg(t.accent)),
      );
    row = row.child(glyph);
    if (!narrow) {
      row = row.child(div().truncate().child(label));
      if (dot) row = row.child(div().flex_none().size(6).rounded_full().bg(t.accent));
    }
    return row;
  }

  renderFooter() {
    const t = theme();
    return v_flex()
      .id("root")
      .on_size_change((size, cx) => this.onSize(size, cx))
      .size_full()
      .border_t(1)
      .border_color(t.border)
      .px(8)
      .py(6)
      .gap(0)
      .child(
        this.footerRow("foot-settings", "settings", "Settings", t.foreground, updateReady(), () =>
          run("app.settings"),
        ),
      )
      .child(
        this.footerRow("foot-machine", "plus", "Add machine", t.dim, false, () =>
          run("mod.open", { name: "machine-add" }),
        ),
      );
  }

  render() {
    return this.footer ? this.renderFooter() : this.renderBar();
  }
}

// ---------------------------------------------------------------- the view

export default class ChromeTabGroups extends View {
  init(_props, cx) {
    const p = props() || {};
    this.view = p.view || "list";
    if (this.view === "bar" || this.view === "footer") {
      this.chrome = new Chrome(this.view === "footer");
      return;
    }
    if (this.view === "group-menu") {
      this.initGroupMenu(p, cx);
      return;
    }
    if (this.view !== "list") return;

    this.git = {};
    this.gitSig = {};
    this.gitBusy = false;
    this.width = 268;
    this.shut = new Set(loadList(LS_SHUT));
    this.machineFolded = new Set(loadList(LS_MACHINES));
    this.press = null;
    this.drag = null;
    this.target = null;
    this.targetKey = "";
    this.hoverPane = null;
    this.hostName = "This computer";
    this.machineInfo = {};
    this.watching = null;
    this.watchGen = 0;

    cx.spawn(async (cx) => {
      try {
        const r = await exec("hostname", ["-s"], { timeout: 5000 });
        const name = r.stdout.trim();
        if (r.code === 0 && name) {
          this.hostName = name;
          cx.notify();
        }
      } catch (_e) {
        // keep the generic name
      }
    });
    cx.spawn(async (cx) => this.loadGroups(cx));
    cx.spawn(async (cx) => this.refreshGit(cx, null));
    cx.timer.every(15000, (cx) => {
      cx.spawn(async (cx) => this.loadGroups(cx));
    });
    cx.timer.every(10000, (cx) => {
      cx.spawn(async (cx) => this.refreshGit(cx, null));
    });
    cx.timer.every(1000, (cx) => this.tick(cx));
  }

  // ------------------------------------------------------------ background work

  machineKeys() {
    const keys = [""];
    for (const m of machines()) {
      if (m.name && m.layout !== "unavailable" && !keys.includes(m.name)) keys.push(m.name);
    }
    return keys;
  }

  async loadGroups(cx) {
    try {
      const r = await hc(["machine", "ls", "--json"]);
      if (r.code === 0) {
        const parsed = JSON.parse(r.stdout || "{}");
        const list = Array.isArray(parsed) ? parsed : parsed.machines || [];
        const info = {};
        for (const m of list) if (m && m.name) info[m.name] = m;
        this.machineInfo = info;
      }
    } catch (_e) {
      // machine details are optional
    }
    for (const mk of this.machineKeys()) {
      if (mk && this.machineInfo[mk] && this.machineInfo[mk].temporary) continue;
      let text = "";
      try {
        const r = await exec("sh", ["-c", READ_SCRIPT], { on: mk || null, timeout: 15000 });
        text = r.stdout.trim();
      } catch (_e) {
        continue;
      }
      let fromFile = null;
      if (text) {
        try {
          fromFile = normData(JSON.parse(text));
        } catch (_e) {
          fromFile = null;
        }
      }
      const current = allGroups()[mk] ? groupData(mk) : null;
      if (fromFile && (!current || fromFile.at > current.at)) {
        setShared(KEY_GROUPS, { ...allGroups(), [mk]: fromFile });
      } else if (current && current.list.length && (!fromFile || current.at > fromFile.at)) {
        // The file is missing or older than what every screen sees: write it back.
        try {
          await writeGroupFile(mk, current);
        } catch (_e) {
          // try again on the next round
        }
      }
    }
    cx.notify();
  }

  async refreshGit(cx, only) {
    if (this.gitBusy) return;
    this.gitBusy = true;
    try {
      const byTab = panesByTab();
      for (const s of spaces()) {
        if (only && !only.includes(s.id)) continue;
        const mk = machineKey(s);
        const dir = workdirOf(s, byTab);
        try {
          this.git[s.id] = { ...(await readGit(dir, mk)), dir };
        } catch (_e) {
          this.git[s.id] = { isRepo: false, dir };
        }
        this.gitSig[s.id] = dir;
      }
    } finally {
      this.gitBusy = false;
    }
    cx.notify();
  }

  watchActive(cx) {
    const active = spaces().find((s) => s.active);
    if (!active || active.machine) return;
    const dir = gitDir(workdirOf(active, panesByTab()), "");
    if (dir === this.watching || dir === home()) return;
    this.watching = dir;
    const gen = ++this.watchGen;
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          await watchFolder(dir);
        } catch (_e) {
          return;
        }
        if (gen !== this.watchGen) return;
        await cx.sleep(1500);
        if (gen !== this.watchGen) return;
        const ids = spaces()
          .filter((s) => !s.machine && this.git[s.id] && gitDir(this.git[s.id].dir, "") === dir)
          .map((s) => s.id);
        if (ids.length) await this.refreshGit(cx, ids);
      }
    });
  }

  tick(cx) {
    const all = spaces();
    const ready = new Set();
    for (const m of machines()) if (m.layout === "ready") ready.add(m.name || "");
    const knownIds = new Set(all.map((s) => s.id));
    const isGone = (id) => {
      if (knownIds.has(id)) return false;
      const slash = id.indexOf("/");
      const mk = slash > 0 ? id.slice(0, slash) : "";
      return ready.has(mk);
    };

    // 1. Space colors shared with other mods.
    const colors = { ...((shared(KEY_COLORS) && typeof shared(KEY_COLORS) === "object" && shared(KEY_COLORS)) || {}) };
    let changed = false;
    for (const id of Object.keys(colors)) {
      if (isGone(id) || !COLOR_NAMES.includes(colors[id])) {
        delete colors[id];
        changed = true;
      }
    }
    for (const s of all) {
      if (colors[s.id] || s.name === "~") continue;
      const used = {};
      for (const c of COLOR_NAMES) used[c] = 0;
      for (const id of Object.keys(colors)) used[colors[id]] += 1;
      let best = COLOR_NAMES[0];
      for (const c of COLOR_NAMES) if (used[c] < used[best]) best = c;
      colors[s.id] = best;
      changed = true;
    }
    if (changed) setShared(KEY_COLORS, colors);

    // 2. Forget closed tab trees of spaces that are gone.
    let pruned = false;
    for (const id of [...this.shut]) {
      if (isGone(id)) {
        this.shut.delete(id);
        pruned = true;
      }
    }
    if (pruned) saveList(LS_SHUT, this.shut);

    // 3. Git info for spaces that moved to another directory (or are new).
    const byTab = panesByTab();
    const stale = all.filter((s) => this.gitSig[s.id] !== workdirOf(s, byTab)).map((s) => s.id);
    if (stale.length) cx.spawn(async (cx) => this.refreshGit(cx, stale));

    this.watchActive(cx);
  }

  // ------------------------------------------------------------ the model

  // Per machine: its spaces grouped into blocks. A block is a group (placed at
  // its first space, empty groups last) or a space outside any group. Each
  // entry is a top-level space with its linked worktrees nested under it.
  buildModel() {
    const all = spaces();
    const byTab = panesByTab();
    const keys = [];
    for (const s of all) if (!keys.includes(machineKey(s))) keys.push(machineKey(s));
    for (const m of machines()) {
      const k = m.name || "";
      if (k && this.machineInfo[k] && this.machineInfo[k].temporary) continue;
      if (!keys.includes(k)) keys.push(k);
    }
    if (!keys.includes("")) keys.unshift("");
    const status = {};
    for (const m of machines()) status[m.name || ""] = m.layout;

    return keys.map((mk) => {
      const data = groupData(mk);
      const ss = all.filter((s) => machineKey(s) === mk);
      const parent = {};
      for (const s of ss) {
        const g = this.git[s.id];
        if (!g || !g.isRepo || !g.linked) continue;
        const main = ss.find((o) => {
          const og = this.git[o.id];
          return o !== s && og && og.isRepo && !og.linked && og.common === g.common;
        });
        if (main) parent[s.id] = main.id;
      }
      const entries = [];
      const byId = {};
      for (const s of ss) {
        if (parent[s.id]) continue;
        const e = { space: s, children: [], dir: workdirOf(s, byTab) };
        byId[s.id] = e;
        entries.push(e);
      }
      for (const s of ss) if (parent[s.id] && byId[parent[s.id]]) byId[parent[s.id]].children.push(s);

      const blocks = [];
      const groupBlocks = {};
      for (const e of entries) {
        const fid = groupIdFor(e.space, data);
        e.groupId = fid;
        if (fid) {
          if (!groupBlocks[fid]) {
            const group = data.list.find((f) => f.id === fid);
            groupBlocks[fid] = { kind: "group", key: "f:" + fid, group, entries: [] };
            blocks.push(groupBlocks[fid]);
          }
          groupBlocks[fid].entries.push(e);
        } else {
          blocks.push({ kind: "space", key: "s:" + e.space.id, entries: [e] });
        }
      }
      for (const f of data.list) {
        if (!groupBlocks[f.id]) blocks.push({ kind: "group", key: "f:" + f.id, group: f, entries: [] });
      }
      return {
        mk,
        name: mk || this.hostName,
        status: mk ? status[mk] || "loading" : "ready",
        data,
        spaces: ss,
        blocks,
      };
    });
  }

  // Every space of a block in Herdr's order.
  blockSpaceIds(block) {
    const ids = [];
    for (const e of block.entries) {
      ids.push(e.space.id);
      for (const c of e.children) ids.push(c.id);
    }
    const order = spaces().map((s) => s.id);
    return ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  // Moves `ids` (in that order) so they sit together at `anchor` with one
  // space.move each, top down. anchor: {before: id} | {after: id} | {end: mk}.
  moveTogether(ids, anchor) {
    const order = spaces().map((s) => s.id);
    const machineOf = {};
    for (const s of spaces()) machineOf[s.id] = machineKey(s);
    let prev = null;
    for (const id of ids) {
      const cur = order.indexOf(id);
      if (cur < 0) continue;
      order.splice(cur, 1);
      let at;
      if (prev !== null) {
        at = order.indexOf(prev) + 1;
      } else if (anchor.before) {
        at = order.indexOf(anchor.before);
      } else if (anchor.after) {
        const i = order.indexOf(anchor.after);
        at = i < 0 ? -1 : i + 1;
      } else {
        let last = -1;
        order.forEach((o, i) => {
          if (machineOf[o] === anchor.end) last = i;
        });
        at = last < 0 ? cur : last + 1;
      }
      if (at < 0) at = cur;
      order.splice(at, 0, id);
      if (at !== cur) run("space.move", { id, index: at + 1 });
      prev = id;
    }
  }

  // ------------------------------------------------------------ drag and drop

  resetPointer() {
    this.press = null;
    this.drag = null;
    this.target = null;
    this.targetKey = "";
  }

  pressSpace(space, tree, mk, e) {
    this.resetPointer();
    this.press = { kind: "space", id: space.id, tree, mk, x: e.position.x, y: e.position.y };
  }

  pressGroup(group, mk, e) {
    this.resetPointer();
    this.press = { kind: "group", id: group.id, mk, x: e.position.x, y: e.position.y };
  }

  listMove(e, cx) {
    if (!this.press || this.drag) return;
    const dx = e.position.x - this.press.x;
    const dy = e.position.y - this.press.y;
    if (dx * dx + dy * dy >= DRAG_START_PX * DRAG_START_PX) {
      this.drag = this.press;
      cx.notify();
    }
  }

  setTarget(target, cx) {
    const key = target ? JSON.stringify(target) : "";
    if (key === this.targetKey) return;
    this.target = target;
    this.targetKey = key;
    cx.notify();
  }

  // info: { mk, kind: "space" | "tabs" | "group", spaceId?, groupId, blockKey, firstRow }
  rowMove(info, e, cx) {
    const d = this.drag;
    if (!d) return;
    const h = (e.bounds && e.bounds.height) || 30;
    const upper = e.local_position.y < h / 2;
    let t = null;
    if (info.mk === d.mk) {
      if (d.kind === "space") {
        if (info.kind === "group") {
          t = { kind: "group", group: info.groupId };
        } else if (!d.tree.includes(info.spaceId)) {
          t = {
            kind: "line",
            at: "space",
            ref: info.spaceId,
            after: info.kind === "tabs" || !upper,
            group: info.groupId,
          };
        }
      } else if (info.blockKey !== "f:" + d.id) {
        t = { kind: "line", at: "block", block: info.blockKey, after: !(info.firstRow && upper) };
      }
    }
    this.setTarget(t, cx);
  }

  endMove(cx) {
    if (!this.drag) return;
    this.setTarget({ kind: "line", at: "end", mk: this.drag.mk }, cx);
  }

  finishDrag(cx) {
    const d = this.drag;
    const t = this.target;
    this.resetPointer();
    if (d && t) {
      if (d.kind === "space") this.dropSpace(d, t, cx);
      else this.dropGroup(d, t);
    }
    cx.notify();
  }

  dropSpace(d, t, cx) {
    const model = this.buildModel().find((m) => m.mk === d.mk);
    if (!model) return;
    const lid = localIdOf(d.id, d.mk);
    let group = "";
    let anchor = null;
    if (t.kind === "group") {
      group = t.group;
      const block = model.blocks.find((b) => b.key === "f:" + t.group);
      const members = block ? this.blockSpaceIds(block).filter((id) => !d.tree.includes(id)) : [];
      if (members.length) anchor = { after: members[members.length - 1] };
    } else if (t.at === "end") {
      group = "";
      anchor = { end: d.mk };
    } else if (t.at === "space") {
      group = t.group || "";
      if (!t.after) {
        anchor = { before: t.ref };
      } else {
        let tree = [t.ref];
        for (const b of model.blocks) {
          for (const e of b.entries) if (e.space.id === t.ref) tree = [t.ref, ...e.children.map((c) => c.id)];
        }
        const order = spaces().map((s) => s.id);
        tree.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        anchor = { after: tree[tree.length - 1] };
      }
    }
    changeGroups(
      d.mk,
      (data) => {
        if (data.of[lid] === group) return false;
        data.of[lid] = group;
      },
      cx,
    );
    if (anchor) {
      const order = spaces().map((s) => s.id);
      const ids = [...d.tree].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      this.moveTogether(ids, anchor);
    }
  }

  dropGroup(d, t) {
    const model = this.buildModel().find((m) => m.mk === d.mk);
    if (!model) return;
    const own = model.blocks.find((b) => b.key === "f:" + d.id);
    if (!own) return;
    const members = this.blockSpaceIds(own);
    if (!members.length) return;
    let anchor = { end: d.mk };
    if (t.at === "block") {
      const block = model.blocks.find((b) => b.key === t.block);
      const ids = block ? this.blockSpaceIds(block) : [];
      if (ids.length) anchor = t.after ? { after: ids[ids.length - 1] } : { before: ids[0] };
    }
    this.moveTogether(members, anchor);
  }

  // ------------------------------------------------------------ actions

  selectPane(space, tab, pane) {
    if (!space.active) run("space.select", { id: space.id });
    run("tab.select", { id: tab.id });
    if (pane) run("pane.focus", { pane: pane.pane });
  }

  toggleShut(id) {
    if (this.shut.has(id)) this.shut.delete(id);
    else this.shut.add(id);
    saveList(LS_SHUT, this.shut);
  }

  toggleGroup(mk, groupId, cx) {
    changeGroups(
      mk,
      (d) => {
        const f = d.list.find((x) => x.id === groupId);
        if (!f) return false;
        f.folded = !f.folded;
      },
      cx,
    );
  }

  toggleMachine(mk) {
    if (this.machineFolded.has(mk)) this.machineFolded.delete(mk);
    else this.machineFolded.add(mk);
    saveList(LS_MACHINES, this.machineFolded);
  }

  openSpaceMenu(space, entryGroupId, mk) {
    const g = this.git[space.id] || {};
    const data = groupData(mk);
    const others = data.list.filter((f) => f.id !== entryGroupId).length;
    let rows = 1 + others + (entryGroupId ? 1 : 0) + 1 + 1;
    if (g.isRepo) rows += 2 + (g.linked ? 1 : 0);
    const height = MENU_PAD * 2 + rows * MENU_ROW + 2 * MENU_SEP + 2;
    openOverlay({
      mod: MOD,
      kind: "popup",
      width: SPACE_MENU_W,
      height,
      props: {
        view: "space-menu",
        space: space.id,
        name: space.name,
        machine: mk,
        group: entryGroupId || "",
        repo: !!g.isRepo,
        linked: !!g.linked,
      },
    });
  }

  openGroupMenu(group, mk) {
    const height = MENU_PAD * 2 + NAME_ROW + SWATCH_ROW + MENU_SEP + MENU_ROW + 2;
    openOverlay({
      mod: MOD,
      kind: "popup",
      width: GROUP_MENU_W,
      height,
      props: { view: "group-menu", machine: mk, group: group.id },
    });
  }

  // Like Chrome's "Add tab to new group": makes an unnamed group at once (with
  // the space in it, if any) and opens its menu to name it.
  openNewGroup(mk, cx, spaceId) {
    const group = { id: newGroupId(), name: "", color: "", folded: false };
    changeGroups(
      mk,
      (d) => {
        group.color = nextGroupColor(d.list);
        d.list.push(group);
        if (spaceId) d.of[localIdOf(spaceId, mk)] = group.id;
      },
      cx,
    );
    this.openGroupMenu(group, mk);
  }

  newSpace(mk) {
    if (mk) run("space.new", { machine: mk });
    else run("space.new", {});
  }

  // ------------------------------------------------------------ list pieces

  iconButton(id, icon, tip, action, color, size) {
    const t = theme();
    const c = color || t.dim;
    return div()
      .id(id)
      .size(size || 22)
      .flex_none()
      .rounded(6)
      .flex()
      .items_center()
      .justify_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => {
        if (!this.drag) cx.stop_propagation();
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action(cx);
        cx.notify();
      })
      .child(svg(ICON(icon)).size(14).text_color(c));
  }

  statusMark(status, size) {
    const t = theme();
    if (status === "working") {
      return svg(ICON("spinner"))
        .size(size || 11)
        .flex_none()
        .text_color(t.working)
        .spin(900);
    }
    if (status === "blocked" || status === "done") {
      return div().flex_none().size(7).rounded_full().bg(t[status]);
    }
    return null;
  }

  programIcon(p) {
    const t = theme();
    const prog = p.program || {};
    if (prog.icon) {
      return prog.tint ? svg(prog.icon).size(13).flex_none().text_color(t.muted) : image(prog.icon).size(13).flex_none();
    }
    return svg(ICON("terminal")).size(13).flex_none().text_color(t.dim);
  }

  line(after) {
    const t = theme();
    const l = div().absolute().left(0).right(0).h(2).rounded(1).bg(t.accent);
    return after ? l.bottom(-1) : l.top(-1);
  }

  spaceTile(space, size, text) {
    const colors = shared(KEY_COLORS) || {};
    const bg = TILE[colors[space.id]] || TILE_NONE;
    const letter = (space.name || "?").trim().charAt(0).toUpperCase() || "?";
    return div()
      .size(size)
      .flex_none()
      .rounded(5)
      .bg(bg)
      .flex()
      .items_center()
      .justify_center()
      .text_size(text)
      .font_bold()
      .text_color("#ffffff")
      .child(letter);
  }

  spaceRow(space, ctx) {
    const t = theme();
    const g = this.git[space.id] || {};
    const child = !!ctx.connector;
    const shut = this.shut.has(space.id);
    const info = {
      mk: ctx.mk,
      kind: "space",
      spaceId: space.id,
      groupId: ctx.groupId,
      blockKey: ctx.blockKey,
      firstRow: ctx.firstRow,
    };
    const branch = g.branch || space.branch || "";
    const repo = g.repo || "";
    const showRepo = repo && !space.name.toLowerCase().includes(repo.toLowerCase());
    const meta = compact([
      showRepo ? div().flex_none().child(repo) : null,
      showRepo && branch ? div().flex_none().child("·") : null,
      branch ? div().min_w(0).truncate().child(branch) : null,
      g.ahead ? div().flex_none().text_color(t.ansi2).child("↑" + g.ahead) : null,
      g.behind ? div().flex_none().text_color(t.ansi1).child("↓" + g.behind) : null,
    ]);

    let row = h_flex()
      .id("sp-" + space.id)
      .h(child ? 28 : 30)
      .pl(child ? 4 : 6)
      .pr(2)
      .gap(7)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .when(space.active, (el) => el.bg(t.selected))
      .when(!space.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_mouse_down("left", (e, _cx) => this.pressSpace(space, ctx.tree, ctx.mk, e))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.resetPointer();
        this.openSpaceMenu(space, ctx.groupId, ctx.mk);
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.drag || !this.press || this.press.id !== space.id) return;
        this.resetPointer();
        run("space.select", { id: space.id });
        this.toggleShut(space.id);
        cx.notify();
      })
      .on_mouse_move((e, cx) => this.rowMove(info, e, cx));

    if (child) {
      row = row
        .child(div().flex_none().w(16).text_size(12).text_color(t.dim).child(ctx.connector))
        .child(svg(ICON("branch")).size(12).flex_none().text_color(t.dim));
    }
    return row
      .child(this.spaceTile(space, 18, 11))
      .child(div().max_w(150).truncate().text_size(13).text_color(t.foreground).child(space.name))
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .justify_end()
          .gap(4)
          .text_size(11.5)
          .text_color(t.dim)
          .overflow_hidden()
          .children(meta),
      )
      .child(
        this.iconButton(
          "spchev-" + space.id,
          shut ? "chevron-right" : "chevron-down",
          shut ? "Show tabs" : "Hide tabs",
          () => this.toggleShut(space.id),
          t.dim,
          20,
        ),
      );
  }

  tabRows(space, ctx, byTab) {
    const t = theme();
    const tabs = [...space.tabs].sort((a, b) => a.index - b.index);
    const indent = ctx.connector ? 30 : 12;
    const info = {
      mk: ctx.mk,
      kind: "tabs",
      spaceId: space.id,
      groupId: ctx.groupId,
      blockKey: ctx.blockKey,
      firstRow: false,
    };
    return tabs.map((tab, i) => {
      const glyph = i === tabs.length - 1 ? "└" : "├";
      const ps = byTab.get(tab.id) || [];
      const connector = div().flex_none().w(10).text_size(12).text_color(t.dim).child(glyph);
      if (ps.length >= 2) {
        return h_flex()
          .id("tabrow-" + tab.id)
          .h(30)
          .pl(indent)
          .pr(2)
          .gap(6)
          .items_center()
          .on_mouse_move((e, cx) => this.rowMove(info, e, cx))
          .child(connector)
          .child(
            h_flex()
              .flex_1()
              .min_w(0)
              .gap(4)
              .items_center()
              .children(ps.map((p) => this.pill(space, tab, p))),
          );
      }
      const p = ps[0] || null;
      const lit = !!(p && space.active && tab.active && p.focused);
      return h_flex()
        .id("tab-" + tab.id)
        .h(24)
        .pl(indent)
        .pr(8)
        .gap(6)
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .text_size(12)
        .text_color(lit ? t.foreground : t.muted)
        .when(lit, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_mouse_move((e, cx) => this.rowMove(info, e, cx))
        .on_click((_e, cx) => {
          if (this.drag) return;
          this.selectPane(space, tab, p);
          cx.notify();
        })
        .children(
          compact([
            connector,
            p ? this.programIcon(p) : null,
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .child(p ? paneLabel(p) : tab.name),
            this.statusMark(p ? p.status : tab.status),
          ]),
        );
    });
  }

  pill(space, tab, p) {
    const t = theme();
    const lit = space.active && tab.active && p.focused;
    const showClose = lit || this.hoverPane === p.pane;
    return h_flex()
      .id("pill-" + p.pane)
      .flex_1()
      .min_w(0)
      .h(24)
      .pl(6)
      .pr(showClose ? 2 : 6)
      .gap(5)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .text_size(12)
      .text_color(lit ? t.foreground : t.muted)
      .when(lit, (el) => el.bg(t.selected))
      .when(!lit, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((hovered, cx) => {
        if (hovered) this.hoverPane = p.pane;
        else if (this.hoverPane === p.pane) this.hoverPane = null;
        cx.notify();
      })
      .on_click((_e, cx) => {
        if (this.drag) return;
        this.selectPane(space, tab, p);
        cx.notify();
      })
      .children(
        compact([
          this.programIcon(p),
          div().flex_1().min_w(0).truncate().child(paneLabel(p)),
          this.statusMark(p.status),
          showClose
            ? div()
                .id("pillx-" + p.pane)
                .size(18)
                .flex_none()
                .rounded(5)
                .flex()
                .items_center()
                .justify_center()
                .hover((s) => s.bg(t.hover))
                .tooltip("Close pane")
                .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                .on_click((_e, cx) => {
                  cx.stop_propagation();
                  run("pane.close", { pane: p.pane });
                })
                .child(svg(ICON("close")).size(11).text_color(t.muted))
            : null,
        ]),
      );
  }

  // A space with its tab tree (and, for a top-level entry, its worktrees).
  spaceTree(space, ctx, byTab, children) {
    const t = this.target;
    const kids = children || [];
    const parts = [this.spaceRow(space, ctx)];
    if (!this.shut.has(space.id)) parts.push(...this.tabRows(space, ctx, byTab));
    kids.forEach((c, i) => {
      parts.push(
        this.spaceTree(
          c,
          {
            ...ctx,
            connector: i === kids.length - 1 ? "└─" : "├─",
            tree: [c.id],
            firstRow: false,
          },
          byTab,
          null,
        ),
      );
    });
    const lineHere = t && t.kind === "line" && t.at === "space" && t.ref === space.id;
    return v_flex()
      .relative()
      .children(parts)
      .when(lineHere, (el) => el.child(this.line(t.after)));
  }

  groupHeader(block, m) {
    const t = theme();
    const f = block.group;
    const bg = groupColor(f.color);
    const isTarget = this.target && this.target.kind === "group" && this.target.group === f.id;
    const info = { mk: m.mk, kind: "group", groupId: f.id, blockKey: block.key, firstRow: true };
    let mark = null;
    if (f.folded) {
      // A spinner if anything inside is working, else a dot for blocked / done.
      const sts = [];
      const byTab = panesByTab();
      const collect = (s) => {
        sts.push(s.status);
        for (const tab of s.tabs) {
          sts.push(tab.status);
          for (const p of byTab.get(tab.id) || []) sts.push(p.status);
        }
      };
      for (const e of block.entries) {
        collect(e.space);
        e.children.forEach(collect);
      }
      mark = this.statusMark(sts.includes("working") ? "working" : mostUrgent(sts));
    }
    return h_flex()
      .id("fh-" + m.mk + "-" + f.id)
      .h(30)
      .pl(10)
      .pr(4)
      .gap(6)
      .items_center()
      .rounded(10)
      .bg(bg)
      .border(1)
      .border_color(isTarget ? t.accent : bg)
      .text_color(GROUP_TEXT)
      .cursor_pointer()
      .on_mouse_down("left", (e, _cx) => this.pressGroup(f, m.mk, e))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.resetPointer();
        this.openGroupMenu(f, m.mk);
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.drag || !this.press || this.press.id !== f.id) return;
        this.resetPointer();
        this.toggleGroup(m.mk, f.id, cx);
        cx.notify();
      })
      .on_mouse_move((e, cx) => this.rowMove(info, e, cx))
      .children(
        compact([
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_size(12.5)
            .font_semibold()
            .child(f.name),
          mark,
          this.iconButton("fmore-" + m.mk + "-" + f.id, "more", "Group menu", () => this.openGroupMenu(f, m.mk), GROUP_TEXT, 22),
          this.iconButton(
            "fchev-" + m.mk + "-" + f.id,
            f.folded ? "chevron-right" : "chevron-down",
            f.folded ? "Unfold" : "Fold",
            (cx) => this.toggleGroup(m.mk, f.id, cx),
            GROUP_TEXT,
            22,
          ),
        ]),
      );
  }

  renderBlock(block, m, byTab) {
    const t = this.target;
    const lineHere = t && t.kind === "line" && t.at === "block" && t.block === block.key;
    if (block.kind === "space") {
      const e = block.entries[0];
      const ctx = {
        mk: m.mk,
        groupId: "",
        blockKey: block.key,
        firstRow: true,
        tree: [e.space.id, ...e.children.map((c) => c.id)],
      };
      return v_flex()
        .relative()
        .child(this.spaceTree(e.space, ctx, byTab, e.children))
        .when(lineHere, (el) => el.child(this.line(t.after)));
    }
    const f = block.group;
    const body = block.entries.map((e) =>
      this.spaceTree(
        e.space,
        {
          mk: m.mk,
          groupId: f.id,
          blockKey: block.key,
          firstRow: false,
          tree: [e.space.id, ...e.children.map((c) => c.id)],
        },
        byTab,
        e.children,
      ),
    );
    return v_flex()
      .relative()
      .child(this.groupHeader(block, m))
      .when(!f.folded && body.length > 0, (el) =>
        el.child(
          v_flex()
            .relative()
            .ml(8)
            .mt(2)
            .mb(4)
            .pl(6)
            .gap(1)
            // The group's line, starting a little below the header.
            .child(div().absolute().left(0).top(GROUP_LINE_TOP).bottom(0).w(2).bg(groupColor(f.color)))
            .children(body),
        ),
      )
      .when(lineHere, (el) => el.child(this.line(t.after)));
  }

  machineHeader(m) {
    const t = theme();
    const folded = this.machineFolded.has(m.mk);
    const dot = m.status === "ready" ? t.ansi2 : m.status === "unavailable" ? t.blocked : t.dim;
    return h_flex()
      .id("mh-" + (m.mk || "local"))
      .h(26)
      .mt(4)
      .pl(6)
      .pr(2)
      .gap(6)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .text_size(12)
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, _cx) => this.resetPointer())
      .on_click((_e, cx) => {
        this.toggleMachine(m.mk);
        cx.notify();
      })
      .child(svg(ICON(m.mk ? "server" : "monitor")).size(13).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(m.name))
      .child(this.iconButton("mnf-" + (m.mk || "local"), "group-plus", "New group", (cx) => this.openNewGroup(m.mk, cx), t.dim, 20))
      .child(this.iconButton("mns-" + (m.mk || "local"), "plus", "New space", () => this.newSpace(m.mk), t.dim, 20))
      .child(div().flex_none().size(6).mx(3).rounded_full().bg(dot))
      .child(svg(ICON(folded ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim));
  }

  renderList(model) {
    const t = theme();
    const byTab = panesByTab();
    const multi = model.length > 1;
    const rows = [];
    for (const m of model) {
      if (multi) rows.push(this.machineHeader(m));
      if (multi && this.machineFolded.has(m.mk)) continue;
      for (const b of m.blocks) rows.push(this.renderBlock(b, m, byTab));
    }
    const endLine = this.target && this.target.kind === "line" && this.target.at === "end";
    rows.push(
      div()
        .id("space-end")
        .relative()
        .flex_1()
        .min_h(24)
        .on_mouse_move((_e, cx) => this.endMove(cx))
        .when(endLine, (el) => el.child(this.line(false))),
    );
    return v_flex()
      .id("root")
      .on_size_change((size, cx) => this.onSize(size, cx))
      .size_full()
      .child(
        h_flex()
          .h(31)
          .flex_none()
          .pl(14)
          .pr(8)
          .gap(2)
          .items_center()
          .child(div().flex_1().text_size(11.5).text_color(t.dim).child("Spaces"))
          .child(this.iconButton("new-group", "group-plus", "New group", (cx) => this.openNewGroup("", cx), t.dim, 22))
          .child(this.iconButton("new-space", "plus", "New space", () => this.newSpace(""), t.dim, 22)),
      )
      .child(
        v_flex()
          .id("space-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .px(8)
          .gap(1)
          // A press while a drag is still recorded means its release happened
          // outside the list: forget it. (Rows record their own press before this.)
          .on_mouse_down("left", (_e, cx) => {
            if (this.drag) {
              this.resetPointer();
              cx.notify();
            }
          })
          .on_mouse_move((e, cx) => this.listMove(e, cx))
          .on_mouse_up("left", (_e, cx) => this.finishDrag(cx))
          .children(rows),
      );
  }

  // The rail: numbered compact rows and group tiles.
  renderRail(model) {
    const t = theme();
    const items = [];
    let n = 0;
    const compactRow = (s, mk, groupId) => {
      n += 1;
      const mark =
        s.status === "working"
          ? svg(ICON("spinner")).size(9).text_color(t.working).spin(900)
          : s.status === "blocked" || s.status === "done"
            ? div().size(6).rounded_full().bg(t[s.status])
            : null;
      return h_flex()
        .id("rail-" + s.id)
        .relative()
        .w(32)
        .h(26)
        .flex_none()
        .rounded(7)
        .items_center()
        .justify_center()
        .cursor_pointer()
        .text_size(11.5)
        .font_semibold()
        .text_color(s.active ? t.foreground : t.muted)
        .when(s.active, (el) => el.bg(t.selected))
        .when(!s.active, (el) => el.hover((st) => st.bg(t.hover)))
        .tooltip(s.name)
        .on_click((_e, cx) => {
          run("space.select", { id: s.id });
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          this.openSpaceMenu(s, groupId, mk);
        })
        .child(String(n))
        .when(!!mark, (el) => el.child(div().absolute().top(2).right(2).child(mark)));
    };
    for (const m of model) {
      for (const b of m.blocks) {
        if (b.kind === "group") {
          const f = b.group;
          items.push(
            div()
              .id("railf-" + m.mk + "-" + f.id)
              .size(18)
              .my(4)
              .flex_none()
              .rounded(5)
              .bg(groupColor(f.color))
              .cursor_pointer()
              .tooltip(f.name || "Group")
              .on_click((_e, cx) => this.toggleGroup(m.mk, f.id, cx))
              .on_mouse_down("right", (_e, cx) => {
                cx.stop_propagation();
                this.openGroupMenu(f, m.mk);
              }),
          );
          if (f.folded) continue;
        }
        for (const e of b.entries) {
          items.push(compactRow(e.space, m.mk, e.groupId));
          for (const c of e.children) items.push(compactRow(c, m.mk, e.groupId));
        }
      }
    }
    return v_flex()
      .id("root")
      .on_size_change((size, cx) => this.onSize(size, cx))
      .size_full()
      .items_center()
      .child(
        h_flex()
          .h(31)
          .flex_none()
          .items_center()
          .child(this.iconButton("new-space", "plus", "New space", () => this.newSpace(""), t.dim, 26)),
      )
      .child(
        v_flex()
          .id("rail-list")
          .flex_1()
          .min_h(0)
          .w_full()
          .items_center()
          .gap(2)
          .overflow_y_scroll()
          .children(items),
      );
  }

  onSize(size, cx) {
    if (Math.abs(size.width - this.width) < 0.5) return;
    this.width = size.width;
    cx.notify();
  }

  // ------------------------------------------------------------ overlays

  menuRow(id, label, action, opts) {
    const t = theme();
    const o = opts || {};
    return h_flex()
      .id(id)
      .h(MENU_ROW)
      .flex_none()
      .px(10)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .text_size(13)
      .text_color(o.danger ? t.blocked : t.foreground)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => action(cx))
      .children(
        compact([
          o.dot ? div().flex_none().size(9).rounded_full().bg(o.dot) : null,
          div().flex_1().min_w(0).truncate().child(label),
        ]),
      );
  }

  menuSep() {
    const t = theme();
    return div().h(1).flex_none().mx(6).my(4).bg(t.border);
  }

  closeSelf() {
    const p = props() || {};
    if (p.overlay) closeOverlay(p.overlay);
  }

  renderSpaceMenu() {
    const p = props() || {};
    const mk = p.machine || "";
    const data = groupData(mk);
    const lid = localIdOf(p.space, mk);
    const items = [
      this.menuRow("m-new-group", "Add to new group", (cx) => {
        this.closeSelf();
        this.openNewGroup(mk, cx, p.space);
      }),
    ];
    for (const f of data.list) {
      if (f.id === p.group) continue;
      items.push(
        this.menuRow(
          "m-move-" + f.id,
          "Move to " + (f.name || "Group"),
          (cx) => {
            changeGroups(mk, (d) => void (d.of[lid] = f.id), cx);
            this.closeSelf();
          },
          { dot: groupColor(f.color) },
        ),
      );
    }
    if (p.group) {
      items.push(
        this.menuRow("m-remove", "Remove from group", (cx) => {
          changeGroups(mk, (d) => void (d.of[lid] = ""), cx);
          this.closeSelf();
        }),
      );
    }
    items.push(this.menuSep());
    items.push(
      this.menuRow("m-rename", "Rename", () => {
        this.closeSelf();
        run("space.rename", { id: p.space });
      }),
    );
    const worktree = (action) => () => {
      this.closeSelf();
      const size = action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 };
      openOverlay({ mod: "worktree", kind: "dialog", ...size, props: { space: p.space, action } });
    };
    if (p.repo) {
      items.push(this.menuRow("m-wt-new", "New worktree", worktree("new")));
      items.push(this.menuRow("m-wt-open", "Open worktree", worktree("open")));
      if (p.linked) items.push(this.menuRow("m-wt-remove", "Remove worktree", worktree("remove")));
    }
    items.push(this.menuSep());
    items.push(
      this.menuRow(
        "m-close",
        "Close",
        () => {
          this.closeSelf();
          run("space.close", { id: p.space });
        },
        { danger: true },
      ),
    );
    return v_flex().id("root").size_full().p(MENU_PAD).children(items);
  }

  initGroupMenu(p, cx) {
    const mk = p.machine || "";
    const f = groupData(mk).list.find((x) => x.id === p.group);
    this.nameIn = InputState.new({ placeholder: "Name this group", value: f ? f.name : "" });
    // Renames as you type, like Chrome. Only shared here: a popup can close at any
    // moment, and the list writes the file from the shared groups.
    this.nameIn.on("change", (_e, cx) => {
      const name = this.nameIn.value();
      shareGroups(mk, (d) => {
        const x = d.list.find((y) => y.id === p.group);
        if (!x || x.name === name) return false;
        x.name = name;
      });
      cx.notify();
    });
    this.nameIn.on("submit", (_e, cx) => {
      const name = this.nameIn.value().trim();
      changeGroups(mk, (d) => {
        const x = d.list.find((y) => y.id === p.group);
        if (!x) return false;
        x.name = name;
      }, cx);
      this.closeSelf();
    });
    try {
      this.nameIn.focus();
    } catch (_e) {
      // focus is a nicety
    }
  }

  renderGroupMenu() {
    const t = theme();
    const p = props() || {};
    const mk = p.machine || "";
    const data = groupData(mk);
    const f = data.list.find((x) => x.id === p.group);
    if (!f) return v_flex().id("root").size_full().p(10).text_size(12).text_color(t.dim).child("Group is gone");
    const swatches = ["", ...COLOR_NAMES].map((c) => {
      const current = f.color === c;
      return div()
        .id("sw-" + (c || "grey"))
        .size(22)
        .flex_none()
        .rounded_full()
        .when(current, (el) => el.border(2).border_color(groupColor(c)))
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .on_click((_e, cx) => {
          changeGroups(
            mk,
            (d) => {
              const x = d.list.find((y) => y.id === f.id);
              if (!x || x.color === c) return false;
              x.color = c;
            },
            cx,
          );
          cx.notify();
        })
        .child(div().size(current ? 12 : 18).rounded_full().bg(groupColor(c)));
    });
    return v_flex()
      .id("root")
      .size_full()
      .p(MENU_PAD)
      .child(
        div()
          .h(NAME_ROW)
          .flex_none()
          .px(4)
          .pt(4)
          .child(
            Input.new(this.nameIn)
              .h(34)
              .px(10)
              .rounded(8)
              .border(2)
              .border_color(t.accent)
              .bg(t.background)
              .text_size(13)
              .text_color(t.foreground),
          ),
      )
      .child(h_flex().h(SWATCH_ROW).flex_none().px(6).items_center().justify_between().children(swatches))
      .child(this.menuSep())
      .child(
        // Like Chrome's "Ungroup": the group goes, its spaces stay.
        this.menuRow("fm-ungroup", "Ungroup", (cx) => {
          changeGroups(
            mk,
            (d) => {
              d.list = d.list.filter((x) => x.id !== f.id);
              for (const k of Object.keys(d.of)) if (d.of[k] === f.id) delete d.of[k];
            },
            cx,
          );
          this.closeSelf();
        }),
      );
  }

  // ------------------------------------------------------------ render

  render() {
    if (this.chrome) return this.chrome.render();
    if (this.view === "space-menu") return this.renderSpaceMenu();
    if (this.view === "group-menu") return this.renderGroupMenu();
    const model = this.buildModel();
    if (this.width > 0 && this.width < RAIL_BELOW) return this.renderRail(model);
    return this.renderList(model);
  }
}
