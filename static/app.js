"use strict";
// Three-column notes prototype: tree | note tabs | links & suggestions. Talks to app/server.py.
// md.js (loaded first) renders Markdown and reads window.TREE.

const $ = (s, el = document) => el.querySelector(s);
const TYPE_ZH = { concept: T("概念"), entity: T("人物・實體"), source: T("來源"), analysis: T("分析"), overview: T("總覽") };
const TYPE_ORDER = ["concept", "entity", "source", "analysis", "overview"];
const QUEUE_LABEL = { "ingest": T("建議整理"), "continue a work": T("接著整理（同一本書已開始）"), "check": T("Jev 沒把握：請你先看看值不值得整理"),
  "duplicate?": T("可能和別篇重複"), "reconvert": T("轉檔不完整，要重新轉"), "skip (no content)": T("沒有內容") };
// Jev in plain words: the people using Lumen may never have heard of it, nor of probabilities
const pct = p => Math.round(p * 100) + "%";
const JEV_WHAT = T("Jev 是 Lumen 用來做小判斷的 AI。每次只問它一個固定的問題，例如「這篇值不值得整理」「這個詞指的是不是這一頁」，它回答「是」的機會有多大，用百分比表示。80% 以上，Lumen 照它的答案做；20% 以下，當作「不是」；中間的標成「待確認」，請你自己看一眼。它會出錯，所以只用來排順序、提醒你，最後由你決定。");
const jevWhat = () => '<details class="what help"><summary>' + T("Jev 是什麼？") + "</summary><p>" + JEV_WHAT + "</p></details>";
const REL_WORD = [T("和知識庫現有的主題都無關，整理它等於開一個新主題"), T("只順帶提到知識庫裡有的人或概念"),
  T("和知識庫裡的主題相同，能補上新的論點、例子或資料"), T("是知識庫好幾頁都在談的原著或重要研究")];
const SUB_WORD = [T("幾乎沒有內容（封面、目錄、幾行字）"), T("短文或簡介"), T("完整的文章、章節或訪談")];
function triageExplain(t) {
  if (!t || t.priority == null) return "";
  let h = T("排序分數 ") + t.priority + T(" 分：分數越高，在「待整理」清單排越前面。");
  if (t.relevance != null && t.substance != null) {
    h += "<br>" + T("和知識庫的關係：") + esc(REL_WORD[t.relevance] || "") + T("（") + t.relevance + T(" 分，最高 3，算三倍）") +
      "<br>" + T("內容多少：") + esc(SUB_WORD[t.substance] || "") + T("（") + t.substance + T(" 分，最高 2）");
    if (t.decision === "continue a work") h += "<br>" + T("同一本書已經開始整理：再加 2 分");
  }
  return '<div class="note-line help">' + h + "</div>";
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const S = {
  tree: null, rawRoot: null, sideTab: store.get("side-tab", "raw"), rawMode: store.get("raw-mode", "tree"), results: null,
  locked: new Set(store.get("locked-notes", [])),   // notes locked to reading; every other editable note opens ready to type in
  open: new Set(store.get("open-folders", [])), queueOpen: new Set(),
  kbType: store.get("kb-type", "concept"), jevOn: store.get("jev-on", true), pdfTidy: store.get("pdf-tidy", true),
  tabs: [], active: -1, checking: new Set(), panelFor: null, sigs: null,
};
window.TREE = { names: {}, images: {} };

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({ error: "bad response" }));
  if (r.status === 401 && j.nokey) showStart("nokey");
  else if (r.status === 409 && j.novault) showStart();
  if (!r.ok) { const e = new Error(TS(j.error) || r.status); e.data = j; throw e; }
  return j;
}

let toastTimer;
function toast(msg, action) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  if (action) {
    const b = document.createElement("button"); b.textContent = action.label;
    b.onclick = () => { t.hidden = true; action.fn(); };
    t.append(" ", b);
  }
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), action ? 8000 : 3500);
}

// a small dialog in place of confirm(): resolves true on OK
function dialog(title, html, ok = T("確定"), danger = false) {
  return new Promise(res => {
    $("#modal-title").textContent = title; $("#modal-body").innerHTML = html;
    const okb = $("#modal-ok"); okb.textContent = ok; okb.classList.toggle("danger", danger); $("#modal-cancel").hidden = false; $("#modal-body").onchange = null;
    $("#modal").hidden = false; okb.focus();
    const done = v => { $("#modal").hidden = true; document.removeEventListener("keydown", key, true); res(v); };
    const key = e => { if (e.key === "Escape") { e.preventDefault(); done(false); } else if (e.key === "Enter") { e.preventDefault(); done(true); } };
    document.addEventListener("keydown", key, true);
    okb.onclick = () => done(true); $("#modal-cancel").onclick = () => done(false);
    $("#modal").onclick = e => { if (e.target.id === "modal") done(false); };
  });
}

// How Lumen looks, per browser: theme, text size, reading width, the help lines, the right column's sections.
const VIEW_DEF = { theme: "auto", size: "m", width: "m", help: true, summaries: true, hide: [] };
const VIEW = Object.assign({}, VIEW_DEF, store.get("view", {}));
const PANEL_SECS = [["suggest", T("建議")], ["organized", T("整理狀況")], ["atts", T("這篇的附件")], ["links", T("潛在連結")],
  ["linked", T("已連結")], ["backlinks", T("誰連到這頁")]];
function applyView() {
  const r = document.documentElement;
  r.classList.add("no-trans");                     // a theme switch is instant: no colour fades on every button
  VIEW.theme === "auto" ? r.removeAttribute("data-theme") : r.setAttribute("data-theme", VIEW.theme);
  void getComputedStyle(r).color; setTimeout(() => r.classList.remove("no-trans"), 0);
  r.dataset.size = VIEW.size; r.dataset.width = VIEW.width; r.dataset.hide = VIEW.hide.join(" ");
  r.classList.toggle("no-help", !VIEW.help); r.classList.toggle("no-summaries", !VIEW.summaries);
}
applyView();
function showViewSettings() {
  const opt = (k, v, label) => '<label class="vopt"><input type="radio" name="' + k + '" value="' + v + '"' + (VIEW[k] === v ? " checked" : "") + "> " + label + "</label>";
  const box = (k, label, on) => '<label class="vopt"><input type="checkbox" data-k="' + k + '"' + (on ? " checked" : "") + "> " + label + "</label>";
  const html = '<div class="vset">' +
    "<h4>" + T("外觀") + '</h4><div class="vrow">' + opt("theme", "auto", T("跟隨系統")) + opt("theme", "light", T("淺色")) + opt("theme", "dark", T("深色")) + "</div>" +
    "<h4>" + T("內文字級") + '</h4><div class="vrow">' + opt("size", "s", T("小")) + opt("size", "m", T("中")) + opt("size", "l", T("大")) + "</div>" +
    "<h4>" + T("內文寬度") + '</h4><div class="vrow">' + opt("width", "s", T("窄")) + opt("width", "m", T("中")) + opt("width", "l", T("寬")) + "</div>" +
    "<h4>" + T("右欄顯示") + '</h4><div class="vrow wrap">' + PANEL_SECS.map(([k, l]) => box("sec:" + k, l, !VIEW.hide.includes(k))).join("") + box("summaries", T("頁面摘要"), VIEW.summaries) + "</div>" +
    "<h4>" + T("說明文字") + '</h4><div class="vrow">' + box("help", T("顯示功能說明（熟悉之後可以關掉）"), VIEW.help) + "</div></div>";
  dialog(T("顯示設定"), html, T("完成"));
  $("#modal-cancel").hidden = true;
  const body = $("#modal-body");
  body.onchange = e => {
    const i = e.target;
    if (i.type === "radio") VIEW[i.name] = i.value;
    else if (i.dataset.k.startsWith("sec:")) { const k = i.dataset.k.slice(4); VIEW.hide = VIEW.hide.filter(x => x !== k).concat(i.checked ? [] : [k]); }
    else VIEW[i.dataset.k] = i.checked;
    store.set("view", VIEW); applyView();
  };
}

const jevUsable = () => S.tree && S.tree.jev && S.jevOn;
const baseName = p => p.split("/").pop().replace(/\.md$/, "");
const tab = () => S.tabs[S.active];

// ============================================================ left column
// Four sections: 日記 (the journal folder), 筆記 (the rest of the human's notes, by folder or as the to-do
// queue), 附件 (the attachment folder), 知識庫 (wiki/, by type). Search results get a fifth tab when used.
// The notes are raw/ in a vault laid out that way (S.tree.notes_root = "raw"), else the whole vault except
// wiki/ (notes_root = "").

const SKIP_DECISIONS = new Set(["reconvert", "skip (no content)"]);
const inJournal = p => S.tree && p.startsWith(S.tree.journal + "/");
const ROOT = () => (S.tree && S.tree.notes_root) || "";
const joinPath = (a, b) => a ? a + "/" + b : b;
const notesRel = p => ROOT() && p.startsWith(ROOT() + "/") ? p.slice(ROOT().length + 1) : p;    // path inside the notes
const unitOf = p => { const r = notesRel(p).split("/"); return r.length === 1 ? p : joinPath(ROOT(), r[0]); };

function buildRawTree(files) {
  const root = { dirs: {}, files: [], total: 0, todo: 0 };
  for (const f of files) {
    if (inJournal(f.path)) continue;                       // the journal has its own section
    const parts = notesRel(f.path).split("/");
    let node = root;
    node.total++; if (!f.done) node.todo++;
    for (const d of parts.slice(0, -1)) {
      node = node.dirs[d] = node.dirs[d] || { dirs: {}, files: [], total: 0, todo: 0 };
      node.total++; if (!f.done) node.todo++;
    }
    node.files.push(f);
  }
  return root;
}

const TRASH_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
// the human's files (movable, deletable): not wiki/ (the AI's), the tools, templates or hidden folders
const mine = p => ROOT() ? p.startsWith(ROOT() + "/") : !/^(wiki|tools|templates)\//.test(p) && !/(^|\/)\./.test(p);
const nf = n => Number(n).toLocaleString(document.documentElement.lang || undefined);   // 1,209
function rowFile(path, label, extra = "", pre = "") {
  const t = tab();
  const on = t && (t.path === path);
  const own = mine(path) && !S.tree.read_only;
  return '<div class="row' + (on ? " active" : "") + '" data-path="' + esc(path) + '" title="' + esc(label) + '"' + (own ? ' draggable="true"' : "") + '><span class="caret">' + pre + '</span><span class="name">' + esc(label) + "</span>" + extra +
    (own ? '<button class="row-del" data-del="' + esc(path) + T('" title="刪除（移到垃圾桶，可復原）">') + TRASH_SVG + "</button>" : "") + "</div>";
}
// Long lists (a 1,200-chapter folder): rows are built in chunks of VCHUNK, and only chunks within VMARGIN px of
// the view are in the page; the rest are empty boxes of the same height, so the scrollbar is right. Rows are 28px.
const VCHUNK = 15, VMARGIN = 1000, VROW = 28;
let vChunks = [];                                   // chunk html, by data-chunk; reset by each renderTree
function rowsHtml(rows) {
  if (rows.length <= VCHUNK * 2) return rows.join("");
  let html = "";
  for (let i = 0; i < rows.length; i += VCHUNK) {
    const part = rows.slice(i, i + VCHUNK);
    html += '<div class="vchunk" data-chunk="' + vChunks.length + '" style="height:' + part.length * VROW + 'px"></div>';
    vChunks.push(part.join(""));
  }
  return html;
}
function vShow(c, on) {
  if (on === !!c.dataset.on) return;
  if (on) { c.innerHTML = vChunks[+c.dataset.chunk] || ""; c.style.height = ""; c.dataset.on = "1"; return; }
  if (dragPath || c.contains(document.activeElement)) return;      // a row being dragged or focused stays
  c.style.height = c.offsetHeight + "px"; c.innerHTML = ""; delete c.dataset.on;
}
const vIO = new IntersectionObserver(es => es.forEach(e => vShow(e.target, e.isIntersecting)), { root: $("#tree"), rootMargin: VMARGIN + "px 0px" });
function vObserve() {                               // after the tree is rebuilt: fill what's in view now (no blank frame), then watch
  const t = $("#tree"), cs = t.querySelectorAll(".vchunk");
  vIO.disconnect();
  if (!cs.length) return;
  const top = t.getBoundingClientRect().top;
  const near = [...cs].filter(c => { const r = c.getBoundingClientRect(); return r.bottom > top - VMARGIN && r.top < top + t.clientHeight + VMARGIN; });
  near.forEach(c => vShow(c, true));
  cs.forEach(c => vIO.observe(c));
}
// The one to-do marker, used everywhere a raw note is listed: orange = waiting to be organised,
// grey = Jev found nothing to organise (empty or broken conversion).
function ingestLabel(path) {
  const f = (S.tree.raw || []).find(x => x.path === path);
  return f && f.parts && f.parts[0] > 0 && f.parts[0] < f.parts[1]
    ? T("✦ 接著整理下一部分（已整理 ") + f.parts[0] + "/" + f.parts[1] + T("）") : T("✦ 請 AI 整理這篇");
}
function dot(f) {
  if (f.done) return "";
  if (f.parts && f.parts[0] > 0)                  // a long note organised a part at a time, not finished yet
    return T('<span class="count" title="長篇一次整理一部分：已整理 ') + f.parts[0] + " / " + f.parts[1] + T(' 部分"><span class="new"></span>') + f.parts[0] + "/" + f.parts[1] + "</span>";
  const skip = SKIP_DECISIONS.has(f.d);
  return '<span class="new' + (skip ? " skip" : "") + '" title="' + (skip ? T("不用整理：") + esc(QUEUE_LABEL[f.d]) : T("待整理") + (f.d ? T("：Jev 建議「") + esc(QUEUE_LABEL[f.d] || f.d) + T("」") : "")) + '"></span>';
}

function renderRawNode(node, prefix, filter) {
  let html = "";
  for (const d of Object.keys(node.dirs).sort((a, b) => a.localeCompare(b))) {
    const key = joinPath(prefix, d), child = node.dirs[d];
    const inner = filter ? renderRawNode(child, key, filter) : "";
    if (filter && !inner && !d.toLowerCase().includes(filter)) continue;
    const open = S.open.has(key) || (filter && inner);
    html += '<div class="folder"><div class="row" data-folder="' + esc(key) + '" title="' + esc(d) + '"><span class="caret">' + (open ? "▾" : "▸") + '</span><span class="name">' + esc(d) +
      '</span><span class="count" title="' + (child.todo ? child.todo + T(" 篇待整理，共 ") : T("共 ")) + child.total + T(' 篇">') + (child.todo ? '<span class="new"></span>' + nf(child.todo) + " / " : "") + nf(child.total) + "</span></div>" +
      (open ? '<div class="kids">' + (inner || renderRawNode(child, key, "")) + "</div>" : "") + "</div>";
  }
  const rows = [];
  for (const f of node.files) {
    const name = baseName(f.path);
    if (filter && !name.toLowerCase().includes(filter)) continue;
    rows.push(rowFile(f.path, name, dot(f)));
  }
  return html + rowsHtml(rows);
}

// Same buttons as before: change only which is on and the counts, so the button just tapped stays and shows its press
function patchButtons(el, html) {
  const t = document.createElement("div"); t.innerHTML = html;
  const a = el.querySelectorAll("button"), b = t.querySelectorAll("button"), key = x => x.dataset.mode || x.dataset.type;
  if (!a.length || a.length !== b.length || [...a].some((x, i) => key(x) !== key(b[i]))) { el.innerHTML = html; return; }
  a.forEach((x, i) => { x.classList.toggle("on", b[i].classList.contains("on")); if (x.innerHTML !== b[i].innerHTML) x.innerHTML = b[i].innerHTML; });
}
function renderSub() {
  const el = $("#sub");
  if (S.sideTab === "wiki") {
    const counts = {};
    for (const p of S.tree.pages) counts[p.type] = (counts[p.type] || 0) + 1;
    patchButtons(el, TYPE_ORDER.filter(t => counts[t]).map(t =>
      '<button data-type="' + t + '" class="' + (S.kbType === t ? "on" : "") + '">' + TYPE_ZH[t] + ' <span>' + counts[t] + "</span></button>").join("") +
      '<button data-type="all" class="' + (S.kbType === "all" ? "on" : "") + T('">全部</button>'));
  } else if (S.sideTab === "raw") {
    const todo = S.tree.raw.filter(f => !f.done && !inJournal(f.path) && !SKIP_DECISIONS.has(f.d)).length;
    patchButtons(el, '<div class="seg"><button data-mode="tree" class="' + (S.rawMode === "tree" ? "on" : "") + T('">資料夾</button>') +
      '<button data-mode="todo" class="' + (S.rawMode === "todo" ? "on" : "") + T('"><span class="new"></span>待整理 <span>') + nf(todo) + "</span></button></div>");
  } else { el.hidden = true; return; }
  el.hidden = false;
}

function renderTree() {
  const el = $("#tree"), filter = $("#filter").value.trim().toLowerCase();
  vChunks = [];
  railSync();
  $("#filter").placeholder = { journal: T("篩選日期"), raw: T("篩選筆記"), assets: T("篩選附件"), wiki: T("篩選頁名"), results: T("篩選") }[S.sideTab];
  if (!S.tree) { $("#sub").innerHTML = ""; el.innerHTML = '<p class="muted pad"><span class="spin"></span></p>'; return; }   // list not loaded yet: refreshTree draws it
  renderSub();
  if (S.sideTab === "journal") renderJournal(el, filter);
  else if (S.sideTab === "raw" && S.rawMode === "todo") renderQueue(el, filter);
  else if (S.sideTab === "raw") {
    const notes = S.tree.raw.filter(f => !inJournal(f.path));
    el.innerHTML = '<div class="hint">' + nf(notes.length) + T(" 篇筆記，") + nf(notes.filter(f => f.done).length) + T(' 篇已整理進知識庫。<span class="new"></span> 待整理。</div>') + renderRawNode(S.rawRoot, ROOT(), filter);
  } else if (S.sideTab === "assets") renderAssets(el, filter);
  else if (S.sideTab === "wiki") {
    const types = S.kbType === "all" ? TYPE_ORDER : [S.kbType];
    let html = "";
    for (const t of types) {
      const ps = S.tree.pages.filter(p => p.type === t && (!filter || p.title.toLowerCase().includes(filter)));
      if (!ps.length) continue;
      if (types.length > 1) html += '<div class="group sticky">' + TYPE_ZH[t] + " · " + ps.length + "</div>";
      html += rowsHtml(ps.map(p => rowFile(p.path, p.title)));
    }
    el.innerHTML = html || T('<div class="hint">沒有符合的頁面。</div>');
  } else if (S.sideTab === "results") renderResults(el, filter);
  vObserve();
}

// Search results (Enter in the search box): knowledge-base pages (Jev ranks them by meaning, else keywords),
// then your own notes and journal by keywords in their text (searched on this Mac only).
function renderResults(el, filter) {
  const r = S.results;
  if (!r) { el.innerHTML = '<div class="hint">' + esc(T("在上方搜尋框輸入後按 ↵。")) + "</div>"; return; }
  if (r.loading) { el.innerHTML = '<div class="hint"><span class="spin"></span> ' + esc(r.jev ? T("Jev 正在找相關的頁…") : T("搜尋中…")) + "</div>"; return; }
  const pick = xs => (xs || []).filter(x => x.path && !x.missing && (!filter || x.title.toLowerCase().includes(filter)));
  const pages = pick(r.results), notes = pick(r.notes);
  let html = r.error ? '<div class="hint">' + esc(T("Jev 沒有回應，知識庫改用關鍵字。")) + "</div>" : "";
  if (pages.length) html += '<div class="group sticky">' + esc(T("知識庫")) + " · " + nf(pages.length) + '<span class="r-how">' + esc(r.mode === "jev" ? T("依意思") : T("依關鍵字")) + "</span></div>" +
    rowsHtml(pages.map(x => rowFile(x.path, x.title, '<span class="r-kind">' + esc(TYPE_ZH[x.type] || "") + "</span>")));
  if (notes.length) html += '<div class="group sticky">' + esc(T("你的筆記")) + " · " + nf(notes.length) + '<span class="r-how">' + esc(T("內文含關鍵字")) + "</span></div>" +
    rowsHtml(notes.map(x => rowFile(x.path, x.title, inJournal(x.path) ? '<span class="r-kind">' + esc(T("日記")) + "</span>" : "")));
  if (!pages.length && !notes.length) html += '<div class="hint">' + esc(filter ? T("沒有符合篩選的結果。") : T("「{q}」沒有找到。換個說法，或按 ⌘↵ 問 AI。").replace("{q}", r.q)) + "</div>";
  el.innerHTML = html;
}

// ---------- 日記

const WEEK = [T("日"), T("一"), T("二"), T("三"), T("四"), T("五"), T("六")];
function renderJournal(el, filter) {
  const js = S.tree.raw.filter(f => inJournal(f.path)).map(f => ({ ...f, name: baseName(f.path) }))
    .filter(f => !filter || f.name.toLowerCase().includes(filter)).sort((a, b) => b.name.localeCompare(a.name));
  let html = '<div class="hint help">' + js.length + T(" 篇日記，只留在這台電腦：不送給 Jev，也不會整理進知識庫。</div>");
  if (!js.length) html += T('<div class="hint">還沒有日記。按上面的「＋ 今天的日記」開始寫。</div>');
  let month = null;
  for (const f of js) {
    const m = f.name.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const mk = m ? monthLabel(+m[1], +m[2]) : T("其他");
    if (mk !== month) { html += '<div class="group">' + mk + "</div>"; month = mk; }
    const label = m ? dayLabel(+m[1], +m[2], +m[3], WEEK[new Date(+m[1], +m[2] - 1, +m[3]).getDay()]) : f.name;
    html += rowFile(f.path, label + (m && f.name.length > 10 ? " " + f.name.slice(10) : ""));
  }
  el.innerHTML = html;
}

// ---------- 筆記 › 待整理 (triage order; the same notes the orange dots mark)

let queueData = null;
async function renderQueue(el, filter) {
  if (!queueData) {
    el.innerHTML = T('<div class="hint"><span class="spin"></span> 讀取中…</div>');
    try { queueData = await api("/api/queue"); } catch (e) { el.innerHTML = '<div class="hint">' + esc(e.message) + "</div>"; return; }
    if (S.sideTab !== "raw" || S.rawMode !== "todo") return;
  }
  const q = queueData, judged = new Set(q.units.map(u => u.unit));
  // notes and books waiting that triage hasn't ranked yet
  const unranked = new Map();
  for (const f of S.tree.raw) {
    if (f.done || inJournal(f.path)) continue;
    const unit = unitOf(f.path);
    if (!judged.has(unit)) unranked.set(unit, (unranked.get(unit) || 0) + 1);
  }
  const units = [...q.units, ...[...unranked].map(([unit, files]) => ({ unit, files, decision: "unranked" }))];
  let html = T('<div class="hint">還沒整理的筆記都在這裡（在檔案列表裡，名稱後面有 <span class="new"></span> 的那些）。打開一篇，按「請 AI 整理這篇」，AI 會讀它，把重點寫進知識庫：替這篇寫一頁摘要，再把新的內容補進相關的主題頁。你的筆記本身不會被改。</div>') +
    (S.tree.jev && S.jevOn ? T('<div class="hint">排列的順序由 Jev 決定：分數越高，越值得先整理。</div>') + jevWhat() : "") +
    (q.ranking ? T('<div class="hint"><span class="spin"></span> Jev 正在替新筆記排順序…</div>') : "") +
    (q.pdfs && q.pdfs.waiting ? '<div class="hint">' + (q.pdfs.converting ? T('<span class="spin"></span> 正在把 ') + q.pdfs.waiting + T(" 個 PDF 轉成筆記…")
      : q.pdfs.setup === "installing" ? T('<span class="spin"></span> 正在下載轉檔工具（只有第一次需要）…')
      : !q.pdfs.tool ? T("有 ") + q.pdfs.waiting + T(" 個 PDF 要先轉成筆記，才能搜尋和整理。第一次轉檔會先下載轉檔工具，大約一兩分鐘，之後就自動轉。") +
        (q.pdfs.error ? T('<br><span class="cn-err">上次沒裝好：') + esc(q.pdfs.error) + "</span>" : "") +
        T(' <button class="primary" data-pdf-setup>轉成筆記</button>')
      : T("有 ") + q.pdfs.waiting + T(" 個 PDF 等著轉成筆記。")) + "</div>" : "") +
    (q.pdfs && q.pdfs.failed.length ? T('<div class="hint">轉不出文字的 PDF（可能是掃描檔或加密）：') + q.pdfs.failed.map(f => esc(baseName(f))).join(T("、")) + "</div>" : "");
  if (q.ranking || (q.pdfs && (q.pdfs.converting || q.pdfs.setup === "installing"))) setTimeout(() => { if (S.sideTab === "raw" && S.rawMode === "todo") { queueData = null; renderTree(); } }, 8000);
  let last = null;
  for (const u of units.filter(u => !filter || u.unit.toLowerCase().includes(filter))) {
    if (u.decision !== last) { html += '<div class="group">' + esc(u.decision === "unranked" ? (q.ranking ? T("還沒排順序（Jev 排序中）") : !S.tree.jev ? T("還沒排順序（連接 Jev 後會自動排）") : !S.jevOn ? T("還沒排順序（Jev 關著）") : T("還沒排順序")) : QUEUE_LABEL[u.decision] || u.decision) + "</div>"; last = u.decision; }
    const name = notesRel(u.unit).replace(/\.md$/, "");
    const pr = u.priority != null ? u.priority + T(" 分") : "";
    if (/\.md$/.test(u.unit)) { html += rowFile(u.unit, name, '<span class="count" title="' + T("Jev 給的排序分數：越高越值得先整理") + '">' + (u.parts ? T("已整理 ") + u.parts[0] + "/" + u.parts[1] + (pr ? " · " : "") : "") + pr + "</span>", u.decision === "unranked" ? "" : ""); continue; }
    const open = S.queueOpen.has(u.unit);
    html += '<div class="folder"><div class="row" data-queue-folder="' + esc(u.unit) + '"><span class="caret">' + (open ? "▾" : "▸") + '</span><span class="name">' + esc(name) +
      '</span><span class="count">' + u.files + T(" 篇") + (pr ? " · " + pr : "") + "</span></div>";
    if (open) html += '<div class="kids">' + rowsHtml(S.tree.raw.filter(f => f.path.startsWith(u.unit + "/")).map(f => rowFile(f.path, f.path.slice(u.unit.length + 1).replace(/\.md$/, ""), dot(f)))) + "</div>";
    html += "</div>";
  }
  el.innerHTML = html; vObserve();
}

// ---------- 附件

let assetsData = null;
const FILE_KIND = [[/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i, T("圖片"), "🖼"], [/\.pdf$/i, "PDF", "📄"], [/\.(mp3|m4a|wav|ogg)$/i, T("音訊"), "🎵"],
  [/\.(mp4|mov|webm)$/i, T("影片"), "🎬"], [/\.html?$/i, T("網頁"), "🌐"], [/\.(txt|csv|tsv|json|js|css|py|xml|ya?ml|tex|bib|log)$/i, T("文字"), "📃"]];
const fileKind = p => (FILE_KIND.find(([rx]) => rx.test(p)) || [null, T("檔案"), "📎"]).slice(1);
const fmtSize = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";

async function loadAssets(force) {
  if (!assetsData || force) assetsData = await api("/api/attachments");
  return assetsData;
}

async function renderAssets(el, filter) {
  if (!assetsData) {
    el.innerHTML = T('<div class="hint"><span class="spin"></span> 讀取中…</div>');
    try { await loadAssets(); } catch (e) { el.innerHTML = '<div class="hint">' + esc(e.message) + "</div>"; return; }
    if (S.sideTab !== "assets") return;
  }
  const fs = assetsData.files.filter(f => !filter || f.path.toLowerCase().includes(filter));
  let html = '<div class="hint">' + assetsData.files.length + T(" 個檔案，在 <code>") + esc(assetsData.dir) + T("/</code>。把檔案拖進筆記或在編輯時貼上，會自動存到這裡並連結到那篇筆記。</div>");
  if (!assetsData.files.length) html += T('<div class="hint">還沒有附件。') + (S.tree.vault ? "" : "") + "</div>";
  let folder = null;
  for (const f of fs) {
    const inside = f.path.startsWith(assetsData.dir + "/");     // or next to a note, as Obsidian allows
    const sub = inside ? f.path.slice(assetsData.dir.length + 1).split("/").slice(0, -1).join(" / ")
      : T("筆記資料夾裡：") + (dirOf(notesRel(f.path)).split("/").join(" / ") || T("最上層"));
    if (sub !== folder) {
      if (sub || folder !== null) html += '<div class="group" data-dir="' + esc(inside ? assetsData.dir + (sub ? "/" + sub.split(" / ").join("/") : "") : dirOf(f.path)) + '">' + esc(sub || T("（最上層）")) + "</div>";
      folder = sub;
    }
    const [, icon] = fileKind(f.path);
    html += rowFile(f.path, f.path.split("/").pop(), '<span class="count">' + (f.used_by.length ? "" : T('<span class="unused">沒有筆記用到</span> ')) + fmtSize(f.size) + "</span>", icon);
  }
  el.innerHTML = html;
}

$("#tree").addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); deleteFile(del.dataset.del); return; }
  if (e.target.closest("[data-pdf-setup]")) { setupPdf(); return; }
  const row = e.target.closest(".row");
  if (!row) return;
  if (row.dataset.folder) {
    const k = row.dataset.folder;
    S.open.has(k) ? S.open.delete(k) : S.open.add(k);
    store.set("open-folders", [...S.open]); renderTree(); return;
  }
  if (row.dataset.queueFolder) {
    const k = row.dataset.queueFolder;
    S.queueOpen.has(k) ? S.queueOpen.delete(k) : S.queueOpen.add(k);
    renderTree(); return;
  }
  if (row.dataset.path) openAny(row.dataset.path, { newTab: e.metaKey || e.ctrlKey });
});
$("#tree").addEventListener("auxclick", e => {
  const row = e.target.closest(".row[data-path]");
  if (row && e.button === 1) { e.preventDefault(); openAny(row.dataset.path, { newTab: true, background: true }); }
});
function setSideTab(name) {                                   // the left column's place: journal, notes, attachments, knowledge base
  S.sideTab = name; if (name !== "results") store.set("side-tab", name);
  $("#filter").value = ""; renderTree(); $("#tree").scrollTop = 0;
}
$("#sub").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.type) { S.kbType = b.dataset.type; store.set("kb-type", S.kbType); }
  if (b.dataset.mode) { S.rawMode = b.dataset.mode; store.set("raw-mode", S.rawMode); }
  renderTree(); $("#tree").scrollTop = 0;
});
let filterTimer;
$("#filter").addEventListener("input", () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderTree, 150); });

async function openToday() {
  try {
    const r = await api("/api/journal", {});
    await refreshTree();
    S.sideTab = "journal"; store.set("side-tab", "journal"); renderTree();
    await openNote(r.path, { edit: true });
    toast(r.created ? T("建立了今天的日記。日記不送 Jev。") : T("打開今天的日記。"));
  } catch (e) { toast(T("沒辦法建立日記：") + e.message); }
}

// ---------- moving, importing and deleting files (raw/ only; wiki pages belong to the AI)

const sectionRoot = () => ({ journal: S.tree.journal, assets: S.tree.assets }[S.sideTab] ?? ROOT());
const dirOf = p => p.split("/").slice(0, -1).join("/");
function dropDir(target) {
  const f = target.closest("[data-folder]"); if (f) return f.dataset.folder;
  const d = target.closest("[data-dir]"); if (d) return d.dataset.dir;
  const r = target.closest(".row[data-path]"); if (r && mine(r.dataset.path)) return dirOf(r.dataset.path);
  return sectionRoot();
}
const tree = $("#tree");
let dragPath = null;
tree.addEventListener("dragstart", e => {
  const r = e.target.closest(".row[data-path][draggable]");
  if (!r) return;
  dragPath = r.dataset.path;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("application/x-vault-path", dragPath);
  e.dataTransfer.setData("text/plain", "[[" + baseName(dragPath) + "]]");   // dropped into the editor: a link
});
tree.addEventListener("dragend", () => { dragPath = null; clearDrop(); });
const clearDrop = () => document.querySelectorAll(".drop-target").forEach(x => x.classList.remove("drop-target"));
tree.addEventListener("dragover", e => {
  const files = [...e.dataTransfer.types].includes("Files");
  if ((!dragPath && !files) || S.sideTab === "wiki" || S.sideTab === "results" || S.tree.read_only) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = dragPath ? "move" : "copy";
  clearDrop();
  (e.target.closest("[data-folder]") || e.target.closest("[data-dir]") || tree).classList.add("drop-target");
});
tree.addEventListener("dragleave", e => { if (e.target === tree) clearDrop(); });
tree.addEventListener("drop", async e => {
  if (S.sideTab === "wiki" || S.sideTab === "results") return;
  e.preventDefault(); clearDrop();
  const dir = dropDir(e.target);
  if (dragPath) { const p = dragPath; dragPath = null; return moveFile(p, dir); }
  const files = [...e.dataTransfer.files];
  if (files.length) importFiles(files, dir);
});

async function moveFile(path, dir) {
  if (dirOf(path) === dir) return;
  const f = S.tree.raw.find(x => x.path === path);
  if (f && f.done && !(await dialog(T("搬移已整理的筆記？"), T("<p>「") + esc(baseName(path)) + T("」已經整理進知識庫。知識庫是靠這篇所在的位置找到它的。</p><p>搬到「") + esc(dir) +
    T("」之後，這篇會暫時顯示成「待整理」，等 AI 下次整理時記下新位置。其他筆記連到它的連結只認檔名，不受影響。</p>"), T("搬移")))) return;
  try {
    const r = await api("/api/move", { path, dir });
    for (const t of S.tabs) if (t.path === path) { t.path = r.path; }
    lockMoved(path, r.path);
    if (tab() && tab().path === r.path) history.replaceState(Object.assign({}, history.state, { path: r.path }), "", "#" + encodeURIComponent(r.path));
    if (dir && dir !== ROOT() && S.sideTab === "raw") S.open.add(dir);
    await refreshTree();
    toast(T("搬到 ") + (notesRel(dir) && dir !== ROOT() ? notesRel(dir) + "/" : T("筆記最上層")), { label: T("復原"), fn: () => moveFile(r.path, dirOf(path)) });
  } catch (e) { toast(T("沒搬成：") + e.message); }
}

async function importFiles(files, dir) {
  let notes = 0, atts = 0, last = null, needPdf = false;
  for (const f of files) {
    if (f.size > 200 * 1048576) { toast(T("「") + f.name + T("」超過 200MB")); continue; }
    try {
      const r = await api("/api/import", { name: f.name, dir, data: await fileToBase64(f) });
      r.note ? notes++ : atts++; last = r.path;
      if (r.pdf_tool === false) needPdf = true;
    } catch (e) { toast(T("「") + f.name + T("」沒匯入：") + e.message); }
  }
  if (!last) return;
  await refreshTree();
  toast(T("匯入 ") + (notes ? notes + T(" 篇筆記") : "") + (notes && atts ? T("、") : "") + (atts ? atts + T(" 個附件") : "") + T("。"));
  if (files.length === 1) openNote(last);
  if (needPdf) offerPdfSetup();
}

// A PDF needs converting into a note before it can be searched or organised; the first time, Lumen asks once and then
// downloads the converter itself (the user never has to know its name).
async function offerPdfSetup() {
  if (!(await dialog(T("把 PDF 轉成筆記？"), T("<p>PDF 要先轉成筆記，才能搜尋、找連結、交給 AI 整理。</p><p>轉出來的是一篇文字筆記（.md 檔，任何筆記 app 和文字編輯器都打得開）：PDF 的文字照原本的頁序排好，每頁標上頁碼；書名、作者、出版年寫在筆記開頭；圖表另存成圖片，放回筆記裡原來的位置。有目錄的書會每章一篇，放在以書名命名的資料夾裡。掃描的 PDF 會先用 Mac 內建的文字辨識，錯字可能比較多。</p><p>原本的 PDF 留在附件裡，筆記開頭有連結可以打開它。第一次轉檔會先下載轉檔工具（大約一兩分鐘，只要一次），之後放進來的 PDF 都會自動轉。</p>"), T("轉成筆記")))) return;
  await setupPdf();
}
async function setupPdf() {
  try { await api("/api/pdf/setup", {}); toast(T("正在準備轉檔，完成後 PDF 會出現在筆記裡。")); queueData = null; renderTree(); }
  catch (e) { toast(T("沒辦法開始轉檔：") + e.message); }
}

async function deleteFile(path) {
  if (!mine(path)) { toast(T("知識庫的頁是 AI 維護的，不能從這裡刪。")); return; }
  let warn = [];
  try { warn = (await api("/api/delete", { path, dry: true })).warnings; } catch (e) {}
  const name = path.split("/").pop();
  let body = T("<p>會移到筆記庫裡的垃圾桶（<code>.trash</code> 資料夾，Obsidian 也用這個），之後可以復原。</p>");
  if (warn.includes("processed")) body += T("<p>AI 已經把這篇整理進知識庫。刪掉這篇，知識庫裡整理好的頁還會留著，只是點不回這篇原文。</p>");
  const used = warn.find(w => w.startsWith("used:"));
  if (used) body += T("<p>有 ") + used.slice(5) + T(" 篇筆記用到這個附件，刪掉後那些地方會顯示找不到。</p>");
  const t = S.tabs.find(x => x.path === path);
  if (t && t.dirty) body += T("<p>這篇還有沒儲存的修改，會一起丟掉。</p>");
  if (!(await dialog(T("刪除「") + name + T("」？"), body, T("刪除"), true))) return;
  try {
    const r = await api("/api/delete", { path });
    for (let i = S.tabs.length - 1; i >= 0; i--) if (S.tabs[i].path === path) { S.tabs[i].dirty = false; closeTab(i); }
    await refreshTree();
    toast(T("已刪除「") + name + T("」。"), { label: T("復原"), fn: async () => {
      try { await api("/api/restore", { trash: r.trash, path: r.path }); await refreshTree(); toast(T("已復原。")); }
      catch (e) { toast(T("沒辦法復原：") + e.message); }
    } });
  } catch (e) { toast(T("沒刪成：") + e.message); }
}

async function htmlToNote(path, btn) {
  if (btn) { btn.disabled = true; btn.textContent = T("轉換中…"); }
  try {
    const r = await api("/api/html2note", { path });
    await refreshTree(); await loadAssets(true);
    if (tab() && tab().path === path) renderView();
    await openNote(r.path, { newTab: true });
    toast(r.existing ? T("這個網頁之前已經轉成筆記了，打開那一篇。") : T("轉成筆記了，在筆記最上層。可以拖到別的資料夾。"));
  } catch (e) { toast(T("沒轉成：") + e.message); if (btn) { btn.disabled = false; btn.textContent = T("轉成筆記"); } }
}

// right-click menu on files and tabs
function showMenu(x, y, items, from, instant, src) {    // from: the trigger point it grows out of (default x, y); instant: a right-click menu, no entry motion
  const m = $("#menu");
  m.classList.toggle("instant", !!instant);
  m.innerHTML = items.map((it, i) => it ? '<button data-i="' + i + '"' + (it.danger ? ' class="danger"' : "") + ">" + esc(it.label) + "</button>" : "<hr>").join("");
  m.hidden = false;
  const r = { width: m.offsetWidth, height: m.offsetHeight };   // its real size (the entry animation starts it scaled)
  if (x == null) x = from[0] - r.width;                           // x null: right edge lines up with the trigger
  const left = Math.max(8, Math.min(x, innerWidth - r.width - 8)), top = Math.min(y, innerHeight - r.height - 8);
  m.style.left = left + "px"; m.style.top = top + "px";
  const [fx, fy] = from || [x, y], clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  m.style.transformOrigin = clamp(fx - left, r.width) + "px " + clamp(fy - top, r.height) + "px";   // grows out of its trigger
  m.onclick = e => { const b = e.target.closest("button"); if (b) { m.hidden = true; items[+b.dataset.i].fn(); } };
  const ev = window.event, tg = ev && ev.target && ev.target.closest ? ev.target : null;
  MENU.src = src || (!instant && tg ? tg.closest("button, [data-act], .icon-btn") : null);   // the button that opened it: pressing it again closes the menu
  MENU.skip = null;
}
const MENU = { src: null, skip: null };
document.addEventListener("mousedown", e => {
  const m = $("#menu");
  MENU.skip = !m.hidden && MENU.src && MENU.src.isConnected && MENU.src.contains(e.target) ? MENU.src : null;
  if (!e.target.closest("#menu")) m.hidden = true;
});
document.addEventListener("click", e => {          // the click after that press (or Enter / Space on the button) must not open the menu again
  const m = $("#menu"), s = MENU.skip || (!m.hidden && e.detail === 0 && MENU.src && MENU.src.isConnected && MENU.src.contains(e.target) ? MENU.src : null);
  MENU.skip = null;
  if (s && s.contains(e.target)) { m.hidden = true; e.stopPropagation(); e.preventDefault(); }
}, true);
document.addEventListener("click", e => { const b = e.target.closest("[data-more]"); if (b) { b.nextElementSibling.hidden = false; b.remove(); } });
document.addEventListener("scroll", () => ($("#menu").hidden = true), true);
// press feedback for taps: with tap-to-click, :active lasts ~0ms, so a pointer press also gets .pressed, kept at least PRESS_MS (never for the keyboard)
const PRESS_MS = 120;
let pressEl = null, pressAt = 0, pressTimer = 0;
function pressEnd() { clearTimeout(pressTimer); if (pressEl) pressEl.classList.remove("pressed"); pressEl = null; }
document.addEventListener("pointerdown", e => {
  pressEnd();
  if (e.button !== 0 || e.ctrlKey) return;                       // left button only: ctrl-click is a right-click on a Mac
  const b = e.target.closest && e.target.closest("button, [role=button]");
  if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
  pressEl = b; pressAt = performance.now(); b.classList.add("pressed");
}, true);
function pressUp() { if (pressEl) { clearTimeout(pressTimer); pressTimer = setTimeout(pressEnd, Math.max(0, PRESS_MS - (performance.now() - pressAt))); } }
document.addEventListener("pointerup", pressUp, true);
document.addEventListener("pointercancel", pressUp, true);       // a drag or scroll that takes over the pointer ends the press too
tree.addEventListener("contextmenu", e => {
  const f = e.target.closest(".row[data-folder]");
  if (f && !S.tree.read_only) {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [{ label: T("在這裡新增筆記"), fn: () => newNote(f.dataset.folder) }], null, true);
    return;
  }
  const r = e.target.closest(".row[data-path]");
  if (!r) return;
  e.preventDefault();
  const p = r.dataset.path, items = [{ label: T("打開"), fn: () => openNote(p) }, { label: T("在新分頁打開"), fn: () => openNote(p, { newTab: true }) }];
  if (/\.html?$/i.test(p) && mine(p) && !S.tree.read_only) items.push({ label: T("轉成筆記"), fn: () => htmlToNote(p) });
  if (mine(p) && !S.tree.read_only) {
    items.push(null, { label: T("改名…"), fn: () => renameFile(p) });
    if (/\.md$/.test(p)) items.push({ label: T("版本紀錄…"), fn: () => showHistory(p) });
    items.push({ label: T("刪除…"), danger: true, fn: () => deleteFile(p) });
  }
  showMenu(e.clientX, e.clientY, items, null, true);
});

// ============================================================ tabs

function renderTabbar() {
  const bar = $("#tabbar");
  bar.hidden = S.tabs.length === 0;
  bar.innerHTML = S.tabs.map((t, i) => '<div class="tab' + (i === S.active ? " on" : "") + '" draggable="true" data-i="' + i + '" title="' + esc(t.path || "") + '">' +
    (t.kind === "compare" ? T('<span class="tab-kind">比較</span>') : t.kind === "file" ? '<span class="tab-kind file">' + fileKind(t.path)[1] + "</span>" : "") + '<span class="tab-title">' + esc(t.title) + "</span>" + (t.kind === "note" && S.locked.has(t.path) ? '<svg class="tab-lock" viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' : "") +
    (t.dirty ? T('<span class="tab-dirty" title="還沒儲存">●</span>') : "") + '<button class="tab-x" data-close="' + i + T('" title="關閉">×</button></div>')).join("");
}

$("#tabbar").addEventListener("click", e => {
  const x = e.target.closest("[data-close]");
  if (x) { closeTab(+x.dataset.close); return; }
  const t = e.target.closest(".tab");
  if (t) activate(+t.dataset.i);
});
$("#tabbar").addEventListener("auxclick", e => {
  const t = e.target.closest(".tab");
  if (t && e.button === 1) closeTab(+t.dataset.i);
});
$("#tabbar").addEventListener("contextmenu", e => {
  const el = e.target.closest(".tab");
  if (!el) return;
  e.preventDefault();
  const i = +el.dataset.i, t = S.tabs[i];
  showMenu(e.clientX, e.clientY, [{ label: T("關閉"), fn: () => closeTab(S.tabs.indexOf(t)) },
    { label: T("關閉其他分頁"), fn: () => { for (let j = S.tabs.length - 1; j >= 0; j--) if (S.tabs[j] !== t && !S.tabs[j].dirty) closeTab(j); } },
    { label: T("關閉右邊的分頁"), fn: () => { for (let j = S.tabs.length - 1; j > S.tabs.indexOf(t); j--) if (!S.tabs[j].dirty) closeTab(j); } }], null, true);
});
// drag a tab to reorder; the active tab stays active wherever it goes
let dragTab = null;
$("#tabbar").addEventListener("dragstart", e => {
  const t = e.target.closest(".tab");
  if (!t) return;
  dragTab = +t.dataset.i;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("application/x-note-tab", String(dragTab));
  t.classList.add("dragging");
});
$("#tabbar").addEventListener("dragover", e => {
  if (dragTab == null) return;
  e.preventDefault();
  const t = e.target.closest(".tab");
  $("#tabbar").querySelectorAll(".tab").forEach(x => x.classList.remove("drop-before", "drop-after"));
  if (!t || +t.dataset.i === dragTab) return;
  const r = t.getBoundingClientRect();
  t.classList.add(e.clientX < r.left + r.width / 2 ? "drop-before" : "drop-after");
});
$("#tabbar").addEventListener("drop", e => {
  if (dragTab == null) return;
  e.preventDefault();
  const t = e.target.closest(".tab");
  let to = S.tabs.length;
  if (t) { const r = t.getBoundingClientRect(); to = +t.dataset.i + (e.clientX < r.left + r.width / 2 ? 0 : 1); }
  const cur = tab(), [moved] = S.tabs.splice(dragTab, 1);
  if (to > dragTab) to--;
  S.tabs.splice(to, 0, moved);
  S.active = S.tabs.indexOf(cur);
  dragTab = null; renderTabbar();
});
$("#tabbar").addEventListener("dragend", () => { dragTab = null; renderTabbar(); });

// the right column keeps what it shows while the next one loads; a spinner only if it takes over 400ms
let panelWait = 0;
function panelSpin(html) { const n = ++panelWait; setTimeout(() => { if (panelWait === n) $("#panel").innerHTML = html; }, 400); }
const SCROLL_AT = new Map();   // "kind:path" → where you were, so a note opened again comes back to the same place
function stash() {
  const t = tab();
  if (!t) return;
  t.scroll = $(".center").scrollTop;
  t.peek = false;
  if (t.path) SCROLL_AT.set(t.kind + ":" + t.path, t.scroll);
  const ed = $("#editor");
  if (t.editing && ed) t.editText = Wys.value(ed);
  if (t.dirty && !t.external) saveTab(t, true);    // leaving the tab: save it (the text is taken now)
}

// ---------- back / forward
// Every note or tab you go to is a browser history entry {i, tab, path}, so the browser's back and
// forward buttons, ⌘[ ⌘], the mouse's side buttons and the ← → buttons in the header all work.
const NAV = { i: 0, max: 0, restoring: false };
try { NAV.max = +sessionStorage.getItem("nav-max") || 0; } catch (e) {}
function navRecord() {
  const t = tab();
  if (NAV.restoring || !t) return;
  const st = { i: NAV.i, tab: t.id, path: t.path || null };
  const cur = history.state, url = t.path ? "#" + encodeURIComponent(t.path) : location.pathname;
  if (!cur || cur.tab == null) history.replaceState(st, "", url);                // first page: no empty entry before it
  else if (cur.tab !== st.tab || cur.path !== st.path) {
    st.i = ++NAV.i; NAV.max = NAV.i;
    history.pushState(st, "", url);
  }
  try { sessionStorage.setItem("nav-max", NAV.max); } catch (e) {}
}
window.addEventListener("popstate", async e => {
  const st = e.state;
  if (!st) return;
  NAV.i = st.i || 0; NAV.restoring = true;
  try {
    const i = S.tabs.findIndex(t => t.id === st.tab);
    if (i >= 0) {
      if (i !== S.active) activate(i, false);
      if (st.path && S.tabs[i].path !== st.path) await openNote(st.path);   // that tab went on to another note
    } else if (st.path) await openNote(st.path);                           // the tab was closed since
  } finally { NAV.restoring = false; }
});
// back and forward between notes: ⌘[ and ⌘] (the buttons left with the rail; a desktop app has no browser buttons)
document.addEventListener("keydown", e => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (e.key === "[") { e.preventDefault(); history.back(); }
  else if (e.key === "]") { e.preventDefault(); history.forward(); }
});

function activate(i, push = true) {
  if (i === S.active && $("#view").dataset.tab === String(tab() && tab().id)) return;
  stash();
  S.active = i;
  const t = tab();
  renderTabbar(); renderView(); renderTree(); loadPanel();
  if (push) navRecord();
}

async function closeTab(i) {
  const t = S.tabs[i];
  if (t.dirty && !t.external) { if (i === S.active) stash(); await saveTab(t, true); i = S.tabs.indexOf(t); if (i < 0) return; }
  if (t.dirty && !confirm(T("「") + t.title + T("」還沒儲存，確定關閉？"))) return;
  stash();
  S.tabs.splice(i, 1);
  if (S.active >= S.tabs.length) S.active = S.tabs.length - 1;
  else if (i < S.active) S.active--;
  renderTabbar(); renderView(); renderTree(); loadPanel();
  const n = tab();                                   // closing isn't a step back: just fix the address
  history.replaceState(Object.assign({}, history.state, n ? { tab: n.id, path: n.path || null } : { tab: null, path: null }), "",
    n && n.path ? "#" + encodeURIComponent(n.path) : location.pathname);
}

let tabSeq = 0;
const openAny = (path, opt) => openNote(path, opt);
async function openNote(path, opt = {}) {
  const kind = /\.md$/i.test(path) ? "note" : "file";
  const existing = S.tabs.findIndex(t => t.kind === kind && t.path === path);
  if (existing >= 0) { if (!opt.background) activate(existing); if (opt.edit) startEdit(true); return; }
  const t = { id: ++tabSeq, kind, path, title: kind === "note" ? baseName(path) : path.split("/").pop(), note: null, loading: kind === "note" };
  const cur = tab();
  if (opt.newTab || !cur || cur.dirty || cur.kind !== "note") {
    S.tabs.push(t);
    if (!opt.background) { stash(); S.active = S.tabs.length - 1; }
  } else { stash(); t.id = cur.id; S.tabs[S.active] = t; }       // same tab, new note: keeps its id for back/forward
  renderTabbar();
  if (!opt.background) { navRecord(); renderView(); renderTree(); }
  if (kind === "file") { if (!opt.background) loadPanel(); return; }
  try { t.note = await api("/api/note?path=" + encodeURIComponent(path)); }
  catch (e) { t.error = e.message; }
  t.loading = false;
  if (t.note) t.title = t.note.page ? t.note.page.title : (splitFrontmatter(t.note.text).fm.title || baseName(path));
  renderTabbar();
  if (tab() === t) { renderView(); loadPanel(); if (opt.edit) startEdit(true); }
}

function openCompare(s) {
  stash();
  const key = "compare:" + s.key;
  const i = S.tabs.findIndex(t => t.id === key);
  if (i >= 0) { activate(i); return; }
  const t = { id: key, kind: "compare", title: s.topic.title + T("：兩種說法"), s, notes: [null, null] };
  S.tabs.push(t); S.active = S.tabs.length - 1; navRecord();
  renderTabbar(); renderView(); loadPanel();
  Promise.all([s.a.path, s.b.path].map(p => api("/api/note?path=" + encodeURIComponent(p)).catch(e => ({ error: e.message })))).then(ns => {
    t.notes = ns;
    if (tab() === t) renderView();
  });
}

// ============================================================ center

const RENDER_MAX = 250000;

// "+22": the rest of a long list (aliases, tags), shown in place on click
const moreBtn = (rest, sep) => rest.length ? '<button class="link-btn more-items" data-more="1" title="' + T("顯示全部") + '">+' + rest.length + '</button><span class="more-rest" hidden>' + sep + rest.join(sep) + "</span>" : "";
function headHtml(n, t) {
  const { fm } = splitFrontmatter(n.text);
  const title = n.page ? n.page.title : (fm.title || baseName(n.path));
  const renamable = n.editable;           // your own note: click the title to rename (file name, and `title:` if it has one)
  const chips = [];
  if (n.page) {
    chips.push(T('<span class="chip ai">AI 整理 · ') + esc(TYPE_ZH[n.page.type] || n.page.type) + "</span>");
    if (n.page.updated) chips.push(T("更新 ") + esc(n.page.updated));
    if (n.page.aliases.length) chips.push(T("又名 ") + n.page.aliases.slice(0, 6).map(esc).join(T("、")) + moreBtn(n.page.aliases.slice(6).map(esc), T("、")));
  } else {
    chips.push(T('<span class="chip">你的筆記</span>'));
    if (fm.source && /^https?:/.test(fm.source)) chips.push('<a href="' + esc(fm.source) + T('" target="_blank" rel="noopener">原文</a>'));
    if (fm.pdf && !(t && t.editing)) {                      // tidying changes how the text is shown: reading only
      chips.push(T('<button class="link-btn" data-act="pdf-layout" title="PDF 轉出來的筆記常有斷行、頁首頁尾和圖中文字。整理只影響顯示，檔案不變。">') + (S.pdfTidy ? T("顯示原始排版") : T("整理排版")) + "</button>");
    }
    if (n.private) chips.push(T('<span class="chip todo" title="日記只留在這台電腦：不送給 Jev，也不會整理進知識庫。">私人日記</span>'));
  }
  const fmm = n.text.match(/^---\n([\s\S]*?)\n---/);         // tags, from the note's properties
  const tags = fmm ? (Props.parse(fmm[1]).find(p => /^tags?$/.test(p.key || "") && p.kind === "list") || { items: [] }).items : [];
  const tagHtml = x => '<span class="tag">#' + esc(String(x).replace(/^#/, "")) + "</span>";
  if (tags.length && n.page) chips.push(tags.slice(0, 8).map(tagHtml).join(" ") + moreBtn(tags.slice(8).map(tagHtml), " "));
  const folder = n.path.split("/").slice(0, -1).filter((x, i) => !(i === 0 && x === "raw"));   // the notes folder goes unsaid
  if (!n.private && folder.length) chips.push("<span>" + esc(folder.join(" / ")) + "</span>");
  return (renamable ? T('<h1 class="renamable" data-act="rename" title="點一下改名">') : "<h1>") + esc(title) + '</h1><div class="meta">' + chips.map(c => '<span class="mc">' + c + "</span>").join("") + "</div>" +
    (n.page && n.page.summary ? '<p class="summary">' + esc(n.page.summary) + "</p>" : "");
}

function bodyHtml(n, full) {
  let { body } = splitFrontmatter(n.text);
  const h1 = body.match(/^\s*# +(.+)\n/);
  if (h1 && n.page && h1[1].trim() === n.page.title) body = body.slice(h1[0].length);
  if (S.pdfTidy && /^---\n[\s\S]*?\npdf:/.test(n.text)) body = tidyPdf(body);
  if (!full && body.length > RENDER_MAX) return md(body.slice(0, RENDER_MAX)) + T('<div class="truncated">這篇很長，先顯示前 ') + Math.round(RENDER_MAX / 1000) + T('k 字元。<button data-show-all>全部顯示</button></div>');
  return md(body);
}

function renderView() {
  const v = $("#view"), t = tab();
  v.dataset.tab = t ? String(t.id) : "";
  clearTimeout(renderView.spin);
  if (!t) {
    v.dataset.shown = ""; panelWait++;
    v.innerHTML = T('<div class="empty"><h2>從左邊打開一篇筆記</h2><p class="muted">⌘／Ctrl＋點擊在新分頁打開。</p></div>');
    $("#panel").innerHTML = T('<div class="panel-empty muted">打開筆記後，這裡會出現連結和建議。</div>');
    return;
  }
  if (t.kind === "compare" || t.kind === "file") { v.dataset.shown = ""; return t.kind === "compare" ? renderCompare(v, t) : renderFile(v, t); }
  if (t.loading) {   // keep the last note on screen while this one loads; a spinner only if it takes over 400ms
    renderView.spin = setTimeout(() => { if (tab() === t && t.loading) { v.innerHTML = '<p class="muted pad"><span class="spin"></span></p>'; v.dataset.shown = ""; } }, 400);
    return;
  }
  const shown = t.kind + ":" + t.path, isNew = v.dataset.shown !== shown;
  if (t.error) { v.innerHTML = '<p class="muted pad">' + esc(t.error) + "</p>"; return; }
  const n = t.note;
  let tools = "";
  if (n.editable && !t.editing && !S.locked.has(t.path) && !t.peek) { t.editing = true; t.msg = ""; t.editBase = t.editText ?? n.text; }   // editable notes open ready to type in
  if (n.editable) tools = '<div class="note-tools">' + T('<button data-act="more" class="ghost more" title="更多：版本、刪除">⋯</button>') + '<span class="muted save-msg">' + esc(t.msg || (t.editing ? T("修改會自動儲存 · 拖進或貼上檔案會存成附件") : "")) + "</span></div>";
  if (t.external) tools += T('<div class="banner">這篇在別處被改過。<button data-act="reload">載入新版本</button>（你這裡的修改會不見）</div>');
  v.innerHTML = '<div class="note-head">' + headHtml(n, t) + "</div>" + tools +
    (t.editing ? '<div id="editor" class="editor wys" contenteditable="true" spellcheck="false"></div>' : '<article id="note" class="note">' + bodyHtml(n, t.full) + "</article>");
  if (t.editing) {
    const ed = $("#editor");
    Wys.mount(ed, t.editText ?? n.text);
    Wys.attach(ed, () => noteChanged(t));
    ed._open = name => { const rel = resolveLink(name) || attachmentRel(name); if (rel) openNote(rel, { newTab: true }); };
    ed.before(Wys.bar(ed, pickAttachments));
  }
  $(".center").scrollTop = t.scroll ?? SCROLL_AT.get(shown) ?? 0;
  v.dataset.shown = shown;
  if (isNew) v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });   // a different note fades in; opacity only, so Reduce Motion keeps it; never blocks clicks or typing
  if (t.renameNow) { t.renameNow = false; startTitleRename(t); }
  if (S.panelFor === t.path) propCard();                    // reading ↔ editing changes what the card offers
  updateAICtx();
}

function renderCompare(v, t) {
  const s = t.s;
  const col = (n, side, card) => {
    if (!n) return '<div class="cmp-col"><p class="muted"><span class="spin"></span></p></div>';
    if (n.error) return '<div class="cmp-col"><p class="muted">' + esc(n.error) + "</p></div>";
    return '<div class="cmp-col" data-side="' + side + '"><div class="cmp-tag">' + side + '</div><div class="note-head">' + headHtml(n) + '</div><article class="note small">' + bodyHtml(n, true) + "</article></div>";
  };
  v.innerHTML = T('<div class="cmp-head">Jev 認為這兩個來源對 <a data-open="') + esc(s.topic.path) + '">' + esc(s.topic.title) + T("</a> 的說法可能互相衝突（Jev 判斷有 ") + pct(s.p) +
    T(" 的機會）。兩邊提到它的地方已經標出來。") + T('<button data-act="next-hl">下一處</button></div><div class="cmp">') + col(t.notes[0], "A") + T('<div class="gutter cmp-g" title="拖曳調整，雙擊回到一半"></div>') + col(t.notes[1], "B") + "</div>";
  if (t.notes[0] && t.notes[1]) {
    const names = [s.topic.title, ...(s.topic.aliases || [])];
    v.querySelectorAll(".cmp-col .note").forEach(el => highlight(names, el, false));
  }
}

function renderFile(v, t) {
  const u = "/file?path=" + encodeURIComponent(t.path), [kind] = fileKind(t.path);
  const info = assetsData && assetsData.files.find(f => f.path === t.path);
  let body;
  if (kind === T("圖片")) body = '<img class="file-img" src="' + u + '" alt="">';
  else if (kind === "PDF") body = '<iframe class="file-frame" src="' + u + (t.page ? "#page=" + t.page : "") + '"></iframe>';
  else if (kind === T("網頁")) {
    const made = info && info.note;
    body = '<div class="to-note">' + (made
      ? T('<div><strong>已經轉成筆記</strong>：<a class="wl" data-path="') + esc(made) + '">' + esc(baseName(made)) + "</a></div>" +
        T('<div class="muted">網頁的文字已經在那篇筆記裡，可以搜尋、找連結、交給 AI 整理。這裡的預覽是原始網頁的樣子。</div>')
      : T('<div class="to-note-row"><div><strong>這裡只是預覽</strong>：網頁還只是一個附件，裡面的文字不會被搜尋、不會找連結，AI 也不會整理它。</div>') +
        (S.tree.read_only ? "" : T('<button data-act="html2note" class="primary">轉成筆記</button>')) + "</div>" +
        T('<div class="muted">轉成筆記：把網頁的正文（去掉選單、側欄、廣告和程式）存成一篇筆記，格式和 Obsidian 的網頁剪輯工具（Web Clipper）存下來的一樣，並連回這個原檔。原檔留在附件裡。</div>')) +
      '</div><iframe class="file-frame" sandbox src="' + u + T('"></iframe><div class="note-line">預覽在隔離的框裡，網頁的程式不會執行，碰不到你的筆記。</div>');
  }
  else if (kind === T("音訊")) body = '<audio controls src="' + u + '"></audio>';
  else if (kind === T("影片")) body = '<video class="file-img" controls src="' + u + '"></video>';
  else if (kind === T("文字")) body = '<iframe class="file-frame text" src="' + u + '"></iframe>';
  else body = T('<p class="muted">這種檔案沒辦法在這裡預覽。</p>');
  v.innerHTML = '<div class="note-head"><h1>' + esc(t.title) + T('</h1><div class="meta"><span class="chip">附件 · ') + kind + "</span>" +
    (info ? "<span>·</span>" + fmtSize(info.size) : "") + "<span>·</span><span>" + esc(t.path.split("/").slice(0, -1).join(" / ")) + "</span><span>·</span>" +
    '<a href="' + u + T('" target="_blank" rel="noopener">在新視窗打開</a>') + (kind === T("檔案") ? '<span>·</span><a href="' + u + T('" download>下載</a>') : "") +
    (!S.tree.read_only ? T('<span>·</span><a data-act="delete">刪除</a>') : "") + '</div></div><div class="file-body">' + body + "</div>";
}

function startEdit(focus) {
  const t = tab();
  if (!t || t.kind !== "note" || !t.note || !t.note.editable) return;
  t.peek = false;
  if (!t.editing) { t.editing = true; t.msg = ""; t.editBase = t.editText ?? t.note.text; renderView(); }
  if (focus && $("#editor")) $("#editor").focus();
}
// to reading: save what's left, then show the note as text
async function stopEdit(t) {
  const ed = tab() === t ? $("#editor") : null;
  if (t.editing && ed) t.editText = Wys.value(ed);
  t.editing = false;
  if (t.dirty && !t.external) await saveTab(t);
  if (t.editText != null) t.note = Object.assign({}, t.note, { text: t.editText });
  if (tab() === t) renderView();
}
// back to the text from before this editing session (the menu offers it only when there is something to go back to)
async function revertEdit(t) {
  if (t.editing) {
    const now = $("#editor") ? Wys.value($("#editor")) : liveText(t);
    if (now === t.editBase) return;
    if (!confirm(T("回到這次開始編輯前的內容？（之前的內容也可以從「版本」找回）"))) return;
    t.editText = t.editBase; t.dirty = true; t.editing = false;
    await saveTab(t);
    t.note = Object.assign({}, t.note, { text: t.editText }); renderView();
  } else if (!t.dirty || confirm(T("放棄還沒儲存的修改？"))) reloadTab(t);
}
function lockSave() { store.set("locked-notes", [...S.locked]); }
function lockMoved(from, to) { if (S.locked.delete(from)) { S.locked.add(to); lockSave(); } }   // a locked note keeps its lock when renamed or moved
async function toggleLock(t) {
  if (S.locked.has(t.path)) { S.locked.delete(t.path); lockSave(); t.peek = false; renderTabbar(); if (tab() === t) renderView(); }
  else { S.locked.add(t.path); lockSave(); t.peek = false; await stopEdit(t); renderTabbar(); }
}

let RENAMING = null;           // a rename in flight: a save waits for it, so it goes to the new name
async function save() {
  if (RENAMING) await RENAMING.catch(() => {});
  return saveTab(tab());
}
// ---------- autosave: an edited note saves itself AUTOSAVE_IDLE after typing stops, and at least every
// AUTOSAVE_MAX while typing goes on; also when editing ends, the tab is left or closed, or the window loses focus.
// A save never redraws the editor (the caret and undo stay), and never overwrites a note changed elsewhere.
const AUTOSAVE_IDLE = 2000, AUTOSAVE_MAX = 10000;
function liveText(t) {                               // the tab's text now: its editor if it's on screen
  const ed = t.editing && tab() === t ? $("#editor") : null;
  return ed ? Wys.value(ed) : t.editText ?? t.note.text;
}
function noteChanged(t) {
  if (!t.dirty) { t.dirty = true; t.dirtySince = Date.now(); renderTabbar(); }
  clearTimeout(t.autoTimer);
  t.autoTimer = setTimeout(() => autoSave(t), Math.max(0, Math.min(AUTOSAVE_IDLE, t.dirtySince + AUTOSAVE_MAX - Date.now())));
}
function autoSave(t) {
  if (!t.dirty || t.external || !S.tabs.includes(t)) return;
  const ed = t.editing && tab() === t ? $("#editor") : null;
  if (ed && ed._composing) { t.autoTimer = setTimeout(() => autoSave(t), 500); return; }   // mid-word (注音): wait for it
  saveTab(t, true);
}
function showSaveMsg(t) {
  if (tab() !== t) return;
  const m = $(".save-msg");
  if (m && t.editing) m.textContent = t.msg; else renderView();
}
async function saveTab(t, auto) {
  if (!t || t.kind !== "note" || !(t.editing || t.dirty)) return;
  if (t.saving) { t.again = true; return t.saving; }     // one save at a time; the newer text goes next
  clearTimeout(t.autoTimer);
  const text = liveText(t);
  if (t.editing) t.editText = text;
  t.saving = (async () => {
    try {
      const r = await api("/api/save", { path: t.path, text, mtime: t.note.mtime });
      t.note.text = text; t.note.mtime = r.mtime; t.external = false;
      if (liveText(t) === text) { t.dirty = false; t.dirtySince = null; }
      else t.again = true;                           // typed while it was saving
      const d = new Date();
      t.msg = T(auto ? "已自動儲存 " : "已儲存 ") + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      renderTabbar(); showSaveMsg(t);
      if (tab() === t && !t.propEdit) propCard();          // not while its form is being typed in
      if (!t.editing) loadPanel(true);
    } catch (e) {
      t.msg = T("沒存成：") + e.message;
      if (e.data && /別處/.test(e.data.error || "")) { t.external = true; if (tab() === t) renderView(); }
      else showSaveMsg(t);
    } finally {
      t.saving = null;
      if (t.again) { t.again = false; if (t.dirty) noteChanged(t); }
    }
  })();
  return t.saving;
}

async function reloadTab(t) {
  try {
    const n = await api("/api/note?path=" + encodeURIComponent(t.path));
    Object.assign(t, { note: n, dirty: false, editText: undefined, external: false });
    if (t.editing) t.editBase = n.text;
    if (!t.editing) t.msg = "";
    if (tab() === t) { renderTabbar(); renderView(); loadPanel(true); }
  } catch (e) {}
}

$("#view").addEventListener("click", e => {
  const att = e.target.closest("a.att");
  if (att) { e.preventDefault(); openNote(att.dataset.file, { newTab: e.metaKey || e.ctrlKey || tab().kind === "compare" }); return; }
  const a = e.target.closest("a.wl");
  if (a && a.dataset.path) { e.preventDefault(); openNote(a.dataset.path, { newTab: e.metaKey || e.ctrlKey || tab().kind === "compare" }); return; }
  const o = e.target.closest("[data-open]");
  if (o) { openNote(o.dataset.open, { newTab: true }); return; }
  if (e.target.closest("[data-show-all]")) { tab().full = true; renderView(); return; }
  const pk = tab();
  if (pk && pk.peek && e.target.closest("#note") && !e.target.closest("a, button") && !String(getSelection())) { startEdit(true); return; }   // marks shown from the right column: a click goes back to typing
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const t = tab();
  const act = b.dataset.act;
  if (act === "save") save();
  else if (act === "reload") reloadTab(t);
  else if (act === "next-hl") nextHighlight();
  else if (act === "delete") deleteFile(t.path);
  else if (act === "more") {
    const r = b.getBoundingClientRect();
    const ed = $("#editor"), back = t.editing ? (ed ? Wys.value(ed) : liveText(t)) !== t.editBase : t.dirty;
    const lk = S.locked.has(t.path);
    showMenu(null, r.bottom + 4, [{ label: (lk ? "✓ " : "") + T("鎖定這篇（唯讀）"), fn: () => toggleLock(t) }, null].concat(back ? [{ label: t.editing ? T("還原這次編輯") : T("放棄修改"), fn: () => revertEdit(t) }] : [],
      [{ label: T("以前的版本…"), fn: () => showHistory(t.path) }, { label: T("刪除（移到垃圾桶）"), fn: () => deleteFile(t.path) }]), [r.right, r.bottom]);
  }
  else if (act === "history") showHistory(t.path);
  else if (act === "rename") startTitleRename(t);
  else if (act === "pdf-layout") { S.pdfTidy = !S.pdfTidy; store.set("pdf-tidy", S.pdfTidy); renderView(); }
  else if (act === "html2note") htmlToNote(t.path, b);
});

document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
  if ((e.metaKey || e.ctrlKey) && e.key === "w" && tab()) { e.preventDefault(); closeTab(S.active); }
});
window.addEventListener("blur", () => { const t = tab(); if (t && t.dirty && !t.external) saveTab(t, true); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { const t = tab(); if (t && t.dirty && !t.external) saveTab(t, true); } });
window.addEventListener("beforeunload", e => {
  for (const t of S.tabs) {                          // a last try for unsaved notes (small ones fit a keepalive request)
    if (!t.dirty || t.external || t.kind !== "note") continue;
    try { fetch("/api/save", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
                               body: JSON.stringify({ path: t.path, text: liveText(t), mtime: t.note.mtime }) }); } catch (err) {}
  }
  if (S.tabs.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ""; }
});

// ---------- attachments: drop or paste files into a note

function fileToBase64(file) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => bad(r.error);
    r.readAsDataURL(file);
  });
}

async function attach(files) {
  const t = tab();
  if (!t || t.kind !== "note" || !t.note) return;
  if (!t.note.editable) { toast(t.note.raw ? T("唯讀模式，不能加附件。") : T("知識庫的頁是 AI 寫的，附件請加在你自己的筆記。")); return; }
  const links = [];
  for (const f of files) {
    try {
      const r = await api("/api/attach", { name: f.name || "pasted.png", data: await fileToBase64(f) });
      TREE.images[r.name.toLowerCase()] = r.path; assetsData = null;
      if (r.pdf_tool === false) setTimeout(offerPdfSetup, 4000);
      links.push((r.image ? "![[" : "[[") + r.name + "]]");
    } catch (e) { toast(T("「") + f.name + T("」沒存成：") + e.message); }
  }
  if (!links.length) return;
  const ins = links.join("\n");
  if (t.editing) {
    const ed = $("#editor");
    ed.focus();
    Wys.insertMd(ed, ins);
    toast(T("附件存進 ") + S.tree.attach_to + T("/，連結插在游標處，會自動儲存。"));
  } else {
    if (t.dirty) { toast(T("先儲存或放棄修改，再加附件。")); return; }
    t.editing = true; t.editText = t.note.text.replace(/\s*$/, "") + "\n\n" + ins + "\n"; t.dirty = true;
    renderTabbar(); renderView(); await save(); t.editing = false; renderView();
    toast(T("附件存進 ") + S.tree.attach_to + T("/，連結加在筆記最後。"));
  }
}

// the editor's 📎 button: pick images or files; they go in as attachments at the caret
let PICK_RANGE = null;
function pickAttachments() {
  const s = getSelection();
  PICK_RANGE = s.rangeCount && $("#editor") && $("#editor").contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
  const inp = document.createElement("input");
  inp.type = "file"; inp.multiple = true;
  inp.addEventListener("change", () => {
    if (PICK_RANGE) { const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(PICK_RANGE); }
    if (inp.files.length) attach([...inp.files]);
  });
  inp.click();
}

const view = $("#view");
view.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); view.classList.add("drop"); } });
view.addEventListener("dragleave", e => { if (e.target === view) view.classList.remove("drop"); });
view.addEventListener("drop", e => {
  view.classList.remove("drop");
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault(); attach([...e.dataTransfer.files]);
});
view.addEventListener("paste", e => {
  const files = [...(e.clipboardData ? e.clipboardData.files : [])];
  if (files.length && e.target.closest && e.target.closest("#editor")) { e.preventDefault(); attach(files); }
});

// ---------- highlight names in a note

let hlIndex = -1;
const scrollMotion = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");   // Reduce Motion: jump, don't glide
function highlight(names, root, scroll = true) {
  root = root || $("#note");
  if (!root) return 0;
  root.querySelectorAll("mark.hl").forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  root.normalize();
  const words = [...new Set(names.filter(w => w && w.length >= 2))].sort((a, b) => b.length - a.length);
  if (!words.length) return 0;
  const rx = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|"), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let first = null, count = 0;
  for (const node of nodes) {
    const tx = node.nodeValue; rx.lastIndex = 0;
    if (!rx.test(tx)) continue;
    rx.lastIndex = 0;
    const frag = document.createDocumentFragment(); let last = 0, m;
    while ((m = rx.exec(tx))) {
      frag.append(tx.slice(last, m.index));
      const mark = document.createElement("mark"); mark.className = "hl"; mark.textContent = m[0];
      frag.append(mark); first = first || mark; count++; last = m.index + m[0].length;
    }
    frag.append(tx.slice(last)); node.replaceWith(frag);
  }
  hlIndex = 0;
  if (first && scroll) first.scrollIntoView({ behavior: scrollMotion(), block: "center" });
  return count;
}
function nextHighlight() {
  const marks = [...document.querySelectorAll("#view mark.hl")];
  if (!marks.length) return;
  hlIndex = (hlIndex + 1) % marks.length;
  marks[hlIndex].scrollIntoView({ behavior: scrollMotion(), block: "center" });
}

// ============================================================ right panel

const W_LABEL = { 2: T("主題"), 1: T("有討論"), 0: T("順帶提到") };

function mentionRow(m) {
  const no = m.refers != null && m.refers <= 0.2;
  const unsure = m.refers != null && m.refers > 0.2 && m.refers < 0.8;
  const tag = m.refers == null ? "" : no ? T("可能不是") : unsure ? pct(m.refers) : "";   // the group's heading says the rest
  return '<div class="mention' + (no ? " no" : "") + '" data-path="' + esc(m.path) + '" data-names="' + esc(JSON.stringify([m.title, ...(m.aliases || []), ...m.matched])) +
    '"><span class="w' + (m.weight != null ? " w" + m.weight : "") + '"></span><span><span class="t">' + esc(m.title) + '</span> <span class="muted">' + esc(TYPE_ZH[m.type] || "") +
    '</span><span class="s">' + esc(m.summary) + '</span></span><span class="x">×' + m.n + (tag ? "<br>" + esc(tag) : "") + "</span></div>";
}

function suggestionCard(s) {
  return '<div class="card contra" data-key="' + esc(s.key) + T('"><div class="kind">可能矛盾 · Jev 判斷有 ') + pct(s.p) + T(" 的機會") + '</div><div class="body">' +
    '<a data-path="' + esc(s.a.path) + '">' + esc(s.a.title) + T('</a> 和 <a data-path="') + esc(s.b.path) + '">' + esc(s.b.title) + T("</a> 對 ") +
    '<a data-path="' + esc(s.topic.path) + '">' + esc(s.topic.title) + T("</a> 的說法可能衝突。</div>") +
    '<div class="acts"><button data-compare="' + esc(s.key) + T('">並排比較</button><button data-dismiss="') + esc(s.key) + T('">看過，沒問題</button></div></div>');
}

function recordedCard(r) {
  const label = { contradiction: T("已記錄的矛盾"), positions: T("不同看法（立場）"), question: T("待解的問題") }[r.kind] || r.kind;
  return '<div class="card ' + (r.kind === "contradiction" ? "contra" : "positions") + '"><div class="kind">' + label + '</div><details><summary>' + inline(r.title) + "</summary><div>" + md(r.text) + "</div></details></div>";
}

let panelData = null;
async function loadPanel(force) {
  const t = tab(), el = $("#panel");
  if (!t) return;
  if (t.kind === "compare") { renderComparePanel(t); return; }
  if (t.kind === "file") { renderFilePanel(t); return; }
  if (!t.note) { panelSpin('<p class="muted"><span class="spin"></span></p>'); return; }
  const path = t.path;
  if (!force && S.panelFor === path && panelData) return renderPanel(panelData);
  panelSpin(T('<p class="muted"><span class="spin"></span> 找連結…</p>'));
  let p;
  try { p = await api("/api/panel?path=" + encodeURIComponent(path)); }
  catch (e) { panelWait++; el.innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; return; }
  if (!tab() || tab().path !== path) return;
  S.panelFor = path; panelData = p;
  renderPanel(p);
  if (mine(path) && !p.checked && !p.private && jevUsable() && p.mentions.length && !S.checking.has(path)) runCheck(path);
}

async function renderFilePanel(t) {
  const el = $("#panel");
  panelSpin('<p class="muted"><span class="spin"></span></p>');
  try { await loadAssets(true); } catch (e) { panelWait++; el.innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; return; }
  if (tab() === t) panelWait++;
  if (tab() !== t) return;
  const f = assetsData.files.find(x => x.path === t.path);
  const used = f ? f.used_by : [];
  el.innerHTML = T('<h3>用到這個檔案的筆記 <span class="n">') + used.length + "</span></h3>" +
    (used.length ? '<div class="linklist">' + used.map(p => '<a data-path="' + esc(p) + '">' + esc(baseName(p)) + "</a>").join("") + "</div>"
      : T('<div class="note-line">沒有筆記連到它。把它拖進一篇筆記，或在筆記裡寫 <code>![[') + esc(t.title) + T("]]</code>。</div>")) +
    T('<div class="note-line" style="margin-top:16px">附件不會送給 Jev，也不會拿來找連結。</div>');
  if (tab() === t && t.kind === "file") renderView();      // size now known
}

function renderComparePanel(t) {
  panelWait++;
  const s = t.s;
  $("#panel").innerHTML = T("<h3>正在比較</h3>") + suggestionCard(s).replace('<button data-compare="' + esc(s.key) + T('">並排比較</button>'), "") +
    T('<div class="note-line">看完兩邊：如果真的衝突，請 AI 在 <a data-path="') + esc(s.topic.path) + '">' + esc(s.topic.title) +
    T("</a> 加一個矛盾或「不同看法」段落；如果只是談不同面向，按「看過，沒問題」，它就不會再出現。</div>");
}

function renderPanel(p) {
  panelWait++;
  const el = $("#panel"), isRaw = mine(p.path);
  let html = "";
  const sec = n => { html += (html ? "</div>" : "") + '<div class="psec" data-sec="' + n + '">'; };
  sec("suggest");
  if (p.suggestions.length || p.unsure || p.stale) html += T('<h3>建議 <span class="n">') + (p.suggestions.length || "") + "</span></h3>";   // nothing to see: no section
  html += p.suggestions.map(suggestionCard).join("");
  if (p.unsure) html += T('<div class="note-line">另有 ') + p.unsure + T(" 組說法 Jev 沒把握是不是衝突，先不列出（這類大約六成其實不衝突）。下次請 AI 檢查知識庫時，它會讀過再決定。</div>");
  if (p.stale) html += '<div class="note-line">' + p.stale + T(" 對的判斷做完之後，相關頁面又改過，判斷可能過時，先不列。下次檢查知識庫時會重新判斷。</div>");
  if (p.suggestions.length || p.unsure) html += T('<div class="note-line help">這些判斷是檢查知識庫時存下來的，Jev 關掉也看得到。</div>');
  if (p.recorded && p.recorded.length) html += T("<h3>這頁記下的爭議</h3>") + p.recorded.map(recordedCard).join("");

  sec("organized");
  if (isRaw) {
    if (p.organized) {
      html += T('<h3>已整理成</h3><div class="linklist"><a data-path="') + esc(p.organized.source.path) + '"><strong>' + esc(p.organized.source.title) + "</strong></a></div>";
      if (p.organized.pages.length) html += T('<div class="note-line">累積到 ') + p.organized.pages.length + T(' 個概念・人物頁：</div><div class="linklist">') +
        p.organized.pages.slice(0, 30).map(c => '<a data-path="' + esc(c.path) + '">' + esc(c.title) + "</a>").join("") + "</div>";
    } else if (!p.private) {
      html += T('<h3>還沒整理</h3><div class="note-line">') + (p.triage ? T("Jev 看過這篇：") + esc(QUEUE_LABEL[p.triage.decision] || p.triage.decision) + T("。") : T("Jev 還沒看過這篇。")) +
        "</div>" + triageExplain(p.triage) + (p.triage ? jevWhat() : "") + (S.tree.read_only ? "" : '<div class="ai-acts"><button data-ingest-note="' + esc(p.path) + '">' + ingestLabel(p.path) + "</button></div>");
    }
  }

  sec("atts");
  const atts = noteAttachments(tab() && tab().note ? tab().note.text : "");
  if (atts.length) html += T('<h3>這篇的附件 <span class="n">') + atts.length + '</span></h3><div class="linklist">' +
    atts.map(a => '<a data-path="' + esc(a) + '">' + fileKind(a)[1] + " " + esc(a.split("/").pop()) + "</a>").join("") + "</div>";

  const unlinked = p.mentions.filter(m => !m.linked), linked = p.mentions.filter(m => m.linked);
  sec("links");
  html += T('<h3>潛在連結 <span class="n">') + (unlinked.length || "") + "</span></h3>" +
    (unlinked.length ? T('<div class="note-line help">這篇寫到了知識庫裡這些頁的名稱，但還沒連過去。</div>') : "");
  if (isRaw) {
    if (p.private) html += T('<div class="banner">日記不送 Jev，只看字面：出現頁面的名稱就列出來。</div>');
    else if (S.checking.has(p.path)) html += T('<div class="banner ok"><span class="spin"></span> Jev 正在判斷每個名稱是不是真的指那一頁…</div>');
    else if (!p.checked && unlinked.length) html += jevUsable() ? T('<div class="note-line">目前只看字面：出現頁面的名稱就列出來，同名但意思不同的也會列進來。') +
      (p.stale_check ? T("筆記改過了，之前的判斷可能不準。") : "") + T('<a id="check-now">請 Jev 判斷</a>：它會讀名稱前後的幾句話，判斷是不是真的在講那一頁（這幾句話會送給 Jev）。</div>') + jevWhat()
      : T('<div class="note-line">只看字面') + (S.tree.jev ? T("（Jev 關著）") : T("（沒有連接 Jev）")) + T("：出現頁面的名稱就列出來，同名但意思不同的也會列進來。</div>");
  }
  if (!unlinked.length) html += T('<div class="note-line">沒找到提到卻沒連的頁面。</div>');
  else if (isRaw && p.checked) {
    const groups = [[T("主題"), m => m.refers >= 0.8 && m.weight === 2], [T("有討論"), m => m.refers >= 0.8 && m.weight === 1], [T("順帶提到"), m => m.refers >= 0.8 && !m.weight],
      [T("待確認"), m => m.refers > 0.2 && m.refers < 0.8], [T("名稱沒被 Jev 看過"), m => m.refers == null], [T("可能不是這一頁"), m => m.refers <= 0.2]];
    for (const [label, f] of groups) {
      const ms = unlinked.filter(f);
      if (ms.length) html += '<div class="sub">' + label + " · " + ms.length + "</div>" + ms.map(mentionRow).join("");
    }
    html += T('<div class="note-line help">「主題」「有討論」「順帶提到」：Jev 有八成以上的把握，這裡講的就是那一頁，再依這篇談它多少來分。「待確認」：Jev 沒把握，後面的百分比是它覺得「是」的機會，請你自己看一眼。</div>') + jevWhat();
  } else html += unlinked.slice(0, 60).map(mentionRow).join("");
  sec("linked");
  if (linked.length) html += T('<h3>已連結 <span class="n">') + linked.length + "</span></h3>" + linked.slice(0, 40).map(mentionRow).join("");
  sec("backlinks");
  if (p.backlinks) html += T('<h3>誰連到這頁 <span class="n">') + p.backlinks.length + '</span></h3><div class="linklist">' +
    p.backlinks.slice(0, 80).map(c => '<a data-path="' + esc(c.path) + '">' + esc(c.title) + "</a>").join("") + (p.backlinks.length > 80 ? T('<div class="note-line">…還有 ') + (p.backlinks.length - 80) + T(" 頁</div>") : "") + "</div>";
  html += T('<p class="note-line help" style="margin-top:24px">點一列，會在筆記裡標出這個名稱出現的地方；點頁名打開那一頁（按住 ⌘／Ctrl 點，開在新分頁）。</p>');
  const w = jevWhat(), wi = html.indexOf(w);                 // "what is Jev" once per panel
  if (wi >= 0) html = html.slice(0, wi + w.length) + html.slice(wi + w.length).split(w).join("");
  html += "</div>";
  el.innerHTML = html;
  const c = $("#check-now");
  if (c) c.onclick = () => runCheck(p.path);
  propCard();
}

// ---------- your note's properties as a card at the top of 這篇筆記 (prototype pick 側邊卡, 2026-11-28)
// Names lead somewhere: the author to their page in the knowledge base, the book to its note, the pages into the PDF.
// 修改 turns the card into the form; it edits the editor's own properties block (hidden in the note), so changes save
// and undo like any other edit.
const propLink = v => { const m = String(v || "").match(/^\[\[([^\]|#^]+)(?:\|([^\]]*))?\]\]$/); return m ? { path: m[1].trim(), name: (m[2] || m[1].split("/").pop()).trim() } : null; };
function propRows(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return "";
  const P = {};
  for (const p of Props.parse(m[1])) if (p.key) P[p.key] = p.kind === "list" ? p.items : p.kind === "text" ? p.value : null;
  const list = k => [].concat(P[k] || []).map(x => String(x).replace(/^\[\[|\]\]$/g, "").trim()).filter(Boolean);
  const few = (xs, html, sep) => xs.slice(0, 3).map(html).join(sep) + moreBtn(xs.slice(3).map(html), sep);   // a long list: three, then "+22"
  const person = a => {
    const pg = (S.tree.pages || []).find(x => x.type === "entity" && (x.title === a || (x.aliases || []).includes(a)));
    return pg ? '<button class="prop-link" data-prop-open="' + esc(pg.path) + '" title="' + esc(T("打開知識庫裡的人物頁")) + '">' + esc(a) + "</button>"
      : '<span title="' + esc(T("知識庫還沒有這個人的頁面")) + '">' + esc(a) + "</span>";
  };
  const book = propLink(P.book), pdfL = propLink(P.pdf) || (P.pdf ? { path: String(P.pdf) } : null);
  const pdf = pdfL ? (pdfL.path.includes("/") ? pdfL.path : attachmentRel(pdfL.path)) : null;
  const pages = P.pages ? String(P.pages) : "", first = parseInt(pages, 10) || 1;
  const url = [].concat(P.source || [], P.url || []).find(v => /^https?:\/\//.test(v));
  const row = (k, v) => v ? "<dt>" + esc(T(k)) + "</dt><dd>" + v + "</dd>" : "";
  return row("作者", few(list("author"), person, T("、"))) +
    row("書", book ? '<button class="prop-link" data-prop-open="' + esc(book.path.endsWith(".md") ? book.path : book.path + ".md") + '" title="' + esc(T("打開整本書的筆記")) + '">' + esc(book.name) + "</button>" : "") +
    row("頁碼", pages ? (pdf ? '<button class="prop-link" data-prop-pdf="' + esc(pdf) + '" data-page="' + first + '" title="' + esc(T("打開 PDF 的第 {n} 頁").replace("{n}", first)) + '">p.' + esc(pages) + "</button>" : "p." + esc(pages)) : "") +
    row("PDF", pdf && !pages ? '<button class="prop-link" data-prop-pdf="' + esc(pdf) + '" data-page="1">' + esc(baseName(pdf)) + "</button>" : "") +
    row("發布日期", few(list("published"), esc, T("、"))) +
    row("原文", url ? '<a class="prop-link" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)) + "</a>" : "") +
    row("別名", few(list("aliases"), esc, T("、"))) +
    row("標籤", few(list(P.tags ? "tags" : "tag"), x => '<span class="tag">#' + esc(x.replace(/^#/, "")) + "</span>", " ")) +
    row("說明", P.description ? esc(String(P.description)) : "");
}
function propCard() {
  const el = $("#panel"), t = tab();
  if (!el) return;
  const old = el.querySelector(".prop-card"); if (old) old.remove();
  if (!t || t.kind !== "note" || !t.note || t.note.page) return;
  const canEdit = t.editing && $("#editor");
  if (!canEdit) t.propEdit = false;
  const rows = t.propEdit ? "" : propRows(liveText(t));
  if (!rows && !canEdit) return;                            // reading a note without properties: no card
  const btn = canEdit ? '<button type="button" class="prop-edit">' + esc(t.propEdit ? T("完成") : T("修改")) + "</button>" : "";
  el.insertAdjacentHTML("afterbegin", '<div class="prop-card' + (t.propEdit ? " editing" : "") + '"><div class="prop-head"><h3>' + esc(T("屬性")) + "</h3>" + btn + "</div>" +
    (t.propEdit ? '<div class="prop-form"></div>' : rows ? "<dl>" + rows + "</dl>" : '<p class="muted prop-none">' + esc(T("沒有屬性")) + "</p>") + "</div>");
  if (t.propEdit) {                                         // the form: the editor's own properties block, seen from here
    const ed = $("#editor"), fm = Wys.propsBlock(ed), box = el.querySelector(".prop-form");
    fm._pp.open = true; fm._pp.raw = false;
    Props.mount(box, "", { state: fm._pp, before: () => fm._ppBefore(), after: () => fm._ppAfter(), open: name => ed._open && ed._open(name) });
    if (!fm._pp.props.some(p => p.key)) { const nb = box.querySelector(".pp-new"); if (nb) nb.click(); }   // none yet: start the first
  }
}
function propEdit(on) {
  const t = tab(); if (!t) return;
  t.propEdit = on;
  if (on && rightHidden()) showRight("note"); else if (on && S.rtab !== "note") showRight("note");
  propCard();
}
async function openPdfAt(rel, page) {
  await openNote(rel, { newTab: true });
  const t = S.tabs.find(x => x.path === rel);
  if (t && t.page !== page) { t.page = page; if (tab() === t) renderView(); }
}
document.addEventListener("click", e => {
  const o = e.target.closest("[data-prop-open]"); if (o) { openNote(o.dataset.propOpen, { newTab: e.metaKey || e.ctrlKey }); return; }
  const p = e.target.closest("[data-prop-pdf]"); if (p) { openPdfAt(p.dataset.propPdf, +p.dataset.page); return; }
  if (e.target.closest(".prop-edit")) propEdit(!tab().propEdit);
});

function noteAttachments(text) {
  const out = new Set();
  for (const m of text.matchAll(/\[\[([^\]|#^]+)/g)) {
    const rel = TREE.images[m[1].trim().split("/").pop().toLowerCase()];
    if (rel) out.add(rel);
  }
  return [...out];
}

async function runCheck(path) {
  S.checking.add(path);
  if (tab() && tab().path === path && panelData) renderPanel(panelData);
  let err = null;
  try { await api("/api/check", { path }); } catch (e) { err = e.message; }
  S.checking.delete(path);
  if (tab() && tab().path === path) {
    await loadPanel(true);
    if (err) $("#panel").insertAdjacentHTML("afterbegin", T('<div class="banner">Jev 沒回應：') + esc(err) + T("。先列出名稱相同的頁。</div>"));
  }
}

$("#panel").addEventListener("click", async e => {
  const ing = e.target.closest("[data-ingest-note]");
  if (ing) { startAgent("ingest", { path: ing.dataset.ingestNote }); return; }
  const cmp = e.target.closest("[data-compare]");
  if (cmp) { const s = panelData.suggestions.find(x => x.key === cmp.dataset.compare); if (s) openCompare(s); return; }
  const dis = e.target.closest("[data-dismiss]");
  if (dis) {
    await api("/api/dismiss", { key: dis.dataset.dismiss });
    const card = dis.closest(".card"); card.style.opacity = .45;
    card.querySelector(".acts").innerHTML = T('<span class="muted" style="font-size:12px">已略過，不會再出現。</span> <button data-undo="') + esc(dis.dataset.dismiss) + T('">復原</button>');
    return;
  }
  const undo = e.target.closest("[data-undo]");
  if (undo) { await api("/api/dismiss", { key: undo.dataset.undo, undo: true }); loadPanel(true); return; }
  const a = e.target.closest("a[data-path]");
  if (a) { openNote(a.dataset.path, { newTab: e.metaKey || e.ctrlKey || (tab() && tab().kind === "compare") }); return; }
  const m = e.target.closest(".mention");
  if (m) {
    if (e.target.closest(".t")) { openNote(m.dataset.path, { newTab: e.metaKey || e.ctrlKey }); return; }
    const ct = tab();
    if (ct && ct.editing) { ct.peek = true; await stopEdit(ct); }   // marks need the reading view; a click in the note goes back to editing
    if (!highlight(JSON.parse(m.dataset.names))) openNote(m.dataset.path, { newTab: e.metaKey || e.ctrlKey });
  }
});

// ============================================================ search

// While typing: titles, aliases (Chinese names included) and note names, matched in the browser with
// Traditional folded to Simplified, best matches first. Enter (or the last row) searches page contents.
const input = $("#search"), quick = $("#quick");
let quickSel = -1, T2S = {}, QINDEX = [];
api("/api/t2s").then(t => { T2S = t; buildQuickIndex(); }).catch(() => {});
const fold = s => { s = s.toLowerCase(); let o = ""; for (const c of s) o += T2S[c] || c; return o; };

function buildQuickIndex() {
  if (!S.tree) return;
  QINDEX = S.tree.pages.map(p => ({ path: p.path, title: p.title, type: p.type, kind: "wiki",
    keys: [p.title, ...(p.aliases || [])].map(k => [fold(k), k]) }));
  for (const f of S.tree.raw) {
    const n = baseName(f.path);
    QINDEX.push({ path: f.path, title: n, kind: inJournal(f.path) ? "journal" : "raw", done: f.done, d: f.d, keys: [[fold(n), n]] });
  }
}

function quickScore(e, q) {
  let best = 0, via = null;
  for (const [k, orig] of e.keys) {
    const i = k.indexOf(q);
    if (i < 0) continue;
    let sc = k === q ? 100 : i === 0 ? 80 : /[\s\-_(（,.:：、·'"]/.test(k[i - 1]) ? 65 : 40;
    sc -= Math.min(k.length, 60) / 10;                         // shorter names first
    if (sc > best) { best = sc; via = orig; }
  }
  if (!best) return null;
  if (e.kind === "wiki") best += e.type === "source" ? 2 : 6;     // concept / person pages before sources
  return { e, score: best, via: via !== e.title ? via : null };
}

// With Jev on, a pause in typing (0.45 s) asks Jev too; its answer replaces the list's top group.
const JEV_CACHE = new Map();
let jevTimer, jevSeq = 0;
const jevReady = raw => jevUsable() && raw.length >= (/[\u3400-\u9fff]/.test(raw) ? 2 : 3);
function jevQuick(raw) {
  clearTimeout(jevTimer);
  if (!jevReady(raw) || JEV_CACHE.has(raw)) return;
  jevTimer = setTimeout(async () => {
    const seq = ++jevSeq;
    let r;
    try { r = await api("/api/search?q=" + encodeURIComponent(raw)); } catch (e) { r = { error: e.message }; }
    JEV_CACHE.set(raw, r);
    if (JEV_CACHE.size > 50) JEV_CACHE.delete(JEV_CACHE.keys().next().value);
    if (seq === jevSeq && input.value.trim() === raw && document.activeElement === input) renderQuick(true);
  }, 450);
}

function renderQuick(keepSel) {
  const raw = input.value.trim(), q = fold(raw);
  const selPath = keepSel === true && quickSel >= 0 ? (quick.querySelectorAll(".qi")[quickSel] || {}).dataset : null;
  quickSel = -1;
  if (!q) { quick.hidden = true; return; }
  const hits = QINDEX.map(e => quickScore(e, q)).filter(Boolean).sort((a, b) => b.score - a.score);
  const useJev = jevReady(raw), jr = useJev ? JEV_CACHE.get(raw) : null;
  const wiki = hits.filter(h => h.e.kind === "wiki").slice(0, useJev ? 4 : 7), notes = hits.filter(h => h.e.kind !== "wiki").slice(0, useJev ? 3 : 5);
  const row = h => '<div class="qi" data-path="' + esc(h.e.path) + '"><span class="qt">' + esc(h.e.title) + "</span>" +
    (h.via ? '<span class="via">' + esc(h.via) + "</span>" : "") + '<span class="muted">' +
    (h.e.kind === "wiki" ? esc(TYPE_ZH[h.e.type] || "") : h.e.kind === "journal" ? T("日記") : T("筆記")) + "</span></div>";
  let html = "";
  if (useJev) {
    html += T('<div class="qg">Jev：和「') + esc(raw) + T('」相關的頁</div>');
    if (!jr) html += T('<div class="qg"><span class="spin"></span> Jev 判斷中…</div>');
    else if (jr.error || jr.mode !== "jev") html += T('<div class="qg">Jev 沒回應') + (jr.error ? T("：") + esc(jr.error) : "") + T("，下面只列名稱相符的頁。</div>");
    else html += jr.results.slice(0, 7).map(x => '<div class="qi" data-path="' + esc(x.path) + '"><span class="qt">' + esc(x.title) + '</span><span class="muted">' +
      esc(TYPE_ZH[x.type] || "") + (x.bm25 ? T(" · 關鍵字") : x.score != null ? " · " + x.score.toFixed(2) : "") + "</span></div>").join("");
  }
  if (wiki.length) html += '<div class="qg">' + (useJev ? T("名稱相符") : T("知識庫")) + "</div>" + wiki.map(row).join("");
  if (notes.length) html += T('<div class="qg">筆記</div>') + notes.map(row).join("");
  if (!hits.length) html += T('<div class="qg">標題和別名裡沒有「') + esc(raw) + T("」</div>");
  const aiRow = T('<div class="qi ai-row" data-ai="1"><span class="qt">✦ 問 AI：「') + esc(raw) + T('」</span><span class="muted">⌘↵</span></div>');
  const asking = questionLike(raw);
  if (asking) html = aiRow + html; else html += aiRow;
  html += '<div class="qi" data-ask="1"><span>↵ ' + (useJev ? T("在左欄列出 Jev 的完整結果（前 20 頁）") : jevUsable() ? T("用 Jev 找和「") + esc(raw) + T("」相關的頁") : T("用關鍵字搜尋內容「") + esc(raw) + T("」")) + "</span></div>";
  quick.innerHTML = html;
  quick.hidden = false;
  const items = [...quick.querySelectorAll(".qi")];
  if (selPath) quickSel = items.findIndex(d => (d.dataset.path && d.dataset.path === selPath.path) || (d.dataset.ai && selPath.ai));
  else if (asking) quickSel = 0;                 // a question: Enter asks the AI
  if (quickSel >= 0) items[quickSel].classList.add("sel");
  jevQuick(raw);
}
input.addEventListener("input", () => renderQuick());
input.addEventListener("focus", () => { if (input.value.trim()) renderQuick(); });
input.addEventListener("keydown", e => {
  if (e.isComposing || e.keyCode === 229) return;              // Enter that confirms a Chinese IME candidate
  const items = [...quick.querySelectorAll(".qi")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); if (!items.length || quick.hidden) return;
    quickSel = (quickSel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((d, i) => d.classList.toggle("sel", i === quickSel));
    items[quickSel].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Escape") { quick.hidden = true; input.blur(); }
  else if (e.key === "Enter") {
    e.preventDefault();
    const it = quickSel >= 0 && !quick.hidden ? items[quickSel] : null;
    quick.hidden = true;
    if (it && it.dataset.path) return openNote(it.dataset.path, { newTab: e.metaKey || e.ctrlKey });
    if ((it && it.dataset.ai) || e.metaKey || e.ctrlKey) return askAI(input.value);
    ask(input.value.trim());
  }
});
quick.addEventListener("mousedown", e => {
  const d = e.target.closest(".qi");
  if (!d) return;
  e.preventDefault(); quick.hidden = true;
  d.dataset.path ? openNote(d.dataset.path, { newTab: e.metaKey || e.ctrlKey }) : d.dataset.ai ? askAI(input.value) : ask(input.value.trim());
});
input.addEventListener("blur", () => setTimeout(() => (quick.hidden = true), 150));
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); input.focus(); input.select(); }
});

async function ask(q) {
  if (!q) return;
  const jev = jevUsable();
  S.results = { loading: true, jev, q };
  if (L.leftOff) toggleSide("left");                         // the results show in the left column
  S.sideTab = "results"; $("#filter").value = ""; renderTree(); $("#tree").scrollTop = 0;
  const cached = jev ? JEV_CACHE.get(q) : null;
  const url = "/api/search?notes=1&q=" + encodeURIComponent(q);
  try {
    if (cached && !cached.error) S.results = Object.assign({}, cached, { notes: (await api(url + "&mode=notes")).notes });   // pages already ranked while typing
    else S.results = await api(url + (jev ? "" : "&mode=bm25"));
  } catch (e) { S.results = { mode: "bm25", results: [], notes: [], error: e.message }; }
  S.results.q = q;
  if (S.sideTab === "results") renderTree();
}

function toggleJev() {                                       // from Settings
  S.jevOn = !S.jevOn; store.set("jev-on", S.jevOn);
  api("/api/jev/pause", { paused: !S.jevOn }).catch(() => {});
  toast(S.jevOn ? T("Jev 開：搜尋、找連結、排整理順序都請 Jev 判斷。") : T("Jev 關：筆記內容不再送給 Jev。搜尋改成比對關鍵字，新筆記不會自動排順序。"));
  if (panelData && tab() && tab().kind === "note") renderPanel(panelData);
}

// ============================================================ live updates

async function refreshTree() {
  const t = await api("/api/tree");
  const first = !S.tree; S.tree = t; window.TREE = t;
  if (first && !AI.turns.length) { const last = store.get(lastChatKey(), null); if (last) openChat(last); }
  // the switch lives in the app's settings; the first time, it takes the state this browser had
  if (typeof t.jev_paused === "boolean") S.jevOn = !t.jev_paused;
  else if (t.jev) api("/api/jev/pause", { paused: !S.jevOn }).catch(() => {});
  S.rawRoot = buildRawTree(t.raw);
  queueData = null; assetsData = null;
  buildQuickIndex();
  renderTree();
}

async function poll() {
  try {
    const paths = S.tabs.filter(t => t.kind === "note").map(t => "path=" + encodeURIComponent(t.path)).join("&");
    const c = await api("/api/changes" + (paths ? "?" + paths : ""));
    if (S.sigs && (c.raw !== S.sigs.raw || c.wiki !== S.sigs.wiki)) {
      await refreshTree();
      if (c.wiki !== S.sigs.wiki && tab() && tab().kind === "note" && !tab().editing) loadPanel(true);
    }
    S.sigs = { raw: c.raw, wiki: c.wiki };
    for (const t of S.tabs) {
      if (t.kind !== "note" || !t.note || c.mtimes[t.path] == null) continue;
      if (t.saving || Math.abs(c.mtimes[t.path] - t.note.mtime) < 0.001) continue;   // its own save, in flight
      if (t.dirty) { if (!t.external) { t.external = true; if (tab() === t) renderView(); } }
      else reloadTab(t);
    }
  } catch (e) {}
  setTimeout(poll, 4000);
}

// ============================================================ resizable columns
// Drag the line between two columns; double-click it to collapse or bring back that side. Remembered.

const L = { left: store.get("w-left", 280), right: store.get("w-right", 340), leftOff: store.get("off-left", false), rightOff: store.get("off-right", false),
  cmp: store.get("w-cmp", 0.5) };
// Under NARROW px the right column hides itself so the note keeps its room; opening it then lasts until the window widens.
const NARROW = 1000;
const isNarrow = () => innerWidth < NARROW;
function rightHidden() { return L.rightOff || (isNarrow() && !L.peek); }
let wasNarrow = isNarrow();
addEventListener("resize", () => { const n = isNarrow(); if (n !== wasNarrow) { wasNarrow = n; L.peek = false; applyLayout(); } });
// the line you are reading stays put when a column opens, closes or is dragged
let readAnchor = null;   // reused while you haven't scrolled, so closing and reopening a column comes back exactly
function grabReadLine() {
  const c = $(".center"), note = $("#note") || $("#editor");
  if (!c || !note || c.scrollTop < 1 || !document.caretRangeFromPoint) return null;
  if (readAnchor && Math.abs(c.scrollTop - readAnchor.scroll) < 1 && readAnchor.node.isConnected) return readAnchor;
  const bar = $("#tabbar"), top = Math.max(c.getBoundingClientRect().top, bar ? bar.getBoundingClientRect().bottom : 0), x = note.getBoundingClientRect().left + (parseFloat(getComputedStyle(note).paddingLeft) || 0) + 4;   // inside the text, past the editor's padding
  for (const dy of [24, 36, 52, 76]) {     // the first line you can read, just under the tab bar
    const rg = document.caretRangeFromPoint(x, top + dy);
    if (!rg || !note.contains(rg.startContainer)) continue;
    const n = rg.startContainer;
    if (n.nodeType === 3 && n.length) {
      const r = document.createRange(), o = Math.min(rg.startOffset, n.length - 1);
      r.setStart(n, o); r.setEnd(n, o + 1);
      const b = r.getBoundingClientRect();
      if (b.height) return { box: r, node: n, y: b.top };   // keep the node: a range moves elsewhere when the note re-renders
    } else {
      const el = n.nodeType === 1 ? n : n.parentElement;
      if (el && el !== note) return { box: el, node: el, y: el.getBoundingClientRect().top };
    }
  }
  return null;
}
function holdReadLine(a) {
  if (!a) return;
  const c = $(".center");
  c.scrollTop += a.box.getBoundingClientRect().top - a.y;   // the page scrolls in whole pixels: within 1px
  readAnchor = Object.assign(a, { scroll: c.scrollTop });
}
let slideGen = 0;
function applyLayout() {
  const anchor = slideGen ? null : grabReadLine();     // while a column slides, the slide holds the line itself
  const c = $("#cols");
  // set on the grid itself, not through an inherited variable: a variable makes every row in the tree recompute its style on each drag frame
  c.style.gridTemplateColumns = (L.leftOff ? 0 : L.left) + "px 5px minmax(0, 1fr) 5px " + (rightHidden() ? 0 : L.right) + "px";
  c.classList.toggle("left-off", L.leftOff); c.classList.toggle("right-off", rightHidden());
  const cmpA = (L.cmp * 100).toFixed(1) + "%";
  if (cmpA !== applyLayout.cmpA) { applyLayout.cmpA = cmpA; document.documentElement.style.setProperty("--cmp-a", cmpA); }   // only when the compare split moves
  if (typeof syncToggles === "function") syncToggles();
  holdReadLine(anchor);
}
function saveLayout() {
  store.set("w-left", L.left); store.set("w-right", L.right); store.set("off-left", L.leftOff); store.set("off-right", L.rightOff); store.set("w-cmp", L.cmp);
}
function dragGutter(g, e, onMove) {
  e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add("on"); document.body.classList.add("resizing");
  const move = ev => onMove(ev);
  const up = () => { g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.classList.remove("on"); document.body.classList.remove("resizing"); saveLayout(); };
  g.addEventListener("pointermove", move); g.addEventListener("pointerup", up);
}
document.querySelectorAll(".gutter[data-gutter]").forEach(g => {
  const side = g.dataset.gutter;
  g.addEventListener("pointerdown", e => {
    const x0 = e.clientX, w0 = L[side + "Off"] ? 0 : L[side];
    dragGutter(g, e, ev => {
      const w = side === "left" ? w0 + ev.clientX - x0 : w0 - (ev.clientX - x0);
      if (w < 120) L[side + "Off"] = true;                       // drag almost shut: collapse
      else { L[side + "Off"] = false; L[side] = Math.round(Math.min(Math.max(w, 180), window.innerWidth * 0.45)); }
      applyLayout();
    });
  });
  g.addEventListener("dblclick", () => { L[side + "Off"] = !L[side + "Off"]; applyLayout(); saveLayout(); });
});
$("#view").addEventListener("pointerdown", e => {
  const g = e.target.closest(".cmp-g");
  if (!g) return;
  const box = g.parentElement.getBoundingClientRect();
  dragGutter(g, e, ev => { L.cmp = Math.min(Math.max((ev.clientX - box.left) / box.width, 0.2), 0.8); applyLayout(); });
});
$("#view").addEventListener("dblclick", e => { if (e.target.closest(".cmp-g")) { L.cmp = 0.5; applyLayout(); saveLayout(); } });
function toggleSide(side) {
  const slide = !matchMedia("(prefers-reduced-motion: reduce)").matches && innerWidth > 760;
  const cols = $("#cols"), off = () => (side === "left" ? L.leftOff : rightHidden()), closing = !off();
  const anchor = slide ? grabReadLine() : null, gen = slide ? ++slideGen : 0;   // no slide: applyLayout holds the line itself
  const col = $(side === "left" ? ".left" : ".right");
  if (slide) {
    cols.style.transition = "grid-template-columns 180ms cubic-bezier(0.23, 1, 0.32, 1)"; document.body.classList.add("sliding");   // the user chose this over instant (prototype, 2026-11-28)
    // like Notion: the column keeps its full width and slides behind the edge instead of being squeezed (left hugs its right edge)
    col.style.width = L[side] + "px"; col.style.justifySelf = side === "left" ? "unsafe end" : "start";
  }
  if (side === "right" && isNarrow()) { if (L.rightOff) L.rightOff = false; L.peek = rightHidden(); }
  else L[side + "Off"] = !L[side + "Off"];
  applyLayout(); saveLayout();
  if (!slide) return;
  if (closing) cols.classList.remove(side + "-off");      // stay visible while it slides shut
  const end = performance.now() + 190;
  const finish = () => {
    if (gen !== slideGen) return;                          // a newer toggle took over (CSS retargets from where it is), or already done
    cols.style.transition = ""; document.body.classList.remove("sliding");
    // both columns: a slide of the other column that this one took over never ran its own finish
    for (const c of document.querySelectorAll("#cols > .left, #cols > .right")) c.style.width = c.style.justifySelf = "";
    cols.classList.toggle("left-off", L.leftOff); cols.classList.toggle("right-off", rightHidden());
    slideGen = 0; holdReadLine(anchor);
  };
  const step = () => {
    if (gen !== slideGen) return;
    holdReadLine(anchor);
    if (performance.now() < end) requestAnimationFrame(step); else finish();
  };
  requestAnimationFrame(step);
  setTimeout(finish, 260);                                 // frames pause in a hidden window; the slide still ends
}
$("#toggle-left").onclick = () => toggleSide("left");
$("#toggle-right").onclick = () => toggleSide("right");
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && (e.key === "\\" || e.code === "Backslash")) { e.preventDefault(); toggleSide(e.shiftKey ? "right" : "left"); }
});
function syncToggles() {
  $("#toggle-left").classList.toggle("on", !L.leftOff); $("#toggle-right").classList.toggle("on", !rightHidden());
  $("#toggle-left").setAttribute("aria-pressed", String(!L.leftOff)); $("#toggle-right").setAttribute("aria-pressed", String(!rightHidden()));
  railSync();
};
applyLayout();

// ============================================================ start

(async function start() {
  try { await refreshTree(); } catch (e) { return; }       // no key or no vault: the start screen is showing
  $("#vault-name").textContent = S.tree.vault;
  const where = S.tree.vault_path.replace(/^\/Users\/[^/]+/, "~");
  $("#vault-where").textContent = S.tree.protected ? T("受保護・唯讀") : S.tree.read_only ? T("唯讀") : "";
  $("#vault-where").classList.toggle("prot", !!S.tree.protected);
  $("#brand").title = T("正在使用：") + where + (S.tree.protected ? T("\n這個筆記庫在 protected.txt 裡：只能看，不能改。") : "") + T("\n點一下切換筆記庫");
  document.title = S.tree.vault + " · Lumen";
  if (!["journal", "raw", "assets", "wiki"].includes(S.sideTab)) S.sideTab = "raw";
  renderTree();
  NAV.i = (history.state && history.state.i) || 0;
  if (history.state && history.state.tab != null) history.replaceState(Object.assign({}, history.state, { tab: null }), "");
  const h = decodeURIComponent(location.hash.slice(1));
  if (h) openNote(h);
  poll();
})();

// ============================================================ new note, rename, version history

async function newNote(dir) {
  try {
    const r = await api("/api/new", { dir: dir ?? ROOT(), title: T("未命名") });
    await refreshTree();
    if (dir && S.sideTab === "raw") { S.open.add(dir); store.set("open-folders", [...S.open]); renderTree(); }
    await openNote(r.path, { edit: true, newTab: true });
    const t = S.tabs.find(x => x.path === r.path);
    if (t) { t.renameNow = true; renderView(); }
  } catch (e) { toast(T("沒辦法新增：") + e.message); }
}

// the title of a note whose title is its file name: click, type, Enter
function startTitleRename(t) {
  const h = $("#view h1.renamable");
  if (!h || !t.note) return;
  const old = h.textContent;
  const inp = document.createElement("input");
  inp.className = "title-input"; inp.value = old; inp.setAttribute("aria-label", T("筆記名稱"));
  h.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async ok => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v && v !== old) await renameFile(t.path, v);
    else renderView();
    if (t.editing && $("#editor")) $("#editor").focus();
  };
  inp.addEventListener("keydown", e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  inp.addEventListener("blur", () => finish(true));
}

function renameFile(path, name) {
  const job = renameJob(path, name);
  const p = job.finally(() => { if (RENAMING === p) RENAMING = null; });
  RENAMING = p;
  return job;
}
async function renameJob(path, name) {
  const isNote = /\.md$/.test(path), file = path.split("/").pop();
  const oldName = isNote ? baseName(path) : file;
  if (name == null) {
    const ok = await dialog(T("改名"), '<input id="rename-input" class="dialog-input" value="' + esc(oldName) + '">' +
      "<p>" + (isNote ? T("筆記裡連到它的 <code>[[連結]]</code> 會一起更新。") : T("筆記裡連到這個附件的地方會一起更新。")) + "</p>", T("改名"));
    name = $("#rename-input").value.trim();
    if (!ok || !name || name === oldName) return;
  }
  const t0 = S.tabs.find(x => x.path === path);
  if (t0 && t0.dirty) {                          // unsaved edits are saved first, so nothing is lost
    if (t0 !== tab()) { toast(T("「") + t0.title + T("」還有沒儲存的修改，先存再改名。")); return; }
    await saveTab(t0);
    if (t0.dirty) return;                        // the save failed; its message is on the note
  }
  try {
    const r = await api("/api/rename", { path, name });
    if (!r.renamed) return;
    lockMoved(path, r.path);
    for (const t of S.tabs) if (t.path === path) {
      t.path = r.path; t.title = t.kind === "note" ? baseName(r.path) : r.path.split("/").pop();
      if (t.note) { t.note = Object.assign({}, t.note, { path: r.path }); reloadTab(t); }   // its `title:` may have changed
    }
    if (tab() && tab().path === r.path) history.replaceState(Object.assign({}, history.state, { path: r.path }), "", "#" + encodeURIComponent(r.path));
    await refreshTree(); assetsData = null;
    renderTabbar(); renderView();
    const newName = isNote ? baseName(r.path) : r.path.split("/").pop();
    let msg = T("改名為「") + newName + T("」");
    if (r.relinked.length) msg += T("，更新了 ") + r.relinked.length + T(" 篇筆記裡的連結");
    if (r.warnings.includes("processed")) msg += T("。這篇已整理過，知識庫要等 AI 下次整理時才會記下新位置");
    toast(msg + T("。"), { label: T("復原"), fn: () => renameFile(r.path, oldName) });
  } catch (e) { toast(T("沒改成：") + e.message); renderView(); }
}

// line diff for the version view: common head and tail, then LCS on what's left (bounded)
function lineDiff(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e), out = [];
  for (let i = 0; i < s; i++) out.push([" ", A[i]]);
  if (a2.length * b2.length > 4e6) { a2.forEach(l => out.push(["-", l])); b2.forEach(l => out.push(["+", l])); }
  else {
    const n = a2.length, m = b2.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a2[i] === b2[j]) { out.push([" ", a2[i]]); i++; j++; }
      else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) out.push(["+", b2[j++]]);
      else out.push(["-", a2[i++]]);
    }
  }
  for (let i = A.length - e; i < A.length; i++) out.push([" ", A[i]]);
  return out;
}
function diffHtml(cur, ver) {
  const d = lineDiff(cur, ver), keep = new Set();
  d.forEach((x, i) => { if (x[0] !== " ") for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
  if (!keep.size) return T('<p class="muted">和現在的內容一樣。</p>');
  let html = "", gap = false;
  d.forEach((x, i) => {
    if (!keep.has(i)) { if (!gap) { html += '<div class="d-gap">⋯</div>'; gap = true; } return; }
    gap = false;
    html += '<div class="d-' + (x[0] === "+" ? "add" : x[0] === "-" ? "del" : "same") + '">' + (esc(x[1]) || "&nbsp;") + "</div>";
  });
  return html;
}

async function showHistory(path) {
  let r;
  try { r = await api("/api/history?path=" + encodeURIComponent(path)); } catch (e) { toast(e.message); return; }
  const name = baseName(path);
  if (!r.versions.length) {
    await dialog(T("「") + name + T("」的版本"), T("<p>還沒有較早的版本。從現在起，每次儲存改動前，Lumen 會先留下前一版（連續寫作時每 10 分鐘最多留一版，每篇最多 100 版），存在筆記庫的隱藏資料夾 <code>.lumen/history/</code>。</p>"), T("好"));
    return;
  }
  let cur = "";
  try { cur = (await api("/api/note?path=" + encodeURIComponent(path))).text; } catch (e) {}
  const html = '<div class="hist"><div class="hist-list">' + r.versions.map(v => '<button data-v="' + esc(v.id) + '">' + esc(v.time) + "<span>" + fmtSize(v.size) + "</span></button>").join("") +
    T('</div><div class="hist-view" id="hist-view"><p class="muted">選左邊一個版本，看它和現在差在哪。</p></div></div>') +
    T('<p class="d-legend"><span class="d-del">現在有、還原後會拿掉</span> <span class="d-add">這個版本有、還原後會回來</span>　還原前，現在的內容會先留成一版，所以還原也能復原。</p>');
  $("#modal .modal").classList.add("wide");
  let sel = null;
  const p = dialog(T("「") + name + T("」的版本"), html, T("還原這個版本"));
  const okb = $("#modal-ok"); okb.disabled = true;
  $("#modal-body .hist-list").onclick = async e => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    document.querySelectorAll(".hist-list button").forEach(x => x.classList.toggle("on", x === b));
    try {
      const v = await api("/api/history?path=" + encodeURIComponent(path) + "&id=" + encodeURIComponent(b.dataset.v));
      sel = b.dataset.v; okb.disabled = false;
      $("#hist-view").innerHTML = diffHtml(cur, v.text);
    } catch (err) { $("#hist-view").innerHTML = '<p class="muted">' + esc(err.message) + "</p>"; }
  };
  const ok = await p;
  $("#modal .modal").classList.remove("wide"); okb.disabled = false;
  if (!ok || !sel) return;
  const t = S.tabs.find(x => x.path === path);
  if (t && t.dirty && !(await dialog(T("放棄還沒儲存的修改？"), T("<p>這篇還有沒儲存的修改，還原會蓋掉它們。</p>"), T("還原"), true))) return;
  try {
    await api("/api/history/restore", { path, id: sel });
    if (t) { t.editing = false; await reloadTab(t); }
    toast(T("還原了 ") + r.versions.find(v => v.id === sel).time + T(" 的版本。"), { label: T("復原"), fn: () => showHistory(path) });
  } catch (e) { toast(T("沒還原：") + e.message); }
}

async function showAgentDiff(id, path) {
  let r;
  try { r = await api("/api/agent/diff?id=" + encodeURIComponent(id) + "&path=" + encodeURIComponent(path)); } catch (e) { toast(e.message); return; }
  $("#modal .modal").classList.add("wide");
  await dialog(T("「") + baseName(path) + T("」這次的修改"), '<div class="hist-view">' + (r.old ? diffHtml(r.old, r.new) : '<div class="d-add">' + esc(r.new).replace(/\n/g, "<br>") + "</div>") + "</div>" +
    T('<p class="d-legend"><span class="d-add">這次加的</span> <span class="d-del">這次拿掉的</span></p>'), T("好"));
  $("#modal .modal").classList.remove("wide");
}

// ============================================================ vaults: start screen and switcher

const tilde = p => String(p || "").replace(/^\/Users\/[^/]+/, "~");
let startState = null;

async function showStart(mode) {
  const el = $("#start");
  if (mode === "nokey") {
    el.innerHTML = T('<div class="start-card"><h1>Lumen</h1><p>這個頁面要從 Lumen 的<strong>啟動連結</strong>打開。</p>') +
      T('<p class="muted">啟動 Lumen 時，終端機會印出一個帶存取碼的網址（<code>http://127.0.0.1:…/?k=…</code>）。用那個網址打開一次，這個瀏覽器之後就記得了。存取碼讓別的網站沒辦法透過瀏覽器讀你的筆記。</p></div>');
    el.hidden = false; return;
  }
  let v;
  try { v = await api("/api/vaults"); } catch (e) { return; }
  startState = { v, mode: mode || null, path: null };
  el.hidden = false;
  renderStart();
  if (mode === "open" || mode === "create") browse(mode === "create" ? (v.home + "/Documents") : v.home);
}

function renderStart() {
  const { v, mode } = startState, el = $("#start");
  const rows = v.vaults.map(x => '<div class="vault-row' + (x.path === v.current ? " current" : "") + '">' +
    '<button class="vault-open" data-open-vault="' + esc(x.path) + '"' + (x.exists ? "" : " disabled") + '><strong>' + esc(x.name) + "</strong><span>" + esc(tilde(x.path)) + "</span></button>" +
    (x.path === v.current ? T('<span class="chip">正在用</span>') : "") + (x.protected ? T('<span class="chip warn">受保護・唯讀</span>') : "") + (x.exists ? "" : T('<span class="chip warn">找不到資料夾</span>')) +
    '<button class="ghost" data-forget="' + esc(x.path) + T('" title="從清單拿掉（資料夾本身不動）">×</button></div>')).join("");
  el.innerHTML = '<div class="start-card">' + (v.current ? T('<button class="start-close" data-s="close" title="回到筆記">×</button>') : "") +
    "<h1>" + (v.current ? T("切換筆記庫") : T("歡迎使用 Lumen")) + "</h1>" +
    T('<p class="muted">筆記庫就是電腦上的一個資料夾，裡面放你的筆記（.md 檔）。Obsidian 的筆記庫也能直接打開。AI 不會改你的筆記；它整理出來的頁放在這個資料夾裡的 <code>wiki</code> 子資料夾。</p>') +
    (rows ? T('<div class="group">最近用過') + (v.vaults.some(x => x.path !== v.current) ? T('<button class="link-btn" data-forget-all="1" title="資料夾本身不動">清空清單</button>') : "") + '</div><div class="vault-list">' + rows + "</div>" : "") +
    '<div class="start-acts"><button data-s="create" class="' + (mode === "create" ? "primary" : "") + T('">＋ 建立新的筆記庫</button><button data-s="open" class="') + (mode === "open" ? "primary" : "") + T('">打開一個資料夾…</button></div>') +
    '<div id="start-pane"></div></div>';
}

async function browse(path) {
  let b;
  try { b = await api("/api/browse?path=" + encodeURIComponent(path)); } catch (e) { toast(e.message); return; }
  startState.path = b.path;
  const create = startState.mode === "create";
  const pane = $("#start-pane");
  pane.innerHTML = '<div class="browser"><div class="places">' + b.places.map(p => '<button data-browse="' + esc(p.path) + '" class="' + (p.path === b.path ? "on" : "") + '">' + esc(TS(p.name)) + "</button>").join("") + "</div>" +
    '<div class="crumbs">' + (b.parent ? '<button data-browse="' + esc(b.parent) + T('" title="上一層">↑</button>') : "") + '<span>' + esc(tilde(b.path)) + "</span>" + (b.vault ? T('<span class="chip">筆記庫</span>') : "") + "</div>" +
    '<div class="folders">' + (b.folders.length ? b.folders.map(f => '<button data-browse="' + esc(f.path) + '"><span>📁 ' + esc(f.name) + "</span>" + (f.vault ? T('<span class="chip">筆記庫</span>') : "") + "</button>").join("") : T('<p class="muted">（沒有子資料夾）</p>')) + "</div>" +
    '<div class="browse-acts">' + (create
      ? T('<label>名字 <input id="new-vault-name" class="dialog-input" placeholder="例如：我的筆記"></label><button class="primary" data-s="do-create">在「') + esc(b.name) + T('」裡建立</button>')
      : b.root ? T('<span class="muted small">選一個放筆記的資料夾（不能是整個家目錄）</span>')
        : T('<button class="primary" data-s="do-open">打開「') + esc(b.name) + T("」</button>")) + "</div></div>" +
    '<p class="muted small">' + (create ? T("會建立一個新資料夾，裡面有 <code>journal/</code>（日記）、<code>Attachments/</code>（附件）、<code>wiki/</code>（AI 的頁面）和 Obsidian 的設定，用 Obsidian 也能打開。")
      : T("打開既有的資料夾不會改動裡面的檔案。資料夾裡的筆記（.md 檔）都算你的；只有 <code>wiki</code> 子資料夾是給 AI 寫的。")) + "</p>";
  if (create) $("#new-vault-name").focus();
}

async function switchVault(action, body) {
  if (S.tabs.some(t => t.dirty) && !(await dialog(T("還有沒儲存的修改"), T("<p>切換筆記庫會關掉所有分頁，沒儲存的修改會不見。</p>"), T("切換"), true))) return;
  try {
    await api(action, body);
    S.tabs.forEach(t => (t.dirty = false));
    try { sessionStorage.removeItem("nav-max"); } catch (e) {}
    location.href = "/";
  } catch (e) { toast(e.message); }
}

$("#start").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.openVault) return switchVault("/api/vault/open", { path: b.dataset.openVault });
  if (b.dataset.forgetAll) { await api("/api/vault/forget", { all: true }); startState.v = await api("/api/vaults"); renderStart(); return; }
  if (b.dataset.forget) { await api("/api/vault/forget", { path: b.dataset.forget }); startState.v = await api("/api/vaults"); renderStart(); return; }
  if (b.dataset.browse) return browse(b.dataset.browse);
  const s = b.dataset.s;
  if (s === "close") { $("#start").hidden = true; return; }
  if (s === "open" || s === "create") { startState.mode = s; renderStart(); return browse(s === "create" ? startState.v.home + "/Documents" : startState.v.home); }
  if (s === "do-open") return switchVault("/api/vault/open", { path: startState.path });
  if (s === "do-create") {
    const name = $("#new-vault-name").value.trim();
    if (!name) { $("#new-vault-name").focus(); return; }
    return switchVault("/api/vault/create", { parent: startState.path, name });
  }
});
$("#start").addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "new-vault-name" && !e.isComposing) $("#start [data-s=do-create]").click();
  if (e.key === "Escape" && startState && startState.v.current) $("#start").hidden = true;
});

$("#brand").addEventListener("click", async e => {
  let v;
  try { v = await api("/api/vaults"); } catch (err) { return; }
  const r = $("#brand").getBoundingClientRect();
  // only what matters now: this vault and the last few others (same-named ones show their folder), one row for
  // the rest. Display, language, Jev and connecting AI live in Settings (the gear at the bottom of the rail).
  const recent = v.vaults.filter(x => x.exists && x.path !== v.current).slice(0, 3);
  const cur = v.vaults.find(x => x.path === v.current);
  const shown = (cur ? [cur] : []).concat(recent);
  const dup = name => shown.filter(x => x.name === name).length > 1;
  const where = x => x.path.split("/").slice(-2, -1)[0] || "";
  const items = shown.map(x => ({ label: (x.path === v.current ? "✓ " : T("　 ")) + x.name + (dup(x.name) ? "（" + where(x) + "）" : ""),
    fn: () => x.path !== v.current && switchVault("/api/vault/open", { path: x.path }) }));
  items.push({ label: T("　 ") + T("其他筆記庫…"), fn: () => showStart() }, null,
    { label: T("在 Finder 中顯示"), fn: () => api("/api/reveal", {}).catch(err => toast(err.message)) });
  showMenu(r.right + 6, r.top, items, [r.right, r.top + r.height / 2], false, $("#brand"));   // the vault sits in the rail: the menu opens beside it
});

// ============================================================ ask AI (Claude Code, answers only)
// One box for everything: typing finds pages; Enter searches; ⌘↵ (or the "問 AI" row, first when the text reads
// like a question) asks. The conversation lives in the right column's AI tab, next to the note's suggestions.
// The app finds the pages (Jev, or keywords with Jev off) and sends them with the open note (never the journal);
// Claude Code, with no tools, writes the answer with [[page]] citations.

const AI = { turns: [], ctx: undefined, attach: [], id: null, saved: "", list: null };   // ctx undefined: follow the open note; null: none. attach: files picked with @

// ---------- conversations are kept in the vault (.lumen/chats), so a refresh or a restart brings them back.
// A turn is saved once it has finished; what was sent with it isn't (only the question, answer and pages used).
const TURN_END = ["done", "error", "stopped", "cancelled"];
const lastChatKey = () => "ai-last:" + (S.tree ? S.tree.vault_path : "");
let chatTimer = 0;
function saveChat() {
  if (!S.tree || S.tree.read_only) return;
  const turns = AI.turns.filter(t => TURN_END.includes(t.status)).map(t => { const c = Object.assign({}, t); delete c.live; return c; });
  if (!turns.length) return;
  if (!AI.id) AI.id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const sig = AI.id + JSON.stringify(turns);
  if (sig === AI.saved) return;
  clearTimeout(chatTimer);
  chatTimer = setTimeout(() => {
    api("/api/chat/save", { id: AI.id, turns }).then(() => { AI.saved = sig; store.set(lastChatKey(), AI.id); }).catch(() => {});
  }, 400);
}
async function openChat(id) {
  try {
    const c = await api("/api/chat?id=" + encodeURIComponent(id));
    AI.turns = (c.turns || []).map(t => Object.assign(t, { restored: true }));
    AI.id = id; AI.saved = id + JSON.stringify(c.turns); AI.list = null; AI.ctx = undefined; AI.attach = [];
    store.set(lastChatKey(), id);
  } catch (e) { store.set(lastChatKey(), null); }
  renderAI();
}
async function showChats() {
  try { AI.list = (await api("/api/chats")).chats; } catch (e) { toast(e.message); return; }
  renderAI();
}
function chatListHtml() {
  if (!AI.list.length) return T('<p class="muted pad">還沒有存下來的對話。</p>');
  const when = x => new Date(x * 1000).toLocaleString(document.documentElement.lang || "zh-Hant", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return '<div class="chat-list">' + AI.list.map(c => '<div class="chat-row' + (c.id === AI.id ? " on" : "") + '"><button class="chat-open" data-chat="' + esc(c.id) + '"><span class="chat-t">' +
    esc(c.title || T("（沒有標題）")) + '</span><span class="muted small">' + when(c.updated) + "</span></button>" +
    '<button class="ghost chat-del" data-chat-del="' + esc(c.id) + T('" title="刪除這段對話（移到垃圾桶）">×</button></div>')).join("") + "</div>";
}
const CLAUDE_MODELS = [["auto", T("Claude：自動（Jev 選）")], ["haiku", T("Claude Haiku：快、省")], ["sonnet", T("Claude Sonnet：一般")], ["opus", T("Claude Opus：最強、最耗額度")]];
const GPT_TIER = { fast: T("快、省"), balanced: T("一般"), strong: T("最強、最耗額度") };
let GPT_MODELS = [];          // the models the user's ChatGPT plan offers, from its catalogue (costs no usage)
const isGpt = m => String(m || "").startsWith("chatgpt");
const CONN = { known: false, claude: false, chatgpt: false };   // which AIs are connected: the menu offers only those
function setConn(st) {
  const was = CONN.known + "," + CONN.claude + "," + CONN.chatgpt;
  Object.assign(CONN, { known: true, claude: !!st.claude.connected, chatgpt: !!st.chatgpt.connected });
  if (was !== CONN.known + "," + CONN.claude + "," + CONN.chatgpt && $("#ai-model")) renderAI();
}
function aiModels() {
  const gpt = [["chatgpt", T("ChatGPT：自動（Jev 選）")]].concat(GPT_MODELS.map(m =>
    ["chatgpt:" + m.slug, "ChatGPT " + m.name + T("：") + GPT_TIER[m.tier] + (m.legacy ? T("（舊版）") : "")]));
  if (CONN.known && !CONN.claude && !CONN.chatgpt) return [[aiModel(), T("還沒連接 AI")]];
  const all = (!CONN.known || CONN.claude ? CLAUDE_MODELS : []).concat(!CONN.known || CONN.chatgpt ? gpt : []);
  if (!all.some(([v]) => v === aiModel()) && isGpt(aiModel()) && CONN.chatgpt) all.push([aiModel(), "ChatGPT " + aiModel().slice(8)]);
  return all;
}
async function loadGptModels() {
  try { GPT_MODELS = (await api("/api/connect/chatgpt/models")).list || []; } catch (e) { GPT_MODELS = []; }
  if ($("#ai-model")) renderAI();
}
const AI_EFFORTS = [["auto", T("思考：自動")], ["low", T("思考：少")], ["medium", T("思考：一般")], ["high", T("思考：仔細")]];
const EFFORT_NAME = { low: T("想得少"), medium: T("一般"), high: T("想得仔細") };
function pref(k) { try { return localStorage.getItem("lumen." + k) || localStorage.getItem("notesapp." + k) || "auto"; } catch (e) { return "auto"; } }
function setPref(k, v) { try { localStorage.setItem("lumen." + k, v); } catch (e) {} }
const aiModel = () => pref("aiModel"), aiEffort = () => pref("aiEffort");
S.rtab = "note";

function questionLike(raw) {
  return /[?？]\s*$/.test(raw) || /(嗎|吗|呢)\s*$/.test(raw) || raw.length >= 18 ||
    /^(為什麼|为什么|怎麼|怎么|怎樣|如何|什麼|什么|哪|是否|有沒有|有没有|請|请|幫我|帮我|比較|比较|總結|总结|解釋|解释|整理|列出|找出|告訴|告诉)/.test(raw) ||
    /^(what|why|how|who|when|which|compare|summari[sz]e|explain|list)\b/i.test(raw);
}

function showRight(name) {
  if (rightHidden()) toggleSide("right");
  S.rtab = name;
  document.querySelectorAll(".rtabs button").forEach(b => b.classList.toggle("on", b.dataset.rtab === name));
  $("#panel").hidden = name !== "note"; $("#ai").hidden = name !== "ai";
  if (name === "ai") { if (!$("#ai").innerHTML) renderAI(); updateAICtx(); }
  railSync();
}
document.querySelector(".rtabs").addEventListener("click", e => { const b = e.target.closest("[data-rtab]"); if (b) showRight(b.dataset.rtab); });

function aiContext() {
  if (AI.ctx === null) return null;
  const t = tab();
  if (!t || t.kind !== "note" || !t.note) return null;
  return { path: t.path, title: t.title, private: !!t.note.private };
}

async function askAI(q) {
  q = String(q || "").trim();
  if (!q) return;
  input.value = ""; quick.hidden = true; input.blur();
  if ($("#ai-input")) $("#ai-input").value = "";
  showRight("ai");
  AI.list = null;
  const turn = { q, ctx: aiContext(), attach: AI.attach.slice(), status: "finding", sources: [], text: "" };
  AI.turns.push(turn); renderAI();
  const jev = jevUsable();
  let r = jev ? JEV_CACHE.get(q) : null;
  try { if (!r || r.error) r = await api("/api/search?q=" + encodeURIComponent(q) + (jev ? "" : "&mode=bm25")); }
  catch (e) { r = { mode: "bm25", results: [], error: e.message }; }
  turn.mode = r.mode; turn.searchError = r.error; turn.sources = (r.results || []).slice(0, 8);
  turn.status = "asking"; renderAI();
  const history = AI.turns.filter(t => t !== turn && t.status === "done").map(t => ({ q: t.q, a: t.text }));
  try {
    const gpt = isGpt(aiModel());
    const a = await api("/api/ai/ask", { q, context: turn.ctx && !turn.ctx.private ? turn.ctx.path : null, attach: turn.attach.map(x => x.path),
      sources: turn.sources.map(x => x.path), history, provider: gpt ? "chatgpt" : "claude",
      model: aiModel(), effort: aiEffort(), jev: !!jevUsable() });
    Object.assign(turn, { id: a.id, used: a.used, ctxUsed: a.context, attUsed: a.attached || [], choice: a.choice, status: "writing" });
  } catch (e) {
    turn.status = "error"; turn.error = e.message; renderAI();
    if (e.data && e.data.connect) showConnect();
    return;
  }
  renderAI();
  while (turn.status === "writing") {
    await new Promise(res => setTimeout(res, 250));
    let p;
    try { p = await api("/api/ai/poll?id=" + turn.id); } catch (e) { turn.status = "error"; turn.error = e.message; break; }
    const changed = p.text !== turn.text || p.status !== "running";
    if (p.model !== turn.model || p.why !== turn.why || p.retried !== turn.retried || !!p.held !== !!turn.held) Object.assign(turn, { model: p.model, effort: p.effort, why: p.why, retried: p.retried, held: p.held }), renderAI();
    turn.text = p.text; turn.seconds = p.seconds; turn.tokens = p.tokens; turn.quota = p.quota;
    if (p.status !== "running") { turn.status = p.status; turn.error = p.error; }
    if (changed) renderAI();
  }
  renderAI();
}

// ------------------------------------------------------------ the wiki agent (plan → your OK → act → undo)
const AGENT_STEPS = 6;
async function startAgent(task, extra) {
  if (S.tree.read_only) return toast(T("這個筆記庫只能看，不能改。"));
  showRight("ai");
  const m = aiModel(), e = aiEffort(), gpt = isGpt(m);
  AI.list = null;
  const turn = { kind: "agent", task, status: "starting", steps: [] };
  AI.turns.push(turn); renderAI();
  const body = Object.assign({ task, provider: gpt ? "chatgpt" : "claude", model: gpt ? m : m === "auto" ? null : m,
    effort: e === "auto" ? null : e, jev: !!jevUsable(), ui_lang: LANG }, extra);
  try { const r = await api("/api/agent/start", body); turn.id = r.id; }
  catch (err) {
    turn.status = "error"; turn.error = err.message; renderAI();
    if (err.data && err.data.connect) showConnect();
    return;
  }
  pollAgent(turn);
}
async function pollAgent(turn) {
  let last = "";
  for (;;) {
    let p;
    try { p = await api("/api/agent/poll?id=" + turn.id); } catch (e) { turn.status = "error"; turn.error = e.message; break; }
    Object.assign(turn, p);
    const sig = p.status + p.steps.length + (p.live || "").length;
    if (sig !== last) { last = sig; renderAI(); }
    if (!["planning", "acting"].includes(p.status)) break;
    await new Promise(res => setTimeout(res, 1000));
  }
  renderAI();
  if (turn.status === "done") { await refreshTree(); }
}
const KIND = { created: T("新"), changed: T("改"), deleted: T("刪") };
function stepsHtml(t, phase) {
  const st = t.steps.filter(x => x.phase === phase);
  if (!st.length) return "";
  const secs = x => x.secs >= 1 ? '<span class="muted"> · ' + (x.secs >= 90 ? Math.round(x.secs / 60) + T(" 分") : Math.round(x.secs) + T(" 秒")) + "</span>" : "";
  const row = x => '<div class="ag-step' + (x.ok === false ? " bad" : "") + '">' + (x.ok === false ? "✗ " : x.ok ? "· " : "… ") + esc(TS(x.what)) + secs(x) + "</div>";
  const live = (phase === "plan" ? t.status === "planning" : t.status === "acting");
  if (live) return '<div class="ag-steps">' + st.slice(-AGENT_STEPS).map(row).join("") + "</div>";
  return '<details class="ag-steps"><summary>' + (phase === "plan" ? T("讀了、查了 ") : T("做了 ")) + st.length + T(" 步</summary>") + st.map(row).join("") + "</details>";
}
function planHtml(plan) {
  if (!plan) return T('<div class="banner">AI 沒有照格式列出計畫。讀上面它寫的內容，再決定要不要繼續。</div>');
  const li = xs => xs.map(x => "<li>" + x + "</li>").join("");
  let h = '<div class="ag-plan"><div class="ag-sum">' + esc(plan.summary || "") + "</div>";
  if ((plan.takeaways || []).length) h += T("<h4>這篇的重點</h4><ul>") + li(plan.takeaways.map(esc)) + "</ul>";
  if ((plan.create || []).length) h += T("<h4>新增 ") + plan.create.length + T(" 頁</h4><ul>") + li(plan.create.map(x => md("[[" + x.page + "]]").replace(/^<p>|<\/p>$/g, "") +  ' <span class="muted">' + esc(TYPE_ZH[x.type] || x.type || "") + "</span><div class=\"muted\">" + esc(x.why || "") + "</div>")) + "</ul>";
  if ((plan.update || []).length) h += T("<h4>更新 ") + plan.update.length + T(" 頁</h4><ul>") + li(plan.update.map(x => md("[[" + x.page + "]]").replace(/^<p>|<\/p>$/g, "") + '<div class="muted">' + esc(x.why || "") + "</div>")) + "</ul>";
  if (plan.notes) h += T('<h4>其他說明</h4><p class="muted">') + esc(plan.notes) + "</p>";
  return h + "</div>";
}
const AG_SEEN = new Map();   // turn id → status last rendered; a new stage (plan ready, done) enters once
const AG_ENTER = new Map();  // turn id → time the entrance started: renders in the same moment (pollAgent renders twice) keep it
function agentHtml(t) {
  const name = { ingest: T("整理筆記"), analysis: T("存進知識庫"), lint: T("檢查知識庫") }[t.task] || T("工作");
  let h = '<div class="ai-turn ag"><div class="ai-q">✦ ' + esc(TS(t.label) || name) + "</div>";
  const prev = AG_SEEN.get(t.id); AG_SEEN.set(t.id, t.status);
  if (prev !== undefined && prev !== t.status && (t.status === "waiting" || t.status === "done")) AG_ENTER.set(t.id, performance.now());
  const enter = performance.now() - (AG_ENTER.get(t.id) || -1e9) < 32;   // within one frame of the stage change; later re-renders don't replay it
  const open = () => '<div class="ag-stage' + (enter ? " ag-enter" : "") + '">';
  if (t.model) h += '<div class="ai-ctxline">' + esc(cap(t.model)) + T("，") + esc(EFFORT_NAME[t.effort] || t.effort) + (t.jev ? T(" · Jev 開") : T(" · Jev 關")) + "</div>";
  h += '<div class="ai-a">';
  if (t.status === "starting") h += T('<div class="muted"><span class="spin"></span> 準備…</div>');
  if (t.status === "planning") h += T('<div class="muted"><span class="spin"></span> AI 正在讀這篇，規劃怎麼整理…</div>');
  h += stepsHtml(t, "plan");
  let s1 = h.length;
  if (t.message) h += md(t.message);
  if (t.plan !== undefined && t.status !== "planning" && t.status !== "starting" && t.task && (t.message || t.plan)) h += planHtml(t.plan);
  if (t.status === "waiting") h += T('<p class="note-line">上面是 AI 打算怎麼做，還沒動手。想改的話寫在下面，不寫也可以。</p><textarea class="ag-note" rows="2" placeholder="例如：不要新增 X 頁；整篇都讀"></textarea>') +
    '<div class="ai-acts"><button class="primary" data-ag-go="' + esc(t.id) + T('">開始整理</button><button data-ag-cancel="') + esc(t.id) + T('">取消</button></div>') +
    T('<p class="muted small">AI 只會改知識庫裡的頁，不會動你的筆記。做完會列出改了哪些頁，不滿意可以全部還原。</p>');
  if (t.status === "waiting") h = h.slice(0, s1) + open() + h.slice(s1) + "</div>";
  if (t.status === "acting") h += T('<div class="muted"><span class="spin"></span> AI 正在寫摘要、補進相關的頁…</div>');
  h += stepsHtml(t, "act");
  if (t.status === "acting" && t.live) h += '<div class="muted small">' + esc(t.live.slice(-200)) + "</div>";
  let s2 = h.length;
  if (t.status === "done" || ((t.status === "stopped" || t.status === "error") && (t.changes || []).length)) {
    if (t.report && t.status === "done") h += md(t.report);
    const ch = t.changes || [];
    h += '<div class="ag-changes"><h4>' + (ch.length ? T("改了 ") + ch.length + T(" 個檔案") : T("沒有改任何檔案")) + (t.undone ? T("（已全部復原）") : "") + "</h4>" +
      ch.map(c => '<div class="ag-ch"><span class="ag-k ' + c.kind + '">' + KIND[c.kind] + "</span>" + '<a class="wl" data-path="' + esc(c.path) + '">' + esc(c.path.replace(/^wiki\//, "").replace(/\.md$/, "")) + "</a>" +
        '<button class="ghost" data-ag-diff="' + esc(c.path) + '" data-ag-id="' + esc(t.id) + T('">差異</button></div>')).join("") + "</div>";
    if ((t.outside || []).length) h += T('<div class="banner">注意：這段時間知識庫以外也有檔案變了（可能是你自己改的）：') + t.outside.slice(0, 5).map(esc).join(T("、")) + "</div>";
    if (ch.length && !t.undone) h += '<div class="ai-acts"><button data-ag-undo="' + esc(t.id) + T('">全部復原</button></div>');
  }
  if (t.status === "done" && t.part && t.part.next && !t.undone)
    h += T('<p class="muted small">這篇很長，一次整理一部分（第 ') + (t.part.i + 1) + T(" 部分，共 ") + t.part.n + T("），每部分的重點抓得比整篇一次完整。</p>") +
      '<div class="ai-acts"><button class="primary" data-ag-next="' + esc(t.part.path) + '" data-ag-part="' + t.part.next.i + T('">整理下一部分：') + esc(t.part.next.name) + "</button></div>";
  else if (t.status === "done" && t.part && !t.part.next) h += T('<p class="muted small">這篇的 ') + t.part.n + T(" 個部分都整理過了。</p>");
  if (t.status === "done") h = h.slice(0, s2) + open() + h.slice(s2) + "</div>";
  if (t.status === "error") h += T('<div class="banner">沒有完成：') + esc(TS(t.error || "")) + (/log ?in|login|auth|登入/i.test(t.error || "") ? T("。在終端機打 <code>claude</code> 登入後再試。") : "") + "</div>";
  if (t.status === "stopped") h += T('<div class="ai-meta">已停止。') + ((t.changes || []).length ? "" : "") + "</div>";
  if (t.status === "cancelled") h += T('<div class="ai-meta">沒有執行。</div>');
  if (["planning", "acting"].includes(t.status)) h += '<div class="ai-acts"><button data-ag-stop="' + esc(t.id) + T('">停止</button></div>');
  if (!["planning", "acting", "starting"].includes(t.status) && (t.seconds || usageHtml(t))) h += '<div class="ai-meta">' + [t.seconds ? T("花了 ") + Math.round(t.seconds) + T(" 秒") : "", usageHtml(t)].filter(Boolean).join(" · ") + "</div>";
  return h + "</div></div>";
}

function turnHtml(t) {
  if (t.kind === "agent") return agentHtml(t);
  let h = '<div class="ai-turn"><div class="ai-q">' + esc(t.q) + "</div>";
  if (t.ctx) h += T('<div class="ai-ctxline">背景：') + esc(t.ctx.title) + (t.ctx.private ? T("（日記，不送出）") : "") + "</div>";
  if (t.status === "finding") return h + T('<div class="ai-a muted"><span class="spin"></span> 找相關的頁…</div></div>');
  if (t.status === "asking") return h + T('<div class="ai-a muted"><span class="spin"></span> 交給 Claude…</div></div>');
  if (t.status === "writing" && !t.text) h += '<div class="ai-a muted"><span class="spin"></span> ' + (!t.model ? (t.choice === "auto" ? T("Jev 選模型…") : T("準備…")) :
    esc(cap(t.model)) + (t.held ? T(" 在寫，Jev 正在確認開頭…") : t.retried ? T(" 重新回答（第 ") + (t.retried + 1) + T(" 次）…") : T(" 想一下…"))) + "</div>";
  h += '<div class="ai-a">' + (t.text ? md(t.text) : "") + (t.status === "writing" && t.text ? '<span class="ai-caret"></span>' : "");
  if (t.status === "error") h += T('<div class="banner">沒有回答：') + esc(TS(t.error || "")) +
    (/log ?in|login|auth|登入/i.test(t.error || "") ? T("。在終端機打 <code>claude</code> 登入後再試。") : "") + "</div>";
  if (t.status === "stopped") h += T('<div class="ai-meta">已停止。</div>');
  const used = t.used || [];
  const attU = t.attUsed || [];
  if (t.status !== "writing" && (used.length || t.ctxUsed || attU.length)) {
    h += T('<details class="ai-used"><summary>讀了') + (t.ctxUsed ? T("背景筆記和 ") : " ") + (attU.length ? attU.length + T(" 個 @ 的檔案和 ") : "") + used.length + T(" 頁") +
      (t.mode === "jev" ? T("（Jev 找的）") : T("（關鍵字找的") + (t.searchError ? T("，Jev 沒回應") : "") + T("）")) + (t.model ? " · " + esc(cap(t.model)) + T("，") + esc(EFFORT_NAME[t.effort] || t.effort) + (t.why ? T("（") + esc(TS(t.why)) + T("）") : "") : "") + (t.seconds ? " · " + t.seconds + T(" 秒") : "") + "</summary>" +
      (t.ctxUsed ? '<a class="wl" data-path="' + esc(t.ctxUsed.path) + '">' + esc(t.ctxUsed.title) + T("</a>（背景）") : "") +
      attU.map(u => '<a class="wl" data-path="' + esc(u.path) + '">@' + esc(u.title) + "</a>").join("") +
      used.map(u => '<a class="wl" data-path="' + esc(u.path) + '">' + esc(u.title) + "</a>").join("") + "</details>";
  }
  if (t.status !== "writing" && usageHtml(t)) h += '<div class="ai-meta">' + usageHtml(t) + "</div>";
  if (t.status === "writing") h += '<div class="ai-acts"><button data-stop="' + esc(t.id) + T('">停止</button></div>');
  else if (t.status === "done") h += '<div class="ai-acts"><button data-save="' + AI.turns.indexOf(t) + T('" title="把這個回答整理成知識庫裡的一頁，之後搜尋得到">存進知識庫</button>') +
    (t.ctx && !t.ctx.private && mine(t.ctx.path) ? '<button data-ingest="' + esc(t.ctx.path) + T('">整理「') + esc(t.ctx.title) + T("」</button>") : "") + "</div>";
  return h + "</div></div>";
}

const cap = m => m ? m[0].toUpperCase() + m.slice(1) : "";
// What a run used, roughly: tokens (a compact number), and how much the account's 5-hour window went up. Both come
// with the answer Claude Code or ChatGPT already sends; nothing extra is asked.
function usageHtml(t) {
  const tk = t.tokens || {}, w = (t.quota || {})["5h"], parts = [];
  const n = (tk.in || 0) + (tk.out || 0);
  if (n) parts.push(T("約 ") + new Intl.NumberFormat(document.documentElement.lang || "zh-Hant", { notation: "compact", maximumFractionDigits: 1 }).format(n) + T(" token"));
  if (w) { const d = Math.round(Math.max(0, w.end - w.start)); parts.push(T("5 小時額度 ") + (d >= 1 ? "+" + d + "%" : T("不到 1%"))); }
  return parts.length ? '<span title="' + T("大概的用量。額度是整個帳號的，同時在別處用 AI 也會算進來。") + '">' + parts.join(" · ") + "</span>" : "";
}
document.addEventListener("change", e => {
  if (e.target.id === "ai-model") setPref("aiModel", e.target.value);
  if (e.target.id === "ai-effort") setPref("aiEffort", e.target.value);
});

function renderAI() {
  const el = $("#ai");
  const old = $("#ai-input"), draft = old ? old.value : "", focused = old && document.activeElement === old, caret0 = old ? old.selectionStart : 0;
  const conv0 = $("#ai-conv"), atBottom = !conv0 || conv0.scrollHeight - conv0.scrollTop - conv0.clientHeight < 40;
  let conv = "";
  if (!AI.turns.length) {
    const ctx = aiContext();
    const ex = (ctx && !ctx.private ? [T("這篇的重點是什麼？"), T("這篇和我知識庫裡哪些概念有關？")] : []).concat([T("我的筆記裡有哪些互相矛盾的說法？"), T("保險和信任有什麼關係？")]);
    conv = T('<div class="ai-intro"><h3>✦ 問 AI</h3><p>在上面的搜尋框打問題按 ⌘↵，或在下面直接問。Lumen 先找出相關的頁，連同目前打開的筆記交給 AI，回答裡的頁面都能點。</p>') +
      T('<p class="muted">AI 只回答，不能開檔案，也不會改任何東西。日記永遠不送出。</p>') +
      '<div class="ai-examples">' + ex.map(x => '<button data-example="' + esc(x) + '">' + esc(x) + "</button>").join("") + "</div></div>";
  }
  conv += AI.turns.map(turnHtml).join("");
  if (AI.list) conv = chatListHtml();
  el.innerHTML = '<div class="ai-head"><span>' + (AI.list ? T("對話紀錄") : T("對話")) + "</span><span>" +
    (AI.list ? T('<button class="ghost" data-chats-close>回到對話</button>') : T('<button class="ghost" data-chats>對話紀錄</button>')) +
    (AI.turns.length || AI.list ? T('<button class="ghost" data-new>新對話</button>') : "") + "</span></div>" +
    '<div class="ai-conv" id="ai-conv">' + conv + "</div>" +
    '<div class="ai-composer"><div id="ai-at" class="ai-at" hidden></div><div id="ai-ctx" class="ai-ctx"></div>' +
    T('<textarea id="ai-input" rows="2" placeholder="接著問…（Enter 送出，Shift+Enter 換行，@ 加入檔案）"></textarea>') +
    T('<div class="ai-send-row"><select id="ai-model" title="回答用的模型">').replace('<div class="ai-send-row">', '<div class="ai-send-row"><button class="ai-opt" id="ai-opt" type="button"></button>') + aiModels().map(([v, l]) => '<option value="' + v + '"' + (v === aiModel() ? " selected" : "") + ">" + l + "</option>").join("") +
    "</select>" +
    T('<select id="ai-effort" title="AI 回答前要想多久。選「自動」時，照你在問題裡的要求；沒說的話，由 Jev 依問題難度決定。">') + AI_EFFORTS.map(([v, l]) => '<option value="' + v + '"' + (v === aiEffort() ? " selected" : "") + ">" + l + "</option>").join("") +
    T('</select><button class="primary" id="ai-send">送出</button></div><div id="ai-sends" class="muted"></div></div>');
  const inp = $("#ai-input"); inp.value = draft; if (focused) inp.focus();
  const c = $("#ai-conv"); if (atBottom) c.scrollTop = c.scrollHeight; else if (conv0) c.scrollTop = conv0.scrollTop;
  updateAICtx();
  if (focused && AT.start >= 0) { inp.selectionStart = inp.selectionEnd = caret0; renderAt(inp); }   // a redraw (the connection check) mustn't close the @ list
  saveChat();
}

function updateAICtx() {
  const box = $("#ai-ctx");
  if (!box) return;
  const ctx = aiContext();
  const att = AI.attach.filter(a => !ctx || a.path !== ctx.path);
  box.innerHTML = (ctx ? T('<span class="chip ctx">以「') + esc(ctx.title) + T("」為背景") + (ctx.private ? T("（日記，不送出）") : "") + T(' <button data-ctx-off title="不要用這篇當背景">×</button></span>')
    : AI.ctx === null && tab() && tab().kind === "note" ? T('<button class="link-btn" data-ctx-on>＋ 用目前的筆記當背景</button>') : att.length ? "" : T('<span class="muted">沒有背景筆記</span>')) +
    att.map(a => '<span class="chip ctx at">@' + esc(a.title) + ' <button data-at-off="' + esc(a.path) + T('" title="不要用這個檔案當背景">×</button></span>')).join("");
  $("#ai-sends").textContent = T("會送給 ") + (isGpt(aiModel()) ? "ChatGPT" : "Claude") + T("：問題、相關的頁") + (ctx && !ctx.private ? T("、背景筆記") : "") +
    (att.length ? T("、@ 的檔案") : "") + T("、這段對話。日記不送。");
  aiOptLabel();
}

$("#ai").addEventListener("click", e => {
  const a = e.target.closest("a.wl");
  if (a && a.dataset.path) { e.preventDefault(); openNote(a.dataset.path, { newTab: e.metaKey || e.ctrlKey }); return; }
  const att = e.target.closest("a.att");
  if (att) { e.preventDefault(); openNote(att.dataset.file); return; }
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.example) return askAI(b.dataset.example);
  if (b.dataset.stop) { api("/api/ai/stop", { id: b.dataset.stop }).catch(() => {}); return; }
  if (b.dataset.save !== undefined) {
    const t = AI.turns[+b.dataset.save];
    return startAgent("analysis", { q: t.q, answer: t.text, sources: (t.used || []).map(u => u.path) });
  }
  if (b.dataset.ingest) return startAgent("ingest", { path: b.dataset.ingest });
  if (b.dataset.agNext) return startAgent("ingest", { path: b.dataset.agNext, part: +b.dataset.agPart });
  if (b.dataset.agGo) {
    const note = (b.closest(".ai-a").querySelector(".ag-note") || {}).value || "";
    const t = AI.turns.find(x => x.id === b.dataset.agGo);
    api("/api/agent/approve", { id: b.dataset.agGo, note }).then(() => { t.status = "acting"; renderAI(); pollAgent(t); }).catch(err => toast(err.message));
    return;
  }
  if (b.dataset.agCancel) { const t = AI.turns.find(x => x.id === b.dataset.agCancel); api("/api/agent/stop", { id: t.id }).then(() => { t.status = "cancelled"; renderAI(); }); return; }
  if (b.dataset.agStop) { api("/api/agent/stop", { id: b.dataset.agStop }).catch(() => {}); return; }
  if (b.dataset.agDiff) return showAgentDiff(b.dataset.agId, b.dataset.agDiff);
  if (b.dataset.agUndo) {
    const t = AI.turns.find(x => x.id === b.dataset.agUndo);
    dialog(T("全部復原？"), T("<p>把這次改的 ") + t.changes.length + T(" 個知識庫的頁回到改之前的樣子，這次新增的頁移到垃圾桶。改回去之前，這次寫的內容會先存成一個版本，之後還找得回來。</p>"), T("全部復原"), true).then(ok => {
      if (!ok) return;
      api("/api/agent/undo", { id: t.id }).then(async () => { t.undone = true; renderAI(); await refreshTree(); toast(T("復原了。")); }).catch(err => toast(err.message));
    });
    return;
  }
  if (b.hasAttribute("data-ctx-off")) { AI.ctx = null; updateAICtx(); return; }
  if (b.dataset.atOff) { AI.attach = AI.attach.filter(a => a.path !== b.dataset.atOff); updateAICtx(); return; }
  if (b.hasAttribute("data-ctx-on")) { AI.ctx = undefined; updateAICtx(); return; }
  if (b.hasAttribute("data-new")) { AI.turns = []; AI.ctx = undefined; AI.attach = []; AI.id = null; AI.saved = ""; AI.list = null; store.set(lastChatKey(), null); renderAI(); return; }
  if (b.hasAttribute("data-chats")) return showChats();
  if (b.hasAttribute("data-chats-close")) { AI.list = null; renderAI(); return; }
  if (b.dataset.chat) return openChat(b.dataset.chat);
  if (b.dataset.chatDel) {
    const id = b.dataset.chatDel;
    api("/api/chat/delete", { id }).then(() => {
      if (id === AI.id) { AI.turns = []; AI.id = null; AI.saved = ""; store.set(lastChatKey(), null); }
      showChats(); toast(T("移到垃圾桶了。"));
    }).catch(err => toast(err.message));
    return;
  }
  if (b.id === "ai-send") { askAI($("#ai-input").value); return; }
});
// ---------- @ in the chat box: pick files (notes, knowledge pages) to send as background with the question.
// "@" or "＠" after a space, the start, or a CJK character opens the list; the letters after it filter it (titles and
// aliases, like the quick search); ↑↓ choose, Enter/Tab pick, Esc closes. The journal is never offered.
const AT = { start: -1, hits: [], sel: 0, rel: {}, key: "", timer: null };
function atQuery(inp) {
  const before = inp.value.slice(0, inp.selectionStart);
  const m = before.match(/(^|[^A-Za-z0-9._%+-])[@＠]([^\s@＠]{0,40})$/);
  return m ? { start: before.length - m[2].length - 1, q: m[2] } : null;
}
// The background the related pages are judged on: the open note, the picked files, the text typed (without the @query).
// Cached per key, so typing after the @ or opening it again does not ask again.
function atBackground(inp) {
  const a = atQuery(inp), c = aiContext();
  const typed = a ? inp.value.slice(0, a.start) + inp.value.slice(inp.selectionStart) : inp.value;
  const ctx = c && !c.private ? c.path : null;
  const attach = AI.attach.map(x => x.path);
  const find = a ? a.q.trim() : "";                 // the words typed after @: what the person is looking for
  return { key: JSON.stringify([ctx, attach, typed.trim(), find, jevUsable()]), body: { context: ctx, attach, q: typed.trim(), find, jev: jevUsable() } };
}
function atRelated(inp) {
  const bg = atBackground(inp);
  AT.key = bg.key;
  const c = AT.rel[bg.key];
  if (c) return c;
  clearTimeout(AT.timer);
  AT.timer = setTimeout(async () => {
    let r;
    try { r = await api("/api/ai/related", bg.body); } catch (e) { r = { mode: "bm25", results: [] }; }
    AT.rel[bg.key] = { mode: r.mode, results: r.results || [] };
    const i2 = $("#ai-input");
    if (AT.key === bg.key && i2 && AT.start >= 0 && !$("#ai-at").hidden) renderAt(i2);   // same selection: only the rows change
  }, bg.body.find ? 400 : 250);                     // typing: wait for a pause before asking Jev
  return { wait: true, results: [] };
}
function atHits(q, rel) {
  const f = fold(q.trim());
  const picked = new Set(AI.attach.map(a => a.path));
  const ctxPath = (aiContext() || {}).path;
  const order = new Map(rel.results.map((r, i) => [r.path, i]));
  const okE = e => e.kind !== "journal" && !inJournal(e.path) && !picked.has(e.path) && e.path !== ctxPath;
  if (!f) {                                          // nothing typed yet: the related pages, then the notes open in tabs
    const out = rel.results.filter(r => !inJournal(r.path) && !picked.has(r.path) && r.path !== ctxPath)
      .map(r => ({ e: { path: r.path, title: r.title, kind: "wiki", type: r.type }, rel: true }));
    const seen = new Set(out.map(h => h.e.path));
    for (const t of S.tabs) {
      if (out.length >= 8) break;
      if (t.kind === "note" && t.path && t.path !== ctxPath && !inJournal(t.path) && !picked.has(t.path) && !seen.has(t.path) && seen.add(t.path))
        out.push({ e: { path: t.path, title: t.title, kind: t.path.startsWith("wiki/") ? "wiki" : "raw" } });
    }
    return out.slice(0, 8);
  }
  // typed: what Jev (or BM25) judged for the words with the background, in its order, then names that match
  const out = rel.results.filter(r => !inJournal(r.path) && !picked.has(r.path) && r.path !== ctxPath).slice(0, 5)
    .map(r => ({ e: { path: r.path, title: r.title, kind: "wiki", type: r.type }, rel: true }));
  const seen = new Set(out.map(h => h.e.path));
  const names = QINDEX.filter(e => okE(e) && !seen.has(e.path)).map(e => quickScore(e, f)).filter(Boolean).sort((a, b) => b.score - a.score);
  return out.concat(names).slice(0, 8);
}
function renderAt(inp) {
  const box = $("#ai-at"), a = atQuery(inp);
  if (!box) return;
  if (!a) { box.hidden = true; AT.start = -1; return; }
  const rel = atRelated(inp);
  AT.start = a.start; AT.hits = atHits(a.q, rel); AT.sel = Math.min(AT.sel, Math.max(0, AT.hits.length - 1));
  const relN = AT.hits.filter(h => h.rel).length;
  const label = rel.wait ? '<div class="qg"><span class="spin"></span> ' + (a.q ? (jevUsable() ? T("Jev 判斷中…") : T("搜尋中…")) : T("找和目前背景最相關的…")) + "</div>"
    : relN ? '<div class="qg">' + (a.q ? (rel.mode === "jev" ? T("Jev：和「") : T("關鍵字：和「")) + esc(a.q) + T("」最相關") : (rel.mode === "jev" ? T("Jev：和目前背景最相關") : T("關鍵字：和目前背景相關"))) + "</div>" : "";
  box.innerHTML = label + (AT.hits.length ? AT.hits.map((h, i) => (a.q && !h.rel && (i === 0 ? !rel.wait : AT.hits[i - 1].rel) ? '<div class="qg">' + T("名稱相符") + "</div>" : "") +
      '<div class="qi' + (i === AT.sel ? " sel" : "") + '" data-at="' + i + '"><span class="qt">' + esc(h.e.title) + '</span><span class="muted">' +
      (h.e.kind === "wiki" ? esc(TYPE_ZH[h.e.type] || T("知識庫")) : T("筆記")) + "</span></div>").join("")
    : rel.wait ? "" : '<div class="qg">' + (a.q ? T("沒有名稱含「") + esc(a.q) + T("」的檔案") : T("知識庫裡沒有和目前背景明顯相關的頁。打字找檔案（筆記或知識庫的頁）")) + "</div>");
  box.hidden = false;
}
function pickAt(i) {
  const inp = $("#ai-input"), h = AT.hits[i];
  if (!inp || !h || AT.start < 0) return;
  const end = inp.selectionStart;
  inp.value = inp.value.slice(0, AT.start) + inp.value.slice(end);
  inp.selectionStart = inp.selectionEnd = AT.start;
  if (!AI.attach.some(a => a.path === h.e.path)) AI.attach.push({ path: h.e.path, title: h.e.title });
  AT.start = -1; AT.sel = 0; $("#ai-at").hidden = true; updateAICtx(); inp.focus();
}
$("#ai").addEventListener("input", e => { if (e.target.id === "ai-input") { AT.sel = 0; renderAt(e.target); } });
$("#ai").addEventListener("keydown", e => {
  if (e.target.id !== "ai-input" || AT.start < 0 || $("#ai-at").hidden || e.isComposing || e.keyCode === 229) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); e.stopImmediatePropagation();
    if (AT.hits.length) AT.sel = (AT.sel + (e.key === "ArrowDown" ? 1 : -1) + AT.hits.length) % AT.hits.length;
    renderAt(e.target);
  } else if ((e.key === "Enter" || e.key === "Tab") && AT.hits.length) { e.preventDefault(); e.stopImmediatePropagation(); pickAt(AT.sel); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); AT.start = -1; $("#ai-at").hidden = true; }
}, true);
$("#ai").addEventListener("mousedown", e => {
  const r = e.target.closest("[data-at]");
  if (r) { e.preventDefault(); pickAt(+r.dataset.at); }
});
$("#ai").addEventListener("focusout", e => { if (e.target.id === "ai-input") setTimeout(() => { const b = $("#ai-at"); if (b && document.activeElement.id !== "ai-input") b.hidden = true; }, 150); });
$("#ai").addEventListener("keydown", e => {
  if (e.target.id !== "ai-input" || e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault(); askAI(e.target.value);
});


// ============================================================ connect AI (Claude, ChatGPT, Jev) and the wiki's language
// Each person uses their own: their Claude subscription through Claude Code (Anthropic's own sign-in in the
// browser; the app never sees it), their ChatGPT plan through OpenAI's "Sign in with ChatGPT", their own Jev key.


const CN = { open: false, timer: null, models: null, jevMsg: "", codeMsg: "" };

function showConnect() {
  let el = $("#connect");
  if (!el) {
    el = document.createElement("div"); el.id = "connect"; el.className = "cn-back";
    el.innerHTML = T('<div class="cn" role="dialog" aria-modal="true" aria-label="連接 AI"><div class="cn-head"><h2>連接 AI</h2>') +
      T('<button class="ghost" data-cn-close title="關閉">✕</button></div><div id="cn-body"><p class="muted">檢查中…</p></div></div>');
    document.body.append(el);
    el.addEventListener("click", connectClick);
    el.addEventListener("keydown", e => {
      if (e.key === "Escape") closeConnect();
      if (e.key === "Enter" && e.target.id === "cn-jev-key") connectClick({ target: $("[data-cn=jev-save]") });
    });
  }
  el.hidden = false; CN.open = true;
  refreshConnect();
}
function closeConnect() {
  const el = $("#connect"); if (el) el.hidden = true;
  CN.open = false; clearTimeout(CN.timer);
}

async function refreshConnect() {
  clearTimeout(CN.timer);
  if (!CN.open) return;
  let st;
  try { st = await api("/api/connect/status"); } catch (e) { $("#cn-body").innerHTML = '<p class="cn-err">' + esc(e.message) + "</p>"; return; }
  if (!CN.open) return;
  const keep = { key: ($("#cn-jev-key") || {}).value || "", focus: document.activeElement && document.activeElement.id };
  const html = [claudeCard(st.claude), chatgptCard(st.chatgpt), jevCard(st.jev)];
  const body = $("#cn-body");
  if (!body.querySelector(".cn-slot")) {
    body.innerHTML = T('<p class="muted cn-lead">用你自己的帳號。Lumen 看不到你的密碼，用量算在你的方案裡。Claude 和 ChatGPT 至少連一個。</p>') +
      '<div class="cn-slot"></div><div class="cn-slot"></div><div class="cn-slot"></div>';
  }
  // only the cards that changed are redrawn: a poll while Claude installs never swallows a click elsewhere
  body.querySelectorAll(".cn-slot").forEach((slot, i) => {
    if (slot.dataset.html !== html[i]) { slot.innerHTML = html[i]; slot.dataset.html = html[i]; }
  });
  if ($("#cn-jev-key") && !$("#cn-jev-key").value) $("#cn-jev-key").value = keep.key;
  if (keep.focus && $("#" + keep.focus) && document.activeElement.id !== keep.focus) $("#" + keep.focus).focus();
  if (st.chatgpt.welcome) gptWelcome();
  const cj = st.claude.job || {};
  if (cj.status === "running" || (cj.status === "waiting" && !st.claude.logged_in)) CN.timer = setTimeout(refreshConnect, 2000);
  // the answer box uses whichever AI is connected, without asking
  setConn(st);
  if (st.chatgpt.connected && !st.claude.connected && !isGpt(aiModel())) setPref("aiModel", "chatgpt");
  if (!st.chatgpt.connected && st.claude.connected && isGpt(aiModel())) setPref("aiModel", "auto");
  if (st.chatgpt.connected && !GPT_MODELS.length) loadGptModels();
  if (!st.chatgpt.connected) GPT_MODELS = [];
  if (CN.waitGpt && !st.chatgpt.connected) CN.timer = setTimeout(refreshConnect, 2000);
  if (st.chatgpt.connected) CN.waitGpt = false;
}

// Every card follows one rule: 未連接 → 「連接」; 連接中… → 「取消」; 已連接 → 「中斷連接」 (and 「管理用量」 where the
// service has a usage page). Each card: what it is for, what is in use now, the buttons, one line on what Lumen keeps.
const CN_STATE = { off: T("未連接"), wait: T("連接中…"), on: T("已連接") };
// Connected: the name, what is in use and the buttons; what it is for and the fine print only before connecting
// (disconnecting asks first, and says what it does)
function card(name, st, o) {
  const on = st === "on";
  return '<section class="cn-card"><div class="cn-row"><h3>' + name + (o.sub ? '<span class="cn-sub">' + o.sub + "</span>" : "") + '</h3><span class="cn-state ' + st + '">' + CN_STATE[st] + "</span></div>" +
    (on ? "" : "<p>" + o.purpose + "</p>") + (o.detail ? '<div class="cn-detail">' + o.detail + "</div>" : "") +
    '<div class="cn-acts">' + o.acts + "</div>" + (o.err ? '<p class="cn-err">' + o.err + "</p>" : "") +
    (o.note && !on ? '<p class="muted small">' + o.note + "</p>" : "") + "</section>";
}
const cnBtn = (cn, label, primary) => '<button class="' + (primary ? "primary" : "ghost") + '" data-cn="' + cn + '">' + label + "</button>";
const cnLink = (href, label) => '<a href="' + href + '" target="_blank" rel="noopener">' + label + "</a>";

function claudeCard(c) {
  const job = c.job || {};
  const installing = job.kind === "install" && job.status === "running";
  const waiting = job.kind === "login" && job.status === "waiting" && !c.logged_in;
  const o = { sub: T("需要 Claude Pro 或 Max 訂閱"), purpose: T("用你的 Claude 訂閱回答問題、整理知識庫。") };
  let st;
  if (c.connected) {
    st = "on";
    const plan = c.subscription ? "Claude " + (c.plan ? cap(c.plan) + " " : "") + T("訂閱") : T("Claude API 金鑰（按用量計費）");
    o.detail = T("目前使用：你的 ") + esc(plan) + T("。") + (c.subscription ? "" : T('<span class="cn-err">這不是訂閱登入，用量會按 API 計費。</span>'));
    o.acts = cnBtn("claude-disconnect", T("中斷連接")) + cnLink("https://claude.ai/settings/usage", T("管理用量"));
    o.note = T("中斷連接只是 Lumen 不再使用 Claude Code，你在 Claude Code 的登入不受影響。");
  } else if (installing || waiting) {
    st = "wait";
    o.detail = installing ? installProgress(c.install || {})
      : job.terminal ? T("已經打開終端機，照視窗裡的說明在瀏覽器登入，完成後這裡會自動變成已連接。")
      : T("瀏覽器會出現 Claude 的登入頁，登入並按「Authorize」，這裡會自動變成已連接。");
    o.acts = cnBtn("claude-cancel", T("取消")) + (waiting && !job.terminal ? cnBtn("claude-terminal", T("瀏覽器沒出現？改用終端機登入")) : "");
    o.note = T("登入完全在 Anthropic 的網頁完成，Lumen 不經手你的帳號密碼。");
  } else {
    st = "off";
    o.acts = cnBtn("claude-connect", T("連接 Claude Code"), true);
    o.note = c.logged_in ? T("你已經登入 Claude Code，按一下就會用它。")
      : (c.installed ? "" : T("會先用 Anthropic 官方安裝程式裝好 Claude Code（不用管理員密碼），")) + T("接著在瀏覽器登入。Lumen 不經手你的帳號密碼。");
  }
  if (job.status === "error" && job.error) o.err = esc(job.error) + (job.tail ? '<br><span class="small">' + esc(job.tail.slice(-200)) + "</span>" : "");
  return card("Claude Code", st, o);
}

// The official installer's progress: getting ready → downloading (bar, MB, time left) → installing → sign-in.
function installProgress(p) {
  const mins = s => s >= 90 ? T("約 ") + Math.round(s / 60) + T(" 分鐘") : T("不到 2 分鐘");
  let pct = 0, line;
  if (p.phase === "setup") { pct = 100; line = T("下載完成，正在安裝…"); }
  else if (p.phase === "download" && p.pct != null) {
    pct = p.pct;
    line = pct + "%・" + p.mb + " / " + p.total_mb + " MB" + (p.eta != null ? T("・還要") + mins(p.eta) : "");
  } else if (p.phase === "download") line = T("已下載 ") + p.mb + " MB";
  else line = T("選擇最快的下載路線…");
  const bar = '<div class="cn-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct +
    '"' + (p.phase === "download" && p.pct == null || !p.phase || p.phase === "start" ? ' data-busy="1"' : "") +
    '><span style="width:' + pct + '%"></span></div>';
  return T("正在用 Anthropic 官方安裝程式安裝 Claude Code，裝好會直接帶你登入。") + bar +
    '<div class="muted small cn-progress-line">' + esc(line) + "</div>";
}

function chatgptCard(g) {
  const o = { sub: T("需要 ChatGPT Go、Plus 或 Pro 方案"), purpose: T("用你的 ChatGPT 方案回答問題、整理知識庫。免費版不能用在其他 app。") };
  let st;
  if (g.connected) {
    st = "on";
    o.detail = T("目前使用：<b>Using ChatGPT plan</b>") + (g.email ? T('<span class="muted">（') + esc(g.email) + T("）</span>") : "") + T("。") +
      (g.plan_use ? "" : T('<span class="cn-err">你沒有同意讓 Lumen 使用方案額度，請中斷後重新連接。</span>'));
    o.acts = cnBtn("gpt-signout", T("中斷連接")) + cnLink("https://chatgpt.com/settings/usage", "Manage usage");
    o.note = T("中斷連接會撤銷並刪除 Lumen 的 ChatGPT 登入。");
  } else if (CN.waitGpt) {
    st = "wait";
    o.detail = T("等你在瀏覽器同意…如果 OpenAI 的頁面說「無法取得必要權限」，表示這個帳號的方案不能用在其他 app。");
    o.acts = cnBtn("gpt-cancel", T("取消"));
    o.note = T("登入完全在 OpenAI 的網頁完成，Lumen 不經手你的帳號密碼。");
  } else {
    st = "off";
    o.acts = '<button class="primary cn-gpt" data-cn="gpt-start">Continue with ChatGPT</button>';
    o.note = T("在 OpenAI 的網頁同意後就連上了。用量算在你的 ChatGPT 方案，和其他 app 共用同一份額度。");
  }
  return card("ChatGPT", st, o);
}

function jevCard(j) {
  const o = { sub: T("選用：需要 TypeSafe 金鑰"), purpose: T("Jev 幫 Lumen 做小判斷：找相關的頁、挑出筆記的重點、檢查 AI 整理得對不對。不連也能用，搜尋會改成比對關鍵字。") };
  let st;
  if (j.connected) {
    st = "on";
    o.detail = T("目前使用：你的 TypeSafe 金鑰。");
    o.acts = cnBtn("jev-remove", T("中斷連接"));
    o.note = j.source === "app" ? T("中斷連接會刪掉 Lumen 存的金鑰。") : T("中斷連接只是 Lumen 不再使用 Jev，你的金鑰檔案不受影響。");
  } else if (CN.jevEditing) {
    st = "off";                                    // nothing is running yet: it waits for the key
    o.detail = T('<input id="cn-jev-key" type="password" autocomplete="off" placeholder="貼上 TypeSafe API 金鑰">');
    o.acts = cnBtn("jev-save", T("儲存"), true) + cnBtn("jev-cancel", T("取消"));
    o.note = T("貼上金鑰後按「儲存」。儲存前會先試一次，確定能用。金鑰只存在這台電腦（只有你的帳號能讀）。");
  } else {
    st = "off";
    o.acts = cnBtn("jev-connect", T("連接 Jev"), true);
    o.note = T("到 TypeSafe 網站申請金鑰（一串像密碼的字），貼進來就好，費用很低。");
  }
  if (CN.jevMsg) o.err = esc(CN.jevMsg);
  return card("Jev", st, o);
}

async function gptWelcome() {
  await api("/api/connect/chatgpt/welcomed", {}).catch(() => {});
  dialog("You're using your ChatGPT plan", "<p>Eligible usage in this app uses your ChatGPT plan. Manage usage in your ChatGPT settings.</p>" +
    T('<p class="muted">之後在 Lumen 裡用 ChatGPT 回答，用量算在你的 ChatGPT 方案。可以在 <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener">ChatGPT 設定 → Usage</a> 查看。</p>'), "Got it");
}

async function connectClick(e) {
  const t = e.target.closest ? e.target.closest("[data-cn], [data-cn-close]") : e.target;
  if (!t) { if (e.target && e.target.id === "connect") closeConnect(); return; }
  if (t.hasAttribute("data-cn-close")) return closeConnect();
  const what = t.dataset.cn;
  const run = async (path, body = {}) => { try { return await api(path, body); } catch (err) { toast(err.message); return null; } };
  const sure = (name, more) => dialog(T("中斷 ") + name + T(" 連接？"), "<p>" + more + T("之後隨時可以再連接。</p>"), T("中斷連接"), true);
  if (what === "claude-connect") await run("/api/connect/claude/connect");
  else if (what === "claude-terminal") await run("/api/connect/claude/terminal");
  else if (what === "claude-cancel") await run("/api/connect/claude/cancel");
  else if (what === "claude-disconnect") { if (await sure("Claude", T("Lumen 不再使用 Claude Code；你在 Claude Code 的登入不受影響。"))) await run("/api/connect/claude/disconnect"); }
  else if (what === "gpt-start") { if (await run("/api/connect/chatgpt/start")) CN.waitGpt = true; }
  else if (what === "gpt-cancel") CN.waitGpt = false;
  else if (what === "gpt-signout") { if (await sure("ChatGPT", T("Lumen 會撤銷並刪除這台電腦上的 ChatGPT 登入。"))) await run("/api/connect/chatgpt/signout"); }
  else if (what === "jev-connect") { const r = await run("/api/connect/jev/connect"); CN.jevMsg = ""; if (r && r.need_key) CN.jevEditing = true; else await refreshTree(); }
  else if (what === "jev-cancel") { CN.jevEditing = false; CN.jevMsg = ""; }
  else if (what === "jev-save") {
    const k = ($("#cn-jev-key") || {}).value.trim(); if (!k) return;
    t.disabled = true; t.textContent = T("測試中…");
    try { await api("/api/connect/jev/save", { key: k }); CN.jevMsg = ""; CN.jevEditing = false; await refreshTree(); }
    catch (err) { CN.jevMsg = err.message; }
  }
  else if (what === "jev-remove") {
    const own = ((await api("/api/connect/status").catch(() => ({}))).jev || {}).source === "app";
    if (await sure("Jev", own ? T("Lumen 會刪掉它存的金鑰。") : T("Lumen 不再使用 Jev；你的金鑰檔案不受影響。"))) { await run("/api/connect/jev/remove"); await refreshTree(); }
    CN.jevMsg = "";
  }
  refreshConnect();
}

// at start: the ChatGPT plan's models for the model menu; on the first run, nothing connected → the page once
(async () => {
  try {
    const st = await api("/api/connect/status");
    if (st.chatgpt.connected && !st.claude.connected && !isGpt(aiModel())) setPref("aiModel", "chatgpt");
    if (!st.chatgpt.connected && st.claude.connected && isGpt(aiModel())) setPref("aiModel", "auto");
    setConn(st);
    if (st.chatgpt.connected) loadGptModels();
    if (store.get("connect-seen", false)) return;
    if (!(st.claude.connected || st.chatgpt.connected)) showConnect();
    store.set("connect-seen", true);
  } catch (e) {}
})();

// ============================================================ rail: the strip on the far left
// One button per place (journal, notes, files, wiki), asking AI and settings; the vault sits on top. Each place's
// own action (today's entry, a new note, checking the wiki) sits in the left column's header, not in a shared "+".
// Clicking the place you're already in folds the left column, like most editors. (Chosen in the prototype, 2026-11-28.)
function railSync() {
  const rail = $("#rail");
  if (!rail || !S.tree) return;
  rail.querySelectorAll("[data-go]").forEach(b => {
    const g = b.dataset.go, on = g === "ai" ? !rightHidden() && S.rtab === "ai" : !L.leftOff && S.sideTab === g;
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
  });
  $("#lhead-name").textContent = { journal: T("日記"), raw: T("筆記"), assets: T("附件"), wiki: T("知識庫"), results: T("搜尋") }[S.sideTab] || "";
  const act = { journal: [T("＋ 今天"), T("打開今天的日記，沒有就照模板建立")], raw: [T("＋ 新筆記"), T("在筆記最上層新增一篇（右鍵點資料夾可以加在那裡）")],
    wiki: [T("✦ 檢查"), T("請 AI 檢查知識庫：矛盾、斷掉的連結、缺的頁")] }[S.sideTab];
  const b = $("#lhead-act");
  b.hidden = !act || !!S.tree.read_only;
  if (act) { b.textContent = act[0]; b.title = act[1]; }
}
$("#rail").addEventListener("click", e => {
  const b = e.target.closest("[data-go]");
  if (!b) return;
  const go = b.dataset.go;
  if (go === "ai") { if (!rightHidden() && S.rtab === "ai") toggleSide("right"); else showRight("ai"); return; }
  if (!L.leftOff && S.sideTab === go) { toggleSide("left"); return; }
  if (L.leftOff) toggleSide("left");
  if (S.sideTab !== go) setSideTab(go);
  railSync();
});
$("#lhead-act").onclick = () => {
  if (S.sideTab === "journal") openToday();
  else if (S.sideTab === "raw") newNote();
  else if (S.sideTab === "wiki") startAgent("lint", {});
};
// Settings: how it looks, the language, Jev, connecting AI. Nothing about files or vaults.
$("#set-btn").onclick = e => {
  const r = e.currentTarget.getBoundingClientRect(), at = items => showMenu(r.right + 6, r.top, items, [r.right, r.top + r.height / 2]);
  const lang = () => at(Object.entries(LANGS).map(([k, name]) => ({ label: (k === LANG && chosenLang() ? "✓ " : T("　 ")) + name, fn: () => k !== LANG && setLang(k) }))
    .concat([null, { label: (chosenLang() ? T("　 ") : "✓ ") + T("跟隨系統"), fn: () => chosenLang() && setLang("") }]));
  const items = [{ label: T("外觀…"), fn: () => showViewSettings() }, { label: T("語言") + T("：") + LANGS[LANG] + " ›", fn: () => setTimeout(lang, 0) }, null];
  if (S.tree && S.tree.jev) items.push({ label: S.jevOn ? T("Jev：開，點一下關掉") : T("Jev：關，點一下打開"), fn: toggleJev });
  items.push({ label: T("連接 AI…"), fn: () => showConnect() });
  at(items);
};
// The AI box's one options button: model and thinking, with what gets sent in its tooltip
function aiOptLabel() {
  const b = $("#ai-opt"), m = $("#ai-model"), ef = $("#ai-effort");
  if (!b || !m || !ef) return;
  const name = sel => (sel.options[sel.selectedIndex] || { textContent: "" }).textContent;
  b.textContent = name(m).replace(/（.*?）|\(.*?\)/g, "").trim() + " · " + name(ef) + " ▾";
  b.title = $("#ai-sends").textContent;
}
$("#ai").addEventListener("click", e => {
  const b = e.target.closest("#ai-opt");
  if (!b) return;
  const m = $("#ai-model"), ef = $("#ai-effort"), r = b.getBoundingClientRect();
  const pick = (sel, v) => { sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); aiOptLabel(); };
  const opts = sel => [...sel.options].map(o => ({ label: (o.selected ? "✓ " : T("　 ")) + o.textContent, fn: () => pick(sel, o.value) }));
  showMenu(r.left, r.top, opts(m).concat([null], opts(ef)), [r.left + r.width / 2, r.top]);
  const menu = $("#menu");   // the box sits at the bottom of the window: open upward, growing out of the button
  menu.style.top = Math.max(8, r.top - menu.offsetHeight - 4) + "px";
  menu.style.transformOrigin = Math.round(r.left + r.width / 2 - menu.offsetLeft) + "px 100%";
});
railSync();

// Narrow windows: side columns sit over the note, so tapping the note closes them, and they start closed
const SMALL = matchMedia("(max-width: 760px)");
function narrowClose() { if (!L.leftOff) toggleSide("left"); if (!rightHidden()) toggleSide("right"); }
$(".center").addEventListener("pointerdown", () => { if (SMALL.matches) narrowClose(); });
SMALL.addEventListener("change", () => { if (SMALL.matches) narrowClose(); });
if (SMALL.matches) narrowClose();
