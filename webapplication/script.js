/**
 * DataRefine Platform - main application script (CrimsonNova)
 *
 * Flow: upload a CSV / Excel / JSON file (or the demo data) -> load() -> four tabs:
 *   1. Overview       - data-health score, column statistics, raw data preview
 *   2. Cleaning       - missing values, duplicates, encoding, rename / reorder columns
 *   3. Visualization  - build and export charts
 *   4. Split          - random train / validation / test split with CSV downloads
 *
 * Image datasets (folder / ZIP / image files) are handled by image-core.js and image-ui.js.
 *
 * Libraries (loaded in index.html): Chart.js, PapaParse (CSV), SheetJS (Excel), JSZip (ZIP files).
 *
 * Short names used throughout:
 *   $(id)   getElementById        blank(v)  true for null / undefined / ""
 *   cur     current (edited) rows orig      rows as first uploaded
 *   hist    undo snapshots        mod       cells changed by cleaning (highlighted)
 *   dupSet  indexes of duplicate rows       dupOf  duplicate index -> first copy index
 *   wid     list of chart widgets act       id of the chart being edited
 *   trn / val / tst   split subsets         stale  true when the split must be redone
 */

/* ============================================================
   Helpers and global state
   ============================================================ */
const $ = (id) => document.getElementById(id),
  blank = (v) => v == null || v === "",
  esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m],
    ),
  fmt = (n) => +n.toFixed(2),
  // Min / max without spreading (spreading 100k+ values into Math.min throws a RangeError).
  arrMin = (a) => a.reduce((m, x) => (x < m ? x : m), Infinity),
  arrMax = (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
Chart.defaults.font.family = "'Inter',system-ui,sans-serif";
Chart.defaults.color = "#a3adbf";
// Deep copy of plain data (rows). structuredClone is faster than a JSON round-trip on big tables.
const clone = (x) => (typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
const HIST_MAX = 20; // undo steps kept in memory; older steps are only kept as text for the change log
let orig = [],
  cur = [],
  hist = [],
  histOld = [],
  dupSet = new Set(),
  dupOf = new Map(),
  mod = {},
  meta = { name: "", kb: null },
  ovPage = 1,
  ovF = "all",
  trn = [],
  val = [],
  tst = [],
  stale = true,
  vizC = null,
  spC = null,
  ovC = null,
  act = 1,
  sub = "missing";
let wid = [
  { id: 1, name: "Graph 1", type: "histogram", x: "", y: "", h: "", title: "", pal: "gold-neon" },
];
// Column names of the current data.
const cols = () => (cur.length ? Object.keys(cur[0]) : []);
// Detect a column type: "numeric", "date" (YYYY-MM-DD) or "text".
const ctype = (c) => {
  const v = cur.map((r) => r[c]).filter((x) => !blank(x));
  if (!v.length) return "text";
  if (v.every((x) => typeof x === "number")) return "numeric";
  if (
    v.every((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) && !isNaN(Date.parse(x)))
  )
    return "date";
  return "text";
};
const isNum = (c) => ctype(c) === "numeric",
  numCols = () => cols().filter(isNum);
// Build <option> tags from [value, label] pairs.
const opt = (a, sel) =>
  a
    .map(([v, l]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(l)}</option>`)
    .join("");
// Replace a dropdown's options but keep the selected value if it still exists.
const keep = (id, html) => {
  const e = $(id),
    p = e.value;
  e.innerHTML = html;
  if ([...e.options].some((o) => o.value === p)) e.value = p;
};

/* ============================================================
   Page setup and file loading
   ============================================================ */
// Main navigation tabs: [id, label, Font Awesome icon].
const TABS = [
  ["overview", "Dataset Overview", "fa-chart-pie"],
  ["cleaning", "Data Cleaning", "fa-broom"],
  ["visualization", "Visualization", "fa-chart-line"],
  ["split", "Train/Val/Test Split", "fa-arrows-split-up-and-left"],
];
// Fill the navigation bar with tabs; fn is the name of the function that opens a tab ("go" or "igo").
function setNav(tabs, fn) {
  $("nav").innerHTML = tabs
    .map(
      ([k, l, i]) =>
        `<button id="t-${k}" onclick="${fn}('${k}')" class="tab"><i class="fa-solid ${i} mr-1.5"></i>${l}</button>`,
    )
    .join("");
}
setNav(TABS, "go");
$("subs").innerHTML = ["missing", "duplicates", "encode", "columns"]
  .map((k) => `<button id="sb-${k}" onclick="subTab('${k}')" class="sub capitalize">${k}</button>`)
  .join("");
$("ov-f").innerHTML = [
  ["all", "All"],
  ["missing", "Missing"],
  ["duplicates", "Duplicates"],
]
  .map(
    ([k, l]) =>
      `<button data-f="${k}" onclick="ovF='${k}';ovPage=1;pv()" class="btn b-dark !py-1 !px-3 font-mono">${l}</button>`,
  )
  .join("");
// Split subsets: [key, label, colour, text class, button class, icon, default %, min %, max %].
const SP = [
  ["train", "Training", "#d4af37", "text-gold", "b-gold", "fa-brain", 70, 10, 90],
  ["val", "Validation", "#3b9eff", "text-neon", "b-blue", "fa-sliders", 15, 0, 50],
  ["test", "Testing", "#a78bfa", "text-violet-400", "b-violet", "fa-vial-circle-check", 15, 5, 50],
];
$("sliders").innerHTML = SP.map(
  ([k, l, c, t, , , v, mn, mx]) =>
    `<div><div class="flex justify-between mb-1 font-bold ${t}"><span>${l} Set Ratio</span><span id="${k}-l">${v}%</span></div><input type="range" id="${k}-r" min="${mn}" max="${mx}" step="5" value="${v}" oninput="ratios('${k}')"></div>`,
).join("");
$("sp-cards").innerHTML = SP.map(
  ([k, l, c, t, b, i]) =>
    `<div class="card text-center space-y-3" style="border-color:${c}66"><div class="w-12 h-12 mx-auto rounded-xl flex items-center justify-center text-xl ${t}" style="background:${c}33"><i class="fa-solid ${i}"></i></div><h4 class="font-bold ${t}">${l === "Training" ? "Train" : l === "Testing" ? "Test" : l} Subset</h4><div id="${k}-n" class="text-2xl font-mono font-extrabold">0 rows</div><button onclick="exportCSV(${k === "train" ? "trn" : k === "val" ? "val" : "tst"},'${k}.csv')" class="btn ${b} w-full"><i class="fa-solid fa-download mr-1"></i> Download ${k}.csv</button></div>`,
).join("");
$("cards").innerHTML = [
  ["hs", "Health Score", "fa-heart-pulse", "text-gold", "border-gold/40", "hsub"],
  [
    "mc",
    "Missing Values",
    "fa-triangle-exclamation",
    "text-amber-400",
    "border-amber-500/30",
    "mp",
  ],
  ["cc", "Total Columns", "fa-table-columns", "text-neon", "border-neon/30", "rc"],
  ["dc", "Duplicate Rows", "fa-clone", "text-red-400", "border-red-500/30", "dsub"],
]
  .map(
    ([id, l, ic, tc, b, s]) =>
      `<div class="card ${b}"><div class="flex justify-between mb-2"><span class="text-xs font-mono uppercase tracking-wider text-slate-400">${l}</span><i class="fa-solid ${ic} ${tc} text-lg"></i></div><div id="${id}" class="text-4xl font-extrabold ${tc}">0</div><div id="${s}" class="text-[11px] text-slate-400 mt-1"></div></div>`,
  )
  .join("");

$("drop").addEventListener("dragover", (e) => e.preventDefault());
$("drop").addEventListener("drop", (e) => {
  e.preventDefault();
  routeDrop(e); // image-ui.js: table files go to parseFile(), images / folders / ZIP go to the image app
});
// Read a dropped or selected CSV / Excel / JSON file and pass its rows to load().
function parseFile(f) {
  const sp = $("spin");
  sp.classList.remove("hidden");
  sp.classList.add("flex");
  const done = (r) => {
      sp.classList.add("hidden");
      sp.classList.remove("flex");
      load(r, f.name, f.size / 1024);
    },
    fail = (m) => {
      sp.classList.add("hidden");
      sp.classList.remove("flex");
      alert(m);
    };
  const ext = f.name.split(".").pop().toLowerCase();
  if (ext === "csv")
    Papa.parse(f, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (x) => done(x.data),
    });
  else if (ext === "xlsx" || ext === "xls") {
    const rd = new FileReader();
    rd.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
        // Real Excel dates come back as Date objects: turn them into YYYY-MM-DD text so they are detected as dates.
        const iso = (d) => {
          const p = (n) => String(n).padStart(2, "0"),
            day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
          return d.getHours() || d.getMinutes() || d.getSeconds()
            ? `${day} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
            : day;
        };
        done(
          XLSX.utils
            .sheet_to_json(wb.Sheets[wb.SheetNames[0]])
            .map((r) =>
              Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? iso(v) : v])),
            ),
        );
      } catch (err) {
        fail("Could not read this Excel file.");
      }
    };
    rd.readAsArrayBuffer(f);
  } else if (ext === "json") {
    const rd = new FileReader();
    rd.onload = (e) => {
      try {
        const j = JSON.parse(e.target.result);
        done(Array.isArray(j) ? j : [j]);
      } catch (err) {
        fail("This JSON file is not valid.");
      }
    };
    rd.readAsText(f);
  } else fail("Unsupported format. Upload CSV, Excel, JSON, images or a ZIP of images.");
}
// Load the built-in sample dataset (contains missing values and duplicate rows).
function demo() {
  const L = [
    "Age,Gender,Annual_Income,Spending_Score,Customer_Type,Signup_Date",
    "19,Male,15000,39,Regular,2023-01-15",
    "21,Male,15000,81,Premium,2023-02-20",
    "20,Female,16000,6,Regular,2023-03-12",
    "23,Female,16000,77,Regular,2023-04-05",
    "31,Female,17000,40,VIP,2023-05-18",
    "22,Female,17000,76,Regular,2023-06-01",
    "35,Female,18000,6,VIP,2023-06-25",
    "23,Female,18000,94,Regular,2023-07-04",
    "64,Male,19000,3,Regular,2023-07-19",
    "30,Male,19000,72,Premium,2023-08-11",
    "37,Male,20000,14,Regular,2023-08-30",
    "35,Female,20000,99,VIP,2023-09-14",
    "20,Female,16000,6,Regular,2023-03-12",
    "45,Male,,28,Premium,2023-10-02",
    "32,Male,25000,,Regular,2023-10-18",
    "49,Female,28000,54,,2023-11-05",
    "20,Female,16000,6,Regular,2023-03-12",
    "52,Male,33000,60,VIP,2023-12-01",
  ];
  load(
    Papa.parse(L.join("\n"), { header: true, dynamicTyping: true, skipEmptyLines: true }).data,
    "Demo dataset (sample)",
    null,
  );
}
// Clean up the rows, reset all state, hide the upload page and show the app.
async function load(rows, name, kb, restore) {
  if (!rows || !rows.length) {
    alert("No data rows were found in this file.");
    return;
  }
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  rows = rows.map((r) => Object.fromEntries(keys.map((k) => [k, blank(r[k]) ? null : r[k]])));
  if (
    !restore &&
    rows.length * keys.length > 2e6 &&
    !(await ask(
      `This file has ${rows.length.toLocaleString()} rows and ${keys.length} columns. Everything is kept in your browser's memory and each cleaning step keeps a copy (the last ${HIST_MAX} steps), so the page can become slow.`,
      { title: "Large file", ok: "Load anyway" },
    ))
  )
    return;
  meta = { name, kb };
  orig = clone(rows);
  cur = clone(restore ? restore.cur : rows);
  hist = [];
  histOld = restore ? restore.log : [];
  mod = restore ? restore.mod : {};
  ovF = "all";
  ovPage = 1;
  const cs = cols();
  wid = [
    {
      id: 1,
      name: "Graph 1",
      type: "histogram",
      x: cs[0],
      y: cs.find(isNum) || cs[0],
      h: "",
      title: "",
      pal: "gold-neon",
    },
  ];
  act = 1;
  document.documentElement.classList.remove("landing");
  $("landing").classList.add("hidden");
  $("choose").classList.add("hidden");
  if (typeof imgHide === "function") imgHide(); // leave the image app if it was open
  setNav(TABS, "go");
  $("app").classList.remove("hidden");
  $("nav").style.display = "";
  $("newbtn").classList.remove("hidden");
  refresh();
  go("overview");
}
// Step 1 -> step 2: remember the chosen data type and show the matching upload page.
function pickMode(m) {
  $("landing").dataset.mode = m;
  $("file").accept =
    m === "table" ? ".csv,.xlsx,.xls,.json" : ".zip,image/*,.tif,.tiff";
  $("file").multiple = m === "image";
  $("choose").classList.add("hidden");
  $("landing").classList.remove("hidden");
  $("homebtn").classList.remove("hidden");
}
// Back to the "tabular or image data?" question.
function showChooser() {
  $("landing").classList.add("hidden");
  $("choose").classList.remove("hidden");
  $("homebtn").classList.add("hidden");
}
// Themed replacement for the browser confirm box: returns a Promise that resolves true (OK) or false (Cancel / Esc / click outside).
// Dialogs are queued, so two messages never fight over the one dialog. o.single = a notice with only an OK button.
let askQ = Promise.resolve();
function ask(msg, o = {}) {
  const run = () => askNow(msg, o),
    p = askQ.then(run, run);
  askQ = p.catch(() => {});
  return p;
}
function askNow(msg, o) {
  const d = $("dlg"),
    ok = $("dlg-ok"),
    no = $("dlg-no"),
    prev = document.activeElement;
  $("dlg-t").textContent = o.title || "Are you sure?";
  $("dlg-m").textContent = msg;
  ok.textContent = o.ok || "Continue";
  ok.className = "btn " + (o.danger ? "b-red" : "b-gold");
  no.classList.toggle("hidden", !!o.single);
  d.classList.remove("hidden");
  d.classList.add("flex");
  ok.focus();
  return new Promise((res) => {
    const done = (v) => {
      d.classList.add("hidden");
      d.classList.remove("flex");
      document.removeEventListener("keydown", key);
      d.onclick = ok.onclick = no.onclick = null;
      if (prev && prev.focus) prev.focus();
      res(v);
    };
    const key = (e) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Tab") {
        // keep keyboard focus inside the dialog
        const b = [no, ok].filter((x) => !x.classList.contains("hidden")),
          i = b.indexOf(document.activeElement);
        e.preventDefault();
        b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus();
      }
    };
    document.addEventListener("keydown", key);
    ok.onclick = () => done(true);
    no.onclick = () => done(false);
    d.onclick = (e) => {
      if (e.target === d) done(false);
    };
  });
}
// Themed replacement for alert(): same message, shown in the app's own dialog.
window.alert = (m) => {
  ask(String(m), { title: "Notice", ok: "OK", single: true });
};
/* ---- Saved session: the table work is kept in this browser (IndexedDB) so a refresh or crash does not lose it ---- */
// Tiny IndexedDB wrapper. Every call resolves (to null on failure), so storage problems never break the app.
const Store = {
  db: null,
  open() {
    if (!this.db)
      this.db = new Promise((res, rej) => {
        try {
          const r = indexedDB.open("datarefine", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("kv");
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        } catch (e) {
          rej(e);
        }
      });
    return this.db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction("kv", mode),
        q = fn(t.objectStore("kv"));
      t.oncomplete = () => res(q && q.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  get: (k) => Store.tx("readonly", (s) => s.get(k)).catch(() => null),
  set: (k, v) => Store.tx("readwrite", (s) => s.put(v, k)).catch(() => null),
  del: (k) => Store.tx("readwrite", (s) => s.delete(k)).catch(() => null),
};
let saveTimer = 0;
// Save the table session a moment after the last change.
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!cur.length || $("app").classList.contains("hidden")) return;
    const log = [...histOld, ...hist.map(({ d, t }) => ({ d, t }))];
    await Store.set("table", { v: 1, name: meta.name, kb: meta.kb, orig, cur, mod, log });
    await Store.set("table-meta", { name: meta.name, rows: cur.length, cols: cols().length, at: Date.now() });
  }, 1500);
}
// Show the "resume" banner on the first page when a saved session exists.
async function checkResume() {
  const el = $("resume"),
    m = await Store.get("table-meta");
  if (!el) return;
  el.classList.toggle("hidden", !m);
  if (m) $("resume-t").textContent = `${m.name} \u00b7 ${m.rows.toLocaleString()} rows \u00d7 ${m.cols} columns \u00b7 saved ${new Date(m.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}
async function resumeSession() {
  const d = await Store.get("table");
  if (!d) {
    alert("The saved session could not be found.");
    return checkResume();
  }
  await load(d.orig, d.name, d.kb, d);
}
async function discardSession() {
  await Store.del("table");
  await Store.del("table-meta");
  checkResume();
}
// Close the open dataset (after confirmation, all changes are discarded) and show the chooser or the upload page.
async function leaveApp(to) {
  const open = !$("app").classList.contains("hidden") || !$("app-img").classList.contains("hidden");
  if (
    open &&
    !(await ask("Your changes will be cleared. You can always load the file again.", {
      title: to === "choose" ? "Return to the data type page?" : "Return to the upload page?",
      ok: "Yes, leave",
      danger: true,
    }))
  )
    return;
  if (!$("app").classList.contains("hidden")) {
    Store.del("table"); // the user chose to leave, so the saved copy goes too
    Store.del("table-meta");
  }
  $("app").classList.add("hidden");
  if (typeof imgHide === "function") imgHide();
  document.documentElement.classList.add("landing");
  $("nav").style.display = "none";
  $("newbtn").classList.add("hidden");
  $("file").value = "";
  if (to === "choose") {
    showChooser();
    checkResume();
  } else {
    // Upload page of the data type that was chosen before.
    $("choose").classList.add("hidden");
    $("landing").classList.remove("hidden");
    $("homebtn").classList.remove("hidden");
  }
}
// Home button: back to the "tabular or image data?" page.
function goHome() {
  leaveApp("choose");
}
// Upload button: back to the upload page of the current data type.
function resetApp() {
  leaveApp("upload");
}
// Find rows identical to an earlier row; the first copy is never marked as a duplicate.
function detect() {
  dupSet.clear();
  dupOf.clear();
  const seen = new Map();
  cur.forEach((r, i) => {
    const s = JSON.stringify(r);
    if (seen.has(s)) {
      dupSet.add(i);
      dupOf.set(i, seen.get(s));
    } else seen.set(s, i);
  });
}
// Re-detect duplicates and redraw every tab after the data has changed.
function refresh() {
  detect();
  stale = true;
  ov();
  fill();
  clTable();
  fillViz();
  saveSoon();
}
// Show main tab k (overview, cleaning, visualization or split) and render its content.
function go(k) {
  TABS.forEach(([t]) => {
    $("p-" + t).classList.toggle("hidden", t !== k);
    $("t-" + t).classList.toggle("on", t === k);
  });
  if (k === "overview") ov();
  if (k === "cleaning") {
    fill();
    clTable();
  }
  if (k === "visualization") {
    fillViz();
  }
  if (k === "split") {
    fillSplitCols();
    stale ? doSplit() : drawSplit();
  }
}

/* ============================================================
   Tab 1: Overview
   ============================================================ */
// Render the Overview tab: summary cards, health score and column statistics.
function ov() {
  const cs = cols(),
    n = cur.length;
  let miss = 0;
  cs.forEach((c) =>
    cur.forEach((r) => {
      if (blank(r[c])) miss++;
    }),
  );
  const mp = n && cs.length ? (miss / (n * cs.length)) * 100 : 0,
    dp = n ? (dupSet.size / n) * 100 : 0,
    hs = Math.max(0, Math.round(100 - (mp * 0.6 + dp * 0.4)));
  $("hs").textContent = hs + "%";
  $("hs").className =
    "text-4xl font-extrabold " +
    (hs >= 90 ? "text-emerald-400" : hs >= 70 ? "text-gold" : "text-red-400");
  $("hsub").textContent = "Based on nulls & duplicate rows";
  $("mc").textContent = miss;
  $("mp").textContent = mp.toFixed(1) + "% of dataset cells";
  $("cc").textContent = cs.length;
  $("rc").textContent = n + " total rows loaded";
  $("dc").textContent = dupSet.size;
  $("dsub").textContent = "Red-highlighted in the table";
  $("i-name").textContent = meta.name;
  $("i-shape").textContent = `${n} rows × ${cs.length} columns`;
  $("i-size").textContent =
    meta.kb == null
      ? "Built-in sample"
      : meta.kb >= 1024
        ? (meta.kb / 1024).toFixed(2) + " MB"
        : meta.kb.toFixed(1) + " KB";
  $("i-steps").textContent = hist.length;
  const bad = cs.filter((c) => cur.some((r) => blank(r[c])));
  if (!bad.length && !dupSet.size) {
    $("issues").className = "card !py-4 flex items-center gap-3 border-emerald-500/30";
    $("iss-ic").className = "fa-solid fa-circle-check text-emerald-400";
    $("iss-tx").textContent = "Your dataset looks clean: no missing values or duplicate rows.";
    $("iss-btn").classList.add("hidden");
  } else {
    const p = [];
    if (bad.length) p.push(`${bad.length} column${bad.length > 1 ? "s" : ""} with missing values`);
    if (dupSet.size) p.push(`${dupSet.size} duplicate row${dupSet.size > 1 ? "s" : ""}`);
    $("issues").className =
      "card !py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-amber-500/30";
    $("iss-ic").className = "fa-solid fa-triangle-exclamation text-amber-400 mt-0.5";
    $("iss-tx").textContent = `Found ${p.join(" and ")}. Fix them in Data Cleaning.`;
    $("iss-btn").classList.remove("hidden");
  }
  const st = cs
    .map((c) => {
      const k = cur.filter((r) => blank(r[c])).length;
      return { c, k, p: n ? (k / n) * 100 : 0 };
    })
    .sort((a, b) => b.k - a.k);
  $("ov-wrap").style.height = Math.max(256, st.length * 38) + "px";
  if (ovC) ovC.destroy();
  const lab = {
    id: "lab",
    afterDatasetsDraw(ch) {
      const x = ch.ctx;
      x.save();
      x.font = "600 11px Inter,sans-serif";
      x.textBaseline = "middle";
      st.forEach((s, i) => {
        x.fillStyle = s.k ? "#fcd34d" : "#e8e6e1";
        x.fillText(
          s.k ? `${s.k} missing (${s.p.toFixed(1)}%)` : "Complete",
          ch.chartArea.left + 10,
          ch.scales.y.getPixelForValue(i),
        );
      });
      x.restore();
    },
  };
  ovC = new Chart($("ov-chart"), {
    type: "bar",
    data: {
      labels: st.map((s) => s.c),
      datasets: [
        {
          label: "Complete",
          data: st.map((s) => 100 - s.p),
          backgroundColor: "rgba(59,158,255,.4)",
          borderRadius: 4,
          barThickness: 18,
        },
        {
          label: "Missing",
          data: st.map((s) => s.p),
          backgroundColor: "#f59e0b",
          borderRadius: 4,
          barThickness: 18,
        },
      ],
    },
    plugins: [lab],
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          min: 0,
          max: 100,
          grid: { color: "rgba(255,255,255,.05)" },
          ticks: { callback: (v) => v + "%" },
        },
        y: { stacked: true, grid: { display: false }, ticks: { color: "#e8e6e1" } },
      },
      plugins: {
        legend: { labels: { color: "#e8e6e1", usePointStyle: true } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.x.toFixed(1)}%` } },
      },
    },
  });
  $("coltb").innerHTML = cs
    .map((c) => {
      const v = cur.map((r) => r[c]).filter((x) => !blank(x)),
        k = n - v.length,
        t = ctype(c);
      let m = "--",
        rg = "--";
      if (t === "numeric") {
        m = fmt(v.reduce((a, b) => a + b, 0) / v.length);
        rg = `[${arrMin(v)} to ${arrMax(v)}]`;
      } else if (t === "date") {
        const s = [...v].sort();
        rg = `[${s[0]} to ${s[s.length - 1]}]`;
      } else {
        const cn = {};
        v.forEach((x) => (cn[x] = (cn[x] || 0) + 1));
        const b = Object.entries(cn).sort((a, b) => b[1] - a[1])[0];
        m = b ? "Mode: " + b[0] : "--";
      }
      return `<tr><td class="font-bold text-gold">${esc(c)}</td><td class="text-neon">${t === "text" ? "String / Object" : t === "numeric" ? "Numeric" : "Date"}</td><td class="${k ? "text-amber-400 font-bold" : ""}">${k}</td><td>${n ? ((k / n) * 100).toFixed(1) : 0}%</td><td>${new Set(v).size}</td><td>${esc(m)}</td><td class="text-slate-400">${esc(rg)}</td></tr>`;
    })
    .join("");
  pv();
}
// Render the data preview table (search box, All / Missing / Duplicates filter, paging).
function pv() {
  const cs = cols(),
    q = $("ov-q").value.toLowerCase();
  document.querySelectorAll("#ov-f button").forEach((b) => {
    const on = b.dataset.f === ovF;
    b.classList.toggle("!bg-gold/20", on);
    b.classList.toggle("!text-gold", on);
  });
  $("pv-h").innerHTML =
    '<tr><th class="!text-slate-400">#</th>' +
    cs.map((c) => `<th>${esc(c)}</th>`).join("") +
    "</tr>";
  const rows = [];
  cur.forEach((r, i) => {
    if (ovF === "missing" && !cs.some((c) => blank(r[c]))) return;
    if (ovF === "duplicates" && !dupSet.has(i)) return;
    if (
      q &&
      !cs.some((c) =>
        String(r[c] ?? "")
          .toLowerCase()
          .includes(q),
      )
    )
      return;
    rows.push(i);
  });
  const PS = 20,
    tp = Math.max(1, Math.ceil(rows.length / PS));
  ovPage = Math.min(Math.max(1, ovPage), tp);
  const s = (ovPage - 1) * PS,
    pg = rows.slice(s, s + PS);
  $("ov-info").textContent =
    `Showing ${rows.length ? s + 1 : 0}-${Math.min(s + PS, rows.length)} of ${rows.length}`;
  $("ov-pg").textContent = `Page ${ovPage} of ${tp}`;
  $("pv-p").disabled = ovPage <= 1;
  $("pv-n").disabled = ovPage >= tp;
  $("pv-b").innerHTML = pg
    .map((i) => {
      const r = cur[i],
        d = dupSet.has(i);
      return (
        `<tr class="${d ? "row-dup" : ""}"><td class="text-slate-500">${i + 1}${d ? ` <span class="text-[10px] text-red-400">= #${dupOf.get(i) + 1}</span>` : ""}</td>` +
        cs
          .map((c) => (blank(r[c]) ? '<td class="c-miss">null</td>' : `<td>${esc(r[c])}</td>`))
          .join("") +
        "</tr>"
      );
    })
    .join("");
}

/* ============================================================
   Tab 2: Data cleaning
   ============================================================ */
// Switch the cleaning sub-tab (missing, duplicates, encode or columns).
function subTab(k) {
  sub = k;
  ["missing", "duplicates", "encode", "columns"].forEach((s) => {
    $("f-" + s).classList.toggle("hidden", s !== k);
    $("sb-" + s).classList.toggle("on", s === k);
  });
}
// Refill the dropdowns of the cleaning tab with the current column names.
function fill() {
  const cs = cols(),
    all = cs.map((c) => [c, c]),
    txt = cs.filter((c) => ctype(c) === "text");
  keep(
    "m-col",
    opt(
      cs.map((c) => {
        const n = cur.filter((r) => blank(r[c])).length;
        return [c, c + (n ? ` (${n} missing)` : "")];
      }),
    ),
  );
  const mc = $("m-col");
  if (mc.value && !cur.some((r) => blank(r[mc.value]))) {
    const nx = cs.find((c) => cur.some((r) => blank(r[c])));
    if (nx) mc.value = nx;
  }
  const dts = cs.filter((c) => ctype(c) === "date"),
    ecs = cs.filter((c) => txt.includes(c) || dts.includes(c));
  keep("e-col", opt((ecs.length ? ecs : cs).map((c) => [c, c + (dts.includes(c) ? " (date)" : "")])));
  keep("r-col", opt(all));
  keep("s1", opt(all));
  keep("s2", opt(all));
  if ($("s1").value === $("s2").value && cs.length > 1)
    $("s2").value = cs.find((c) => c !== $("s1").value);
  mMethods();
  dInfo();
  eOrder();
  subTab(sub);
  const miss = cur.reduce((n, r) => n + cs.filter((c) => blank(r[c])).length, 0);
  $("sb-missing").textContent = miss ? `missing (${miss})` : "missing";
  $("sb-duplicates").textContent = dupSet.size ? `duplicates (${dupSet.size})` : "duplicates";
  $("h-n").textContent = hist.length;
  $("undo").disabled = !hist.length;
  $("h-log").innerHTML = hist.length
    ? hist
        .map(
          (h, i) =>
            `<div class="flex gap-2"><span class="text-gold w-5 text-right">${i + 1}.</span><span class="flex-1">${esc(h.d)}</span><span class="text-slate-500">${h.t}</span></div>`,
        )
        .join("")
    : '<div class="italic text-slate-500">No changes yet.</div>';
  $("h-log").scrollTop = 1e6;
}
// Save an undo snapshot (data + changed cells + description) before a change.
function snap(d) {
  hist.push({
    data: clone(cur),
    mod: clone(mod),
    d,
    t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
  while (hist.length > HIST_MAX) {
    const o = hist.shift(); // the data of the oldest step is dropped, its description stays in the change log
    histOld.push({ d: o.d, t: o.t });
  }
}
// Restore the most recent snapshot.
function undo() {
  if (!hist.length) return;
  const h = hist.pop();
  cur = h.data;
  mod = h.mod;
  refresh();
}
// Restore the dataset to the original upload (asks for confirmation).
async function revert() {
  if (
    !hist.length ||
    !(await ask("All cleaning steps will be undone and the data goes back to the original upload.", {
      title: "Revert all changes?",
      ok: "Revert",
      danger: true,
    }))
  )
    return;
  cur = clone(orig);
  hist = [];
  histOld = [];
  mod = {};
  refresh();
}
// List the fill methods that suit the chosen column (mean / median only for numbers).
function mMethods() {
  const c = $("m-col").value;
  if (!c) return;
  const base = [
    ["mode", "Mode (most frequent)"],
    ["constant", "Constant / custom value"],
    ["ffill", "Forward fill (value from row above)"],
    ["bfill", "Backward fill (value from row below)"],
  ];
  keep("m-met", opt(isNum(c) ? [["mean", "Mean"], ["median", "Median"], ...base] : base));
  mInfo();
}
// Compute the replacement value for a column using the chosen fill method.
function fillVal(c, m, custom) {
  const v = cur.map((r) => r[c]).filter((x) => !blank(x));
  if (!v.length) return null;
  if (m === "mean") return fmt(v.reduce((a, b) => a + b, 0) / v.length);
  if (m === "median") {
    const s = [...v].sort((a, b) => a - b),
      i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
  }
  if (m === "mode") {
    const cn = new Map();
    v.forEach((x) => cn.set(x, (cn.get(x) || 0) + 1));
    return [...cn.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (m === "constant") return isNum(c) ? Number(custom) : custom;
  return null;
}
// Show how many values are missing in the chosen column and enable or disable Apply.
function mInfo() {
  const c = $("m-col").value,
    m = $("m-met").value;
  if (!c) return;
  $("m-cust").classList.toggle("hidden", m !== "constant");
  const n = cur.filter((r) => blank(r[c])).length;
  $("m-btn").disabled = !n;
  if (!n) {
    $("m-info").innerHTML =
      `<i class="fa-solid fa-circle-check text-emerald-400 mr-1"></i><b>${esc(c)}</b> has no missing values.`;
    return;
  }
  const cu = $("m-val").value;
  let how =
    m === "ffill"
      ? "copy the value from the row above"
      : m === "bfill"
        ? "copy the value from the row below"
        : m === "constant" && !cu.trim()
          ? "be filled with the value you type"
          : `be filled with <b class="text-gold">${esc(fillVal(c, m, cu))}</b>`;
  $("m-info").innerHTML =
    `<i class="fa-solid fa-circle-info text-sky-300 mr-1"></i><b>${esc(c)}</b> (${ctype(c)}) has <b class="text-amber-400">${n}</b> missing cell(s). Each will ${how}.`;
}
// Fill the missing values of the chosen column using the chosen method.
function mApply() {
  const c = $("m-col").value,
    m = $("m-met").value,
    cu = $("m-val").value,
    t = [];
  cur.forEach((r, i) => {
    if (blank(r[c])) t.push(i);
  });
  if (!t.length) return;
  if (m === "constant") {
    if (!cu.trim()) {
      alert("Type a custom value first.");
      return;
    }
    if (isNum(c) && isNaN(Number(cu))) {
      alert(`'${c}' is numeric, so the value must be a number.`);
      return;
    }
  }
  const fv = fillVal(c, m, cu);
  snap(
    `Filled ${t.length} missing value(s) in '${c}' using ${m}${fv !== null && m !== "ffill" && m !== "bfill" ? ` (${fv})` : ""}`,
  );
  if (m === "ffill") {
    let l = null;
    cur.forEach((r, i) => {
      if (blank(r[c])) {
        if (l !== null) {
          r[c] = l;
          mod[i + "_" + c] = 1;
        }
      } else l = r[c];
    });
  } else if (m === "bfill") {
    let nx = null;
    for (let i = cur.length - 1; i >= 0; i--) {
      const r = cur[i];
      if (blank(r[c])) {
        if (nx !== null) {
          r[c] = nx;
          mod[i + "_" + c] = 1;
        }
      } else nx = r[c];
    }
  } else
    t.forEach((i) => {
      cur[i][c] = fv;
      mod[i + "_" + c] = 1;
    });
  refresh();
}
// Show how many duplicate rows exist (the first copy of each is kept).
function dInfo() {
  const n = dupSet.size,
    b = $("d-info");
  if (!n) {
    b.className = "p-3 rounded-xl border bg-emerald-950/20 border-emerald-500/30 text-slate-300";
    b.innerHTML =
      '<i class="fa-solid fa-circle-check text-emerald-400 mr-1"></i> No duplicate rows found.';
  } else {
    b.className = "p-3 rounded-xl border bg-red-950/20 border-red-500/30 text-slate-300";
    b.innerHTML = `The dataset has <b class="text-red-400">${n}</b> identical duplicate row(s). The first copy of each is kept.`;
  }
  $("d-btn").disabled = !n;
}
// Remove all duplicate rows, keeping the first copy of each.
function dRemove() {
  if (!dupSet.size) return;
  snap(`Removed ${dupSet.size} duplicate row(s)`);
  const nm = {},
    k = [];
  cur.forEach((r, i) => {
    if (dupSet.has(i)) return;
    const ni = k.length;
    k.push(r);
    Object.keys(r).forEach((c) => {
      if (mod[i + "_" + c]) nm[ni + "_" + c] = 1;
    });
  });
  cur = k;
  mod = nm;
  refresh();
}
// Show the category-order box only when ordinal encoding is selected.
function eOrder() {
  const m = $("e-met").value;
  $("e-ord").classList.toggle("hidden", m !== "ordinal");
  if (m === "ordinal") {
    const c = $("e-col").value;
    $("e-ordin").value = [...new Set(cur.map((r) => r[c]).filter((x) => !blank(x)))].join(", ");
  }
}
// Encode the chosen text column into numbers using the chosen method.
async function eApply() {
  const c = $("e-col").value,
    m = $("e-met").value;
  if (!c) return;
  const u = [...new Set(cur.map((r) => r[c]).filter((x) => !blank(x)))];
  if (!u.length) {
    alert(`'${c}' has no values to encode.`);
    return;
  }
  if (u.every((x) => typeof x === "number")) {
    alert(`'${c}' is already numeric.`);
    return;
  }
  const isDate = ctype(c) === "date";
  if (m === "date-parts" && !isDate) {
    alert(`'${c}' is not a date column (YYYY-MM-DD). Pick another method.`);
    return;
  }
  if (isDate && m !== "date-parts") {
    alert(`'${c}' is a date column. Use "Date parts (year, month, day)" for dates.`);
    return;
  }
  if (m === "date-parts") {
    snap(`Split date '${c}' into year, month and day`);
    cur = cur.map((r, i) => {
      const n = {};
      Object.keys(r).forEach((k) => {
        if (k !== c) {
          n[k] = r[k];
          return;
        }
        const d = blank(r[c]) ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(String(r[c]));
        [["year", 1], ["month", 2], ["day", 3]].forEach(([nm, g]) => {
          n[`${c}_${nm}`] = d ? +d[g] : null;
          if (d) mod[i + "_" + c + "_" + nm] = 1;
        });
        delete mod[i + "_" + c];
      });
      return n;
    });
    refresh();
    return;
  }
  if (
    m === "one-hot" &&
    u.length > 30 &&
    !(await ask(`'${c}' has ${u.length} unique values, so ${u.length} columns will be added.`, {
      title: "Add many columns?",
      ok: "Continue",
    }))
  )
    return;
  const map = {};
  if (m === "label")
    u.map(String)
      .sort()
      .forEach((v, i) => (map[v] = i));
  else if (m === "ordinal") {
    const o = $("e-ordin")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      miss = u.map(String).filter((v) => !o.includes(v));
    if (miss.length) {
      alert("Missing from your order: " + miss.join(", "));
      return;
    }
    o.forEach((v, i) => (map[v] = i));
  } else if (m === "frequency")
    cur.forEach((r) => {
      if (!blank(r[c])) map[r[c]] = (map[r[c]] || 0) + 1;
    });
  snap(`Encoded '${c}' using ${m}`);
  if (m === "one-hot")
    cur = cur.map((r, i) => {
      const n = {};
      Object.keys(r).forEach((k) => {
        if (k !== c) {
          n[k] = r[k];
          return;
        }
        u.forEach((v) => {
          n[`${c}_${v}`] = r[c] === v ? 1 : 0;
          mod[i + "_" + c + "_" + v] = 1;
        });
        delete mod[i + "_" + c];
      });
      return n;
    });
  else
    cur.forEach((r, i) => {
      if (!blank(r[c])) {
        r[c] = map[String(r[c])];
        mod[i + "_" + c] = 1;
      }
    });
  refresh();
}
// Rename a column (the new name must be non-empty and not already used).
function rename() {
  const o = $("r-col").value,
    n = $("r-new").value.trim();
  if (!n) {
    alert("Type a new column name.");
    return;
  }
  if (n === o) return;
  if (cols().includes(n)) {
    alert(`A column named '${n}' already exists.`);
    return;
  }
  snap(`Renamed '${o}' to '${n}'`);
  cur = cur.map((r) => {
    const x = {};
    Object.keys(r).forEach((k) => (x[k === o ? n : k] = r[k]));
    return x;
  });
  const nm = {};
  Object.keys(mod).forEach((k) => {
    const i = k.indexOf("_"),
      c = k.slice(i + 1);
    nm[k.slice(0, i) + "_" + (c === o ? n : c)] = 1;
  });
  mod = nm;
  $("r-new").value = "";
  refresh();
}
// Swap the positions of two columns.
function swap() {
  const a = $("s1").value,
    b = $("s2").value;
  if (a === b) {
    alert("Pick two different columns to swap.");
    return;
  }
  snap(`Swapped positions of '${a}' and '${b}'`);
  cur = cur.map((r) => {
    const x = {};
    Object.keys(r).forEach((k) => {
      if (k === a) x[b] = r[b];
      else if (k === b) x[a] = r[a];
      else x[k] = r[k];
    });
    return x;
  });
  refresh();
}
// Draw the cleaning table (first 200 rows) with changed cells and duplicates highlighted.
function clTable() {
  const cs = cols(),
    L = 200;
  $("cl-wrap").style.maxHeight = cur.length > 25 ? "70vh" : "none";
  $("cl-h").innerHTML =
    '<tr><th class="!text-slate-400">#</th>' +
    cs.map((c) => `<th>${esc(c)}</th>`).join("") +
    "</tr>";
  $("cl-b").innerHTML = cur
    .slice(0, L)
    .map(
      (r, i) =>
        `<tr class="${dupSet.has(i) ? "row-dup" : ""}"><td class="text-slate-500">${i + 1}</td>` +
        cs
          .map((c) => {
            const b = blank(r[c]);
            return `<td class="${mod[i + "_" + c] ? "c-mod" : b ? "c-miss" : ""}">${b ? "null" : esc(r[c])}</td>`;
          })
          .join("") +
        "</tr>",
    )
    .join("");
  $("cl-n").textContent =
    cur.length > L
      ? `Showing first ${L} of ${cur.length} rows`
      : `${cur.length} rows × ${cs.length} columns`;
}
// Download rows as a CSV file with the given file name.
function exportCSV(data, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([Papa.unparse(data)], { type: "text/csv;charset=utf-8;" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// Download the list of cleaning steps as a JSON file (for reports and reproducibility).
function exportLog() {
  const steps = [...histOld, ...hist.map(({ d, t }) => ({ d, t }))],
    a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            tool: "DataRefine Platform",
            file: meta.name,
            exported: new Date().toISOString(),
            rows_original: orig.length,
            rows_now: cur.length,
            columns_now: cols(),
            steps: steps.map((x, i) => ({ step: i + 1, change: x.d, time: x.t })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  a.download = "change_log.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ============================================================
   Tab 3: Visualization
   ============================================================ */
// Colour palettes for charts.
const PAL = {
  "gold-neon": [
    "#d4af37",
    "#3b9eff",
    "#a78bfa",
    "#2dd4bf",
    "#fb7185",
    "#f59e0b",
    "#34d399",
    "#e8e6e1",
  ],
  viridis: ["#34d399", "#2dd4bf", "#38bdf8", "#a3e635", "#22d3ee", "#86efac", "#67e8f9", "#bef264"],
  magma: ["#ef4444", "#f97316", "#fbbf24", "#fb7185", "#a855f7", "#f472b6", "#fdba74", "#fca5a5"],
  coolwarm: [
    "#3b82f6",
    "#ef4444",
    "#93c5fd",
    "#fca5a5",
    "#60a5fa",
    "#f87171",
    "#bfdbfe",
    "#fecaca",
  ],
};
// Two-colour gradients (low -> high) for the correlation heatmap.
const HEAT = {
  "gold-neon": ["#3b9eff", "#d4af37"],
  viridis: ["#38bdf8", "#34d399"],
  magma: ["#a855f7", "#f97316"],
  coolwarm: ["#3b82f6", "#ef4444"],
};
// Colour helpers: hex -> [r, g, b], hex + alpha -> rgba(), blend of two colours.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)),
  alpha = (h, a) => `rgba(${hex(h).join(",")},${a})`,
  mix = (a, b, t) => {
    const A = hex(a),
      B = hex(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
  };
// Quantile of a sorted array (linear interpolation) - used for box plots.
const quant = (s, q) => {
  const i = (s.length - 1) * q,
    l = Math.floor(i),
    h = Math.ceil(i);
  return s[l] + (s[h] - s[l]) * (i - l);
};
// Chart.js plugin that paints a dark background (so exported JPGs are not transparent).
const BG = {
  id: "bg",
  beforeDraw(c) {
    const x = c.ctx;
    x.save();
    x.fillStyle = "#0a0e17";
    x.fillRect(0, 0, c.width, c.height);
    x.restore();
  },
};
// The active chart widget.
const W = () => wid.find((w) => w.id === act);
// Draw the row of chart buttons (Graph 1, Graph 2, ...).
function tabsUI() {
  $("g-tabs").innerHTML = wid
    .map(
      (w) =>
        `<button onclick="setG(${w.id})" class="btn !py-1 !px-3 font-mono ${w.id === act ? "b-gold" : "b-dark"}">${w.name}</button>`,
    )
    .join("");
  $("g-title").textContent = `Chart Canvas #${act}`;
}
// Fill the visualization controls from the active chart and draw it.
function fillViz() {
  const cs = cols(),
    w = W();
  if (!w) return;
  const ok = (c) => (cs.includes(c) ? c : cs[0]);
  w.x = ok(w.x);
  w.y = cs.includes(w.y) ? w.y : cs.find(isNum) || cs[0];
  if (!cs.includes(w.h)) w.h = "";
  $("v-x").innerHTML = $("v-y").innerHTML = opt(cs.map((c) => [c, c]));
  $("v-h").innerHTML = opt([["", "None"], ...cs.map((c) => [c, c])]);
  $("v-type").value = w.type;
  $("v-x").value = w.x;
  $("v-y").value = w.y;
  $("v-h").value = w.h;
  $("v-t").value = w.title;
  $("v-p").value = w.pal;
  tabsUI();
  vSet();
}
// Make chart id the active chart.
function setG(id) {
  act = id;
  fillViz();
}
// Add a new chart with default settings and make it active.
function addG() {
  const id = Math.max(...wid.map((w) => w.id)) + 1,
    cs = cols();
  wid.push({
    id,
    name: "Graph " + id,
    type: "histogram",
    x: cs[0],
    y: cs.find(isNum) || cs[0],
    h: "",
    title: "",
    pal: "gold-neon",
  });
  setG(id);
}
// Delete the active chart (at least one chart must remain).
function delG() {
  if (wid.length < 2) {
    alert("You need at least one graph.");
    return;
  }
  wid = wid.filter((w) => w.id !== act);
  setG(wid[0].id);
}
// Show or hide the axis controls to match the chosen chart type.
function vSet() {
  const t = $("v-type").value,
    nm = numCols(),
    sh = (id, on) => $(id).classList.toggle("hidden", !on);
  sh("v-xc", t !== "heatmap");
  sh("v-yc", ["scatterplot", "linechart", "boxplot"].includes(t));
  sh("v-hc", t !== "heatmap" && t !== "boxplot");
  $("v-xl").textContent =
    t === "boxplot"
      ? "Group By (X-Axis, optional)"
      : t === "histogram"
        ? "Column to Count (X-Axis)"
        : "X-Axis Column";
  if (
    ["scatterplot", "linechart", "boxplot"].includes(t) &&
    nm.length &&
    !nm.includes($("v-y").value)
  )
    $("v-y").value = nm.find((c) => c !== $("v-x").value) || nm[0];
  if (t === "scatterplot" && nm.length > 1 && !nm.includes($("v-x").value))
    $("v-x").value = nm[0] === $("v-y").value ? nm[1] : nm[0];
  drawViz();
}
// Show a message instead of the chart (pass nothing to show the chart again).
function vmsg(t) {
  const cv = $("vc"),
    m = $("v-msg");
  m.textContent = t || "";
  m.classList.toggle("hidden", !t);
  cv.style.display = t ? "none" : "block";
}
// Group the values of column x into bins or categories for histograms and bar charts.
function binning(x) {
  const a = cur.map((r) => r[x]).filter((v) => !blank(v));
  if (a.length && a.every((v) => typeof v === "number")) {
    const u = [...new Set(a)].sort((p, q) => p - q);
    if (u.length <= 12) return { l: u.map(String), i: (v) => u.indexOf(v) };
    const mn = arrMin(a),
      mx = arrMax(a),
      k = Math.min(20, Math.max(5, Math.ceil(Math.log2(a.length) + 1))),
      w = (mx - mn) / k || 1;
    return {
      l: [...Array(k)].map((_, i) => `${fmt(mn + i * w)} to ${fmt(mn + (i + 1) * w)}`),
      i: (v) => Math.min(k - 1, Math.floor((v - mn) / w)),
    };
  }
  const k = [...new Set(a.map(String))].sort();
  return { l: k, i: (v) => k.indexOf(String(v)) };
}
// Pearson correlation between two numeric columns.
function corr(a, b) {
  const p = cur.filter((r) => typeof r[a] === "number" && typeof r[b] === "number"),
    n = p.length;
  if (n < 2) return 0;
  const ma = p.reduce((s, r) => s + r[a], 0) / n,
    mb = p.reduce((s, r) => s + r[b], 0) / n;
  let sab = 0,
    saa = 0,
    sbb = 0;
  p.forEach((r) => {
    const da = r[a] - ma,
      db = r[b] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  });
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}
// Draw the correlation heatmap on a canvas.
function heat(cv, cs, pk, title) {
  const n = cs.length,
    ww = cv.parentElement.clientWidth - 32 || 640,
    left = 130,
    top = 60,
    cell = Math.max(46, Math.min(84, Math.floor((ww - left - 70) / n))),
    Wd = left + cell * n + 70,
    H = top + cell * n + 90,
    d = window.devicePixelRatio || 1;
  cv.width = Wd * d;
  cv.height = H * d;
  cv.style.width = Wd + "px";
  cv.style.height = H + "px";
  const c = cv.getContext("2d");
  c.scale(d, d);
  c.fillStyle = "#0a0e17";
  c.fillRect(0, 0, Wd, H);
  c.fillStyle = "#d4af37";
  c.font = "600 14px Inter,sans-serif";
  c.textAlign = "left";
  c.fillText(title, 16, 28);
  const [ng, ps] = HEAT[pk] || HEAT["gold-neon"],
    sh = (s) => (s.length > 16 ? s.slice(0, 15) + "..." : s);
  cs.forEach((r, i) => {
    c.font = "11px Inter,sans-serif";
    c.fillStyle = "#e8e6e1";
    c.textAlign = "right";
    c.textBaseline = "middle";
    c.fillText(sh(r), left - 8, top + i * cell + cell / 2);
    c.save();
    c.translate(left + i * cell + cell / 2, top + n * cell + 10);
    c.rotate(Math.PI / 4);
    c.textAlign = "left";
    c.fillText(sh(r), 0, 0);
    c.restore();
    cs.forEach((k, j) => {
      const v = i === j ? 1 : corr(r, k);
      c.fillStyle = mix("#101726", v >= 0 ? ps : ng, Math.min(1, Math.abs(v)));
      c.fillRect(left + j * cell + 1, top + i * cell + 1, cell - 2, cell - 2);
      c.fillStyle = Math.abs(v) > 0.55 ? "#0a0e17" : "#e8e6e1";
      c.textAlign = "center";
      c.font = "600 12px Inter,sans-serif";
      c.fillText(v.toFixed(2), left + j * cell + cell / 2, top + i * cell + cell / 2);
    });
  });
}
// Chart.js axis settings shared by all charts (grid, ticks, optional title).
function ax(t, x) {
  return Object.assign(
    {
      grid: { color: "rgba(255,255,255,.05)" },
      ticks: { color: "#a3adbf" },
      title: { display: !!t, text: t, color: "#a3adbf" },
    },
    x || {},
  );
}
// Chart.js options shared by all charts (title, legend, axes).
function copt(title, o) {
  o = o || {};
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: title, color: "#d4af37", font: { size: 14, weight: "600" } },
      legend: { display: !!o.legend, labels: { color: "#e2e8f0", usePointStyle: true } },
    },
    scales: {
      x: ax(o.xT, { stacked: !!o.st }),
      y: ax(o.yT, Object.assign({ stacked: !!o.st }, o.y || {})),
    },
  };
}
// Read the chart controls and draw the selected chart type.
function drawViz() {
  const w = W();
  if (!w || !cur.length) return;
  w.type = $("v-type").value;
  w.x = $("v-x").value;
  w.y = $("v-y").value;
  w.h = $("v-h").value;
  w.pal = $("v-p").value;
  w.title = $("v-t").value.trim();
  const cv = $("vc");
  if (vizC) {
    vizC.destroy();
    vizC = null;
  }
  ["width", "height", "style"].forEach((a) => cv.removeAttribute(a));
  vmsg("");
  const ctx = cv.getContext("2d"),
    pal = PAL[w.pal] || PAL["gold-neon"],
    col = (i) => pal[i % pal.length],
    x = w.x,
    y = w.y,
    t = w.type,
    hue = t === "heatmap" || t === "boxplot" ? "" : w.h,
    multi = !!hue;
  const G = new Map();
  cur.forEach((r) => {
    const k = hue && !blank(r[hue]) ? String(r[hue]) : "All";
    if (!G.has(k)) G.set(k, []);
    G.get(k).push(r);
  });
  if (G.size > 8)
    return vmsg(
      `"${hue}" has ${G.size} groups, which is too many to color. Pick a column with 8 or fewer values.`,
    );
  if (t === "histogram") {
    const b = binning(x);
    vizC = new Chart(ctx, {
      type: "bar",
      plugins: [BG],
      data: {
        labels: b.l,
        datasets: [...G.entries()].map(([k, rows], i) => {
          const d = new Array(b.l.length).fill(0);
          rows.forEach((r) => {
            if (!blank(r[x])) {
              const j = b.i(r[x]);
              if (j >= 0) d[j]++;
            }
          });
          return {
            label: multi ? k : `Count of ${x}`,
            data: d,
            backgroundColor: alpha(col(i), 0.85),
            borderColor: col(i),
            borderWidth: 1,
            barPercentage: 1,
            categoryPercentage: 0.96,
          };
        }),
      },
      options: copt(w.title || `Distribution of ${x}`, {
        xT: x,
        yT: "Count",
        legend: multi,
        st: multi,
        y: { beginAtZero: true, ticks: { color: "#a3adbf", precision: 0 } },
      }),
    });
  } else if (t === "scatterplot") {
    if (!isNum(x) || !isNum(y))
      return vmsg("Scatter plots need two numeric columns. Pick numeric columns for X and Y.");
    vizC = new Chart(ctx, {
      type: "scatter",
      plugins: [BG],
      data: {
        datasets: [...G.entries()].map(([k, rows], i) => ({
          label: multi ? k : `${x} vs ${y}`,
          backgroundColor: alpha(col(i), 0.8),
          borderColor: col(i),
          pointRadius: 5,
          pointHoverRadius: 7,
          data: rows
            .filter((r) => typeof r[x] === "number" && typeof r[y] === "number")
            .map((r) => ({ x: r[x], y: r[y] })),
        })),
      },
      options: copt(w.title || `${y} vs ${x}`, { xT: x, yT: y, legend: multi }),
    });
  } else if (t === "linechart") {
    if (!isNum(y)) return vmsg("Line charts need a numeric Y column.");
    const ks = [...new Set(cur.map((r) => r[x]).filter((v) => !blank(v)))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    vizC = new Chart(ctx, {
      type: "line",
      plugins: [BG],
      data: {
        labels: ks.map(String),
        datasets: [...G.entries()].map(([k, rows], i) => ({
          label: multi ? k : `Average ${y}`,
          borderColor: col(i),
          backgroundColor: alpha(col(i), 0.12),
          fill: !multi,
          tension: 0.3,
          spanGaps: true,
          pointRadius: 3,
          data: ks.map((key) => {
            const v = rows.filter((r) => r[x] === key && typeof r[y] === "number").map((r) => r[y]);
            return v.length ? fmt(v.reduce((a, b) => a + b, 0) / v.length) : null;
          }),
        })),
      },
      options: copt(w.title || `${y} by ${x}`, { xT: x, yT: y, legend: multi }),
    });
  } else if (t === "boxplot") {
    if (!isNum(y)) return vmsg("Box plots need a numeric Y column.");
    let cs = [...new Set(cur.map((r) => r[x]).filter((v) => !blank(v)))];
    const gr = !isNum(x) && cs.length >= 2 && cs.length <= 12;
    cs = gr ? cs.map(String).sort() : [y];
    const it = cs
      .map((c) => {
        const v = cur
          .filter((r) => (!gr || String(r[x]) === c) && typeof r[y] === "number")
          .map((r) => r[y])
          .sort((a, b) => a - b);
        if (!v.length) return null;
        const q1 = quant(v, 0.25),
          md = quant(v, 0.5),
          q3 = quant(v, 0.75),
          iq = q3 - q1,
          ins = v.filter((n) => n >= q1 - 1.5 * iq && n <= q3 + 1.5 * iq);
        return {
          c,
          s: {
            q1,
            md,
            q3,
            lo: ins[0],
            hi: ins[ins.length - 1],
            out: v.filter((n) => n < q1 - 1.5 * iq || n > q3 + 1.5 * iq),
          },
        };
      })
      .filter(Boolean);
    const all = cur.map((r) => r[y]).filter((n) => typeof n === "number"),
      mn = arrMin(all),
      mx = arrMax(all),
      pd = (mx - mn) * 0.08 || 1;
    const ex = {
      id: "box",
      afterDatasetsDraw(ch) {
        const c = ch.ctx,
          m = ch.getDatasetMeta(0),
          p = (v) => ch.scales.y.getPixelForValue(v),
          ln = (a, b, d, e) => {
            c.beginPath();
            c.moveTo(a, b);
            c.lineTo(d, e);
            c.stroke();
          };
        c.save();
        it.forEach((o, i) => {
          const el = m.data[i];
          if (!el) return;
          const cx = el.x,
            hw = el.width / 2,
            s = o.s;
          c.strokeStyle = "#e8e6e1";
          c.lineWidth = 1.5;
          ln(cx, p(s.hi), cx, p(s.q3));
          ln(cx, p(s.q1), cx, p(s.lo));
          ln(cx - hw / 2, p(s.hi), cx + hw / 2, p(s.hi));
          ln(cx - hw / 2, p(s.lo), cx + hw / 2, p(s.lo));
          c.strokeStyle = "#fff";
          c.lineWidth = 2.5;
          ln(cx - hw, p(s.md), cx + hw, p(s.md));
          c.fillStyle = pal[0];
          s.out.forEach((v) => {
            c.beginPath();
            c.arc(cx, p(v), 3.5, 0, 6.2832);
            c.fill();
          });
        });
        c.restore();
      },
    };
    const o = copt(w.title || (gr ? `${y} by ${x}` : `Distribution of ${y}`), {
      xT: gr ? x : "",
      yT: y,
      y: { beginAtZero: false, min: mn - pd, max: mx + pd, ticks: { color: "#a3adbf" } },
    });
    o.plugins.tooltip = {
      callbacks: {
        label: (c) => {
          const s = it[c.dataIndex].s;
          return [
            `Median: ${fmt(s.md)}`,
            `Q1 to Q3: ${fmt(s.q1)} to ${fmt(s.q3)}`,
            `Whiskers: ${fmt(s.lo)} to ${fmt(s.hi)}`,
            `Outliers: ${s.out.length}`,
          ];
        },
      },
    };
    vizC = new Chart(ctx, {
      type: "bar",
      plugins: [BG, ex],
      options: o,
      data: {
        labels: it.map((i) => i.c),
        datasets: [
          {
            label: y,
            data: it.map((i) => [i.s.q1, i.s.q3]),
            backgroundColor: alpha(pal[1 % pal.length], 0.45),
            borderColor: pal[1 % pal.length],
            borderWidth: 1.5,
            barPercentage: 0.5,
            categoryPercentage: 0.8,
          },
        ],
      },
    });
  } else if (t === "heatmap") {
    const nm = numCols();
    if (nm.length < 2) return vmsg("A correlation heatmap needs at least two numeric columns.");
    heat(cv, nm, w.pal, w.title || "Correlation between numeric columns");
  }
}
// Download the active chart as a JPG image.
function jpg() {
  const a = document.createElement("a");
  a.download = `datarefine_chart_${act}.jpg`;
  a.href = $("vc").toDataURL("image/jpeg", 1);
  a.click();
}

/* ============================================================
   Tab 4: Train / validation / test split
   ============================================================ */
// Colour the filled part of each split slider.
function paint() {
  SP.forEach(([k, , c]) => {
    const e = $(k + "-r"),
      p = ((e.value - e.min) / (e.max - e.min)) * 100;
    e.style.background = `linear-gradient(to right,${c} ${p}%,#1e293b ${p}%)`;
  });
}
// Round to the nearest multiple of 5.
const r5 = (n) => Math.round(n / 5) * 5;
// Keep the three split ratios adding up to 100 when one slider moves.
function ratios(ch) {
  let tr = +$("train-r").value,
    va = +$("val-r").value,
    te = +$("test-r").value;
  if (ch === "train") {
    const m = 100 - tr;
    va = r5(m / 2);
    te = m - va;
  } else if (ch === "val") {
    const m = 100 - va;
    tr = r5(m * 0.8);
    te = m - tr;
  } else {
    const m = 100 - te;
    tr = r5(m * 0.8);
    va = m - tr;
  }
  $("train-r").value = tr;
  $("val-r").value = va;
  $("test-r").value = te;
  $("train-l").textContent = tr + "%";
  $("val-l").textContent = va + "%";
  $("test-l").textContent = te + "%";
  $("s-tot").textContent = tr + va + te + "%";
  doSplit();
}
// Columns that can be used to keep the mix of values the same in every subset (2 to 20 different values).
function fillSplitCols() {
  const ok = cols().filter((c) => {
    const u = new Set();
    for (const r of cur) {
      u.add(r[c]);
      if (u.size > 20) return false;
    }
    return u.size > 1 && u.size < cur.length;
  });
  keep("sp-strat", '<option value="">Nothing (random)</option>' + opt(ok.map((c) => [c, c])));
}
// Split the rows into train / validation / test and redraw. Same seed + same data = same split.
// newSeed = true picks a new random seed first. A "keep the mix of" column splits every value on its own (stratified).
function doSplit(newSeed) {
  if (newSeed === true) $("sp-seed").value = Math.floor(Math.random() * 1e6);
  const seed = Math.floor(+$("sp-seed").value) || 0,
    fr = [+$("train-r").value, +$("val-r").value, +$("test-r").value].map((v) => v / 100),
    by = $("sp-strat").value;
  let parts = [[], [], []];
  if (by && cur.length && by in cur[0]) {
    const g = new Map();
    cur.forEach((r) => {
      const k = blank(r[by]) ? "(blank)" : String(r[by]);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    });
    g.forEach((list) => splitList(list, fr, seed).forEach((p, i) => (parts[i] = parts[i].concat(p))));
    const r = rng(seed + 1); // mix the groups together again inside each subset
    parts.forEach((a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
    });
  } else parts = splitList(cur, fr, seed);
  [trn, val, tst] = parts;
  stale = false;
  paint();
  $("train-n").textContent = trn.length + " rows";
  $("val-n").textContent = val.length + " rows";
  $("test-n").textContent = tst.length + " rows";
  drawSplit();
}
// Draw the split doughnut chart.
function drawSplit() {
  paint();
  if (spC) spC.destroy();
  const d = [trn.length, val.length, tst.length],
    n = d[0] + d[1] + d[2] || 1,
    cl = SP.map((s) => s[2]),
    nm = ["Train", "Validation", "Test"];
  spC = new Chart($("sp-chart"), {
    type: "doughnut",
    data: {
      labels: nm,
      datasets: [{ data: d, backgroundColor: cl, borderWidth: 2, borderColor: "#0f172a" }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "#e2e8f0",
            usePointStyle: true,
            generateLabels: () =>
              nm.map((l, i) => ({
                text: `${l}: ${d[i]} rows (${Math.round((d[i] / n) * 100)}%)`,
                fillStyle: cl[i],
                strokeStyle: cl[i],
                fontColor: "#e2e8f0",
                pointStyle: "circle",
                index: i,
              })),
          },
        },
      },
    },
  });
}
// Start on the "missing values" cleaning sub-tab.
subTab("missing");
checkResume();
