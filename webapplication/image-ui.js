/**
 * DataRefine Platform - image part (user interface)
 *
 * Flow: drop an image folder / ZIP / image files (or the image demo) -> startImages() -> four tabs:
 *   1. Dataset Info     - health score, duplicates, colour modes, blur, per-image table      (Module five)
 *   2. Clean & Process  - remove duplicates / corrupted, colour mode, blur, size, format      (Module six)
 *   3. Label            - one label per image, or draw boxes inside images (YOLO)             (Module seven)
 *   4. Split & Export   - train / valid / test split, downloaded as a ZIP                     (Module eight)
 *
 * The engine (reading, analysis, pixel operations, saving) is in image-core.js.
 * Uses helpers from script.js: $, esc, r5, ax, BG, setNav.
 *
 * Short names: IM = all image state, it = one image record, LB = labeled dataset,
 *   ic* = Clean tab, il* = Label tab, is* = Split tab, ii* = Info tab.
 */

/* ============================================================
   State and constants
   ============================================================ */
const ITABS = [
  ["iinfo", "Dataset Info", "fa-chart-pie"],
  ["iclean", "Clean & Process", "fa-broom"],
  ["ilabel", "Label", "fa-tags"],
  ["isplit", "Split & Export", "fa-arrows-split-up-and-left"],
];
// Cleaning sub-tabs: [id, label].
const ISUBS = [["dups", "Remove"], ["color", "Colour"], ["blur", "Blur"], ["size", "Size"], ["format", "Format"]];
const ICOL = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa", "#00acc1", "#fdd835", "#6d4c41"]; // box colours
// Split sliders: [key, label, colour, text class, button class, icon, default %, min %, max %].
const ISP = [
  ["train", "Train", "#d4af37", "text-gold", "b-gold", "fa-brain", 70, 10, 100],
  ["valid", "Validation", "#3b9eff", "text-neon", "b-blue", "fa-sliders", 20, 0, 50],
  ["test", "Test", "#a78bfa", "text-violet-400", "b-violet", "fa-vial-circle-check", 10, 0, 50],
];
const IFILT = [["all", "All"], ["bad", "Corrupted"], ["dup", "Duplicates"], ["blur", "Blurry"], ["blank", "Blank"]];
const TABULAR = /\.(csv|xlsx|xls|json)$/i;
const HIST_IMG_MAX = 15; // undo steps kept in memory; older steps stay only as text in the change log
const IM = {
  items: [], orig: [], hist: [], histOld: [], last: null, name: "", tab: "iinfo", sub: "dups", showAll: false,
  filter: "all", page: 1, ch: {}, LB: null, lbDropped: false, split: null, splitLB: null, keep: new Set(),
  opt: { cor: "d", dup: "a", near: "k", color: "rgb", blurry: "s", blank: "d", sop: "pct", a: "", b: "", fmt: ".jpg" },
  lab: { kind: "folder", names: [], active: false, err: "" },
};

/* ============================================================
   Small helpers
   ============================================================ */
const okItems = () => IM.items.filter((i) => !i.corrupted);
const stem = (n) => n.replace(/\.[^.]+$/, "");
const isDup = (it, alive) => !it.corrupted && !!it.dupOf && alive.has(it.dupOf);
// A picture that looks almost the same as an earlier one that is still in the dataset (not an exact copy).
const isNear = (it, alive) => !it.corrupted && !!it.nearOf && alive.has(it.nearOf) && !isDup(it, alive);
const tsrc = (it) => it.th || (it.url = it.url || URL.createObjectURL(it.file)); // thumbnail source
const descr = (it) => `${it.w}x${it.h}, ${it.mode}, brightness ${Math.round(it.bright)}`;
function busy(t) {
  $("ib").classList.toggle("hidden", !t);
  if (t) $("ib-t").textContent = t;
}
function spin(on, t) {
  const s = $("spin");
  s.classList.toggle("hidden", !on);
  s.classList.toggle("flex", on);
  $("spin-t").textContent = t || "Reading your file...";
}
function dl(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const thumbHTML = (it) =>
  it.corrupted
    ? '<div class="thumb flex items-center justify-center text-red-400"><i class="fa-solid fa-file-circle-xmark text-2xl"></i></div>'
    : `<img class="thumb" loading="lazy" alt="" src="${tsrc(it)}">`;
// Grid of thumbnails with an optional small badge text per image.
const gal = (list, badge) =>
  `<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">${list
    .map(
      (it) =>
        `<div class="space-y-1 min-w-0"><div class="relative">${thumbHTML(it)}${badge ? `<span class="absolute top-1 left-1 text-[9px] px-1.5 py-0.5 rounded bg-black/75 text-amber-300 font-mono">${esc(badge(it))}</span>` : ""}</div><div class="text-[10px] text-slate-400 truncate" title="${esc(it.path)}">${esc(it.name)}</div></div>`,
    )
    .join("")}</div>`;
const statCard = (l, ic, tc, b, v, s) =>
  `<div class="card ${b}"><div class="flex justify-between mb-2"><span class="text-xs font-mono uppercase tracking-wider text-slate-400">${l}</span><i class="fa-solid ${ic} ${tc} text-lg"></i></div><div class="text-4xl font-extrabold ${tc}">${v}</div><div class="text-[11px] text-slate-400 mt-1">${s}</div></div>`;
// ZIP download: files are {path, text} or {path, item, force}. Untouched images are copied byte for byte.
async function zipDownload(files, name) {
  if (!files.length) return alert("There is nothing to save.");
  if (
    files.length > 2000 &&
    !(await ask(
      `This ZIP will hold ${files.length.toLocaleString()} files and is built in your browser's memory. If the tab runs out of memory, use "Download each split as its own ZIP" in the Split tab, or clean fewer images at a time.`,
      { title: "Large export", ok: "Create ZIP" },
    ))
  )
    return;
  const z = new JSZip(),
    fail = [];
  try {
    for (let k = 0; k < files.length; k++) {
      const f = files[k];
      busy(`Preparing ${name}... ${k + 1} / ${files.length}`);
      if (k % 3 === 2) await tick();
      try {
        z.file(f.path, f.text != null ? f.text : await imgBlob(f.item, f.force));
      } catch (e) {
        fail.push(`${f.path}: ${e.message}`);
      }
    }
    busy("Building the ZIP file...");
    dl(await z.generateAsync({ type: "blob", compression: "STORE" }), name);
  } finally {
    busy("");
  }
  if (fail.length) alert(`${fail.length} file(s) could not be saved:\n` + fail.slice(0, 5).join("\n"));
}

/* ============================================================
   Loading images (upload page): folder, files, ZIP, drag and drop, demo
   ============================================================ */
// Files chosen with the file / folder buttons: one table file goes to the table app, everything else to images.
function routeFiles(list) {
  const f = [...list];
  if (!f.length) return;
  if (f.length === 1 && TABULAR.test(f[0].name)) parseFile(f[0]);
  else loadImages(f);
}
// Read a dropped folder (and its sub-folders) into [{file, path}].
async function dropEntries(ens) {
  const out = [],
    walk = async (en, prefix) => {
      if (en.isFile) {
        const file = await new Promise((ok, no) => en.file(ok, no));
        out.push({ file, path: prefix + file.name });
      } else if (en.isDirectory) {
        const rd = en.createReader();
        let all = [];
        for (;;) {
          const b = await new Promise((ok, no) => rd.readEntries(ok, no));
          if (!b.length) break;
          all = all.concat(b);
        }
        for (const c of all) await walk(c, prefix + en.name + "/");
      }
    };
  for (const en of ens) await walk(en, "");
  return out;
}
async function routeDrop(e) {
  const dt = e.dataTransfer,
    ens = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean), // read before any await
    files = [...dt.files];
  if (files.length === 1 && TABULAR.test(files[0].name)) return parseFile(files[0]);
  spin(true, "Reading files...");
  try {
    loadImages(ens.length ? await dropEntries(ens) : files);
  } catch (err) {
    spin(false);
    alert("Could not read the dropped files.");
  }
}
async function loadImages(inputs, label) {
  spin(true, "Reading images...");
  try {
    const entries = await imgCollect(inputs);
    if (!entries.length) return alert("No image files were found. Use JPG, PNG, BMP, GIF, TIFF or WEBP files, a folder of them, or a ZIP file.");
    if (
      entries.length > 3000 &&
      !(await ask(
        `This set has ${entries.length.toLocaleString()} images. They are analysed and kept in your browser's memory, so loading can take several minutes and use a lot of RAM. For the best result, work with a few thousand images at a time.`,
        { title: "Large image set", ok: "Load anyway" },
      ))
    )
      return;
    const { items, root } = await imgReadAll(entries, (i, n, w) => spin(true, w ? `Looking for similar images ${i} / ${n}...` : `Analysing images ${i} / ${n}...`)),
      first = inputs[0].file || inputs[0];
    startImages(items, label || (inputs.length === 1 && /\.zip$/i.test(first.name) ? first.name : root.split("/").pop() || `${items.length} image files`));
  } catch (err) {
    alert("Could not read these images: " + ((err && err.message) || err));
  } finally {
    spin(false);
  }
}
// Make a small sample dataset in the browser: two classes with duplicates, blurry, blank, grey, transparent and broken files.
async function imgDemo() {
  spin(true, "Creating demo images...");
  try {
    const R = rng(11),
      cv = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }),
      out = [],
      make = (w, h, shape, hue, o = {}) => {
        const c = cv(w, h),
          x = c.getContext("2d"),
          sat = o.gray ? 0 : 65;
        if (o.blank) {
          x.fillStyle = "hsl(210,40%,45%)";
          x.fillRect(0, 0, w, h);
        } else {
          if (!o.alpha) {
            x.fillStyle = `hsl(${(hue + 180) % 360},${sat / 2}%,${22 + R() * 10}%)`;
            x.fillRect(0, 0, w, h);
            for (let i = 0; i < (w * h) / 5; i++) {
              x.fillStyle = `hsl(${hue},${sat}%,${15 + R() * 40}%)`;
              x.fillRect(R() * w, R() * h, 2, 2);
            }
          }
          x.fillStyle = `hsl(${hue},${sat}%,${62 + R() * 12}%)`;
          if (shape === "circle") {
            x.beginPath();
            x.arc(w / 2, h / 2, h * 0.3, 0, 7);
            x.fill();
          } else x.fillRect(w / 2 - h * 0.28, h / 2 - h * 0.28, h * 0.56, h * 0.56);
          x.fillStyle = `hsl(${hue},${sat}%,25%)`;
          for (let i = -3; i <= 3; i++) x.fillRect(w / 2 - h * 0.25, h / 2 + i * 9, h * 0.5, 3);
        }
        if (o.blur) {
          const s = cv(Math.ceil(w / o.blur), Math.ceil(h / o.blur));
          s.getContext("2d").drawImage(c, 0, 0, s.width, s.height);
          x.imageSmoothingEnabled = true;
          x.clearRect(0, 0, w, h);
          x.drawImage(s, 0, 0, w, h);
        }
        return c;
      },
      add = async (folder, name, c, type) => {
        const b = await toBlob(c, type, 0.9);
        out.push({ file: new File([b], name, { type }), path: `${folder}/${name}` });
        return b;
      },
      J = "image/jpeg",
      P = "image/png";
    let first;
    for (let i = 1; i <= 5; i++) {
      const b = await add("circle", `circle_0${i}.jpg`, make(160, 120, "circle", R() * 360), J);
      if (i === 1) first = b;
    }
    out.push({ file: new File([first], "circle_01_copy.jpg", { type: J }), path: "circle/circle_01_copy.jpg" }); // exact duplicate
    await add("circle", "circle_gray.png", make(160, 120, "circle", 0, { gray: true }), P);
    await add("circle", "circle_transparent.png", make(160, 120, "circle", 200, { alpha: true }), P);
    await add("circle", "circle_blurry.jpg", make(160, 120, "circle", 40, { blur: 9 }), J);
    for (let i = 1; i <= 4; i++) await add("square", `square_0${i}.jpg`, make(160, 120, "square", R() * 360), J);
    await add("square", "square_05_large.jpg", make(320, 240, "square", R() * 360), J);
    await add("square", "square_very_blurry.jpg", make(160, 120, "square", 300, { blur: 30 }), J);
    await add("square", "square_blank.jpg", make(160, 120, "square", 0, { blank: true }), J);
    out.push({ file: new File(["this is not really an image"], "broken.jpg", { type: J }), path: "square/broken.jpg" });
    await loadImages(out, "Demo images (sample)");
  } catch (e) {
    spin(false);
    alert("Could not create the demo images.");
  }
}
// Show the image app and open the first tab.
function startImages(items, name) {
  imgFree();
  Object.assign(IM, { items, orig: items.map((i) => ({ ...i })), hist: [], histOld: [], last: null, name, filter: "all", page: 1, LB: null, lbDropped: false, split: null, keep: new Set(), sub: "dups" });
  IM.lab = { kind: "folder", names: [], active: false, err: "" };
  document.documentElement.classList.remove("landing");
  $("landing").classList.add("hidden");
  $("choose").classList.add("hidden");
  $("app").classList.add("hidden");
  $("app-img").classList.remove("hidden");
  setNav(ITABS, "igo");
  $("nav").style.display = "";
  $("newbtn").classList.remove("hidden");
  igo("iinfo");
}
// Hide the image app (called when a table file is loaded or the app is reset).
function imgHide() {
  $("app-img").classList.add("hidden");
  imgFree();
}
function imgFree() {
  IM.items.concat(IM.orig).forEach((i) => i.url && URL.revokeObjectURL(i.url));
  Object.values(IM.ch).forEach((c) => c.destroy());
  Object.assign(IM, { items: [], orig: [], hist: [], histOld: [], ch: {}, LB: null, split: null, last: null });
  IM.lab.active = false;
}
// Show image tab k and render it.
function igo(k) {
  IM.tab = k;
  ITABS.forEach(([t]) => {
    $("p-" + t).classList.toggle("hidden", t !== k);
    $("t-" + t).classList.toggle("on", t === k);
  });
  if (k === "iinfo") iInfo();
  if (k === "iclean") icAll();
  if (k === "ilabel") ilRender();
  if (k === "isplit") isInit();
}
const iRefresh = () => igo(IM.tab);

/* ============================================================
   Tab 1: Dataset info (Module five)
   ============================================================ */
// Bar chart with the value written above (or beside) each bar.
function iBar(id, labels, data, colors, horizontal, title) {
  if (IM.ch[id]) IM.ch[id].destroy();
  const VL = {
    id: "vl",
    afterDatasetsDraw(ch) {
      const x = ch.ctx;
      x.save();
      x.fillStyle = "#e8e6e1";
      x.font = "600 11px Inter,sans-serif";
      ch.getDatasetMeta(0).data.forEach((b, i) => {
        const v = +ch.data.datasets[0].data[i].toFixed(2);
        x.textAlign = horizontal ? "left" : "center";
        x.fillText(v, horizontal ? b.x + 5 : b.x, horizontal ? b.y + 4 : b.y - 5);
      });
      x.restore();
    },
  };
  IM.ch[id] = new Chart($(id), {
    type: "bar",
    plugins: [BG, VL],
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          // Rounded corners on a bar that is only ~1px tall show up as small bright blobs at its ends, so very small bars stay flat.
          borderRadius: (c) => (!horizontal && c.raw > 0 && c.raw / Math.max(...c.dataset.data) < 0.005 ? 0 : 4),
        },
      ],
    },
    options: {
      indexAxis: horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 14, right: horizontal ? 30 : 0 } },
      plugins: { legend: { display: false }, title: { display: true, text: title, color: "#d4af37", font: { size: 13, weight: "600" } } },
      scales: { x: ax("", { beginAtZero: true }), y: ax("", { beginAtZero: true, ticks: { color: "#a3adbf", precision: 0 } }) },
    },
  });
}
function iInfo() {
  const f = imgInfo(IM.items),
    hc = f.score >= 90 ? "text-emerald-400" : f.score >= 75 ? "text-gold" : "text-red-400",
    bl = f.blur.Blurry + f.blur["Very Blurry"];
  $("ii-meta").innerHTML =
    `<span><i class="fa-solid fa-images text-gold mr-1"></i><b class="text-slate-100">${esc(IM.name)}</b></span>` +
    `<span><span class="text-slate-400">Images:</span> <b class="text-gold">${f.total}</b></span>` +
    `<span><span class="text-slate-400">Size:</span> ${f.mb} MB</span>` +
    `<span><span class="text-slate-400">Cleaning steps:</span> ${IM.hist.length}</span>`;
  $("ii-cards").innerHTML =
    statCard(
      "Health Score",
      "fa-heart-pulse",
      hc,
      "border-gold/40",
      `${f.score}<span class="text-base font-bold text-slate-500">/100</span>`,
      `${f.label}<div class="h-1.5 mt-3 rounded-full bg-slate-800 overflow-hidden" title="Based on corrupted files, duplicates, blur and colour mix"><div class="h-full rounded-full ${hc.replace("text-", "bg-")}" style="width:${Math.max(0, Math.min(100, f.score))}%"></div></div>`,
    ) +
    statCard("Corrupted", "fa-file-circle-xmark", "text-amber-400", "border-amber-500/30", f.bad, `${f.badPct}% of ${f.total} files cannot be opened`) +
    statCard("Duplicates", "fa-clone", "text-red-400", "border-red-500/30", f.dups, `Exact copies. ${f.unique} unique images${f.near ? `, ${f.near} look very similar` : ""}`) +
    statCard("Blurry / Blank", "fa-droplet", "text-neon", "border-neon/30", bl + f.blur.Blank, `${f.blur.Sharp} sharp images`);
  const p = [];
  if (f.bad) p.push(`${f.bad} corrupted file${f.bad > 1 ? "s" : ""}`);
  if (f.dups) p.push(`${f.dups} duplicate${f.dups > 1 ? "s" : ""}`);
  if (f.near) p.push(`${f.near} similar image${f.near > 1 ? "s" : ""}`);
  if (bl) p.push(`${bl} blurry image${bl > 1 ? "s" : ""}`);
  if (f.blur.Blank) p.push(`${f.blur.Blank} blank image${f.blur.Blank > 1 ? "s" : ""}`);
  if (!f.total) p.length = 0;
  $("ii-issues").className = p.length
    ? "card !py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-amber-500/30"
    : "card !py-4 flex items-center gap-3 border-emerald-500/30";
  $("ii-ic").className = p.length ? "fa-solid fa-triangle-exclamation text-amber-400 mt-0.5" : "fa-solid fa-circle-check text-emerald-400";
  $("ii-tx").textContent = p.length ? `Found ${p.join(", ")}. Fix them in Clean & Process.` : "Your image dataset looks clean: no corrupted, duplicate, blurry or blank images.";
  $("ii-btn").classList.toggle("hidden", !p.length);
  iBar("ch-files", ["Valid", "Corrupted", "Duplicates"], [f.valid, f.bad, f.dups], ["#4caf50", "#e53935", "#fb8c00"], false, "Files");
  iBar("ch-color", ["RGB", "Grayscale", "RGBA"], [f.colors.RGB, f.colors.Grayscale, f.colors.RGBA], ["#1e88e5", "#757575", "#8e24aa"], false, "Colour modes");
  iBar("ch-blur", ["Sharp", "Blurry", "Very Blurry", "Blank"], [f.blur.Sharp, f.blur.Blurry, f.blur["Very Blurry"], f.blur.Blank], ["#4caf50", "#fdd835", "#e53935", "#9e9e9e"], false, "Sharpness");
  const pen = Object.entries(f.pen).filter(([, v]) => v > 0);
  iBar("ch-pen", pen.length ? pen.map(([k]) => k.replace("_", " ")) : ["none"], pen.length ? pen.map(([, v]) => v) : [0], "#e53935", true, pen.length ? "Health score penalties (points lost)" : "Health score penalties: none");
  $("ii-det").innerHTML = Object.entries(f.detail)
    .map(([k, s]) => `<tr><td class="font-bold text-gold">${k}</td><td>${s.min}</td><td>${s.max}</td><td>${s.mean}</td><td>${s.median}</td></tr>`)
    .join("");
  const chips = (o) => Object.entries(o).map(([k, v]) => `<span class="chip">${esc(k)} <b class="text-gold">${v}</b></span>`).join(" ") || "--";
  $("ii-extra").innerHTML =
    `<div><span class="text-slate-400">Formats:</span> ${chips(f.formats)}</div><div><span class="text-slate-400">Extensions:</span> ${chips(f.extensions)}</div>` +
    `<div><span class="text-slate-400">Image sizes:</span> ${f.resolutions.length} different. Most common: ${chips(Object.fromEntries(f.resolutions.slice(0, 5)))}</div>`;
  iTable();
}
// Per-image table with search, filter and paging.
function iTable() {
  const alive = new Set(IM.items.map((i) => i.path)),
    q = $("it-q").value.toLowerCase(),
    F = {
      all: () => true, bad: (i) => i.corrupted, dup: (i) => isDup(i, alive),
      blur: (i) => i.state === "Blurry" || i.state === "Very Blurry", blank: (i) => i.state === "Blank",
    },
    rows = [];
  document.querySelectorAll("#it-f button").forEach((b) => {
    b.classList.toggle("!bg-gold/20", b.dataset.f === IM.filter);
    b.classList.toggle("!text-gold", b.dataset.f === IM.filter);
  });
  IM.items.forEach((it, k) => {
    if (F[IM.filter](it) && (!q || it.path.toLowerCase().includes(q))) rows.push([it, k]);
  });
  const PS = 15,
    tp = Math.max(1, Math.ceil(rows.length / PS));
  IM.page = Math.min(Math.max(1, IM.page), tp);
  const s = (IM.page - 1) * PS;
  $("it-info").textContent = `Showing ${rows.length ? s + 1 : 0}-${Math.min(s + PS, rows.length)} of ${rows.length}`;
  $("it-pg").textContent = `Page ${IM.page} of ${tp}`;
  $("it-p").disabled = IM.page <= 1;
  $("it-n").disabled = IM.page >= tp;
  $("it-b").innerHTML = rows
    .slice(s, s + PS)
    .map(([it, k]) => {
      const d = isDup(it, alive),
        st = it.corrupted ? `<td class="c-miss" title="${esc(it.error)}">Corrupted</td>` : d ? `<td class="text-red-400">copy of ${esc(it.dupOf.split("/").pop())}</td>` : `<td>${it.state}</td>`;
      return (
        `<tr class="${d ? "row-dup" : ""}"><td class="!py-1 w-14">${thumbHTML(it)}</td><td class="text-slate-500">${k + 1}</td><td class="text-gold" title="${esc(it.path)}">${esc(it.name)}</td>` +
        (it.corrupted
          ? `<td colspan="5" class="text-slate-500">--</td>`
          : `<td>${it.w}x${it.h}</td><td>${it.mode}</td><td>${r1(it.bright)}</td><td>${r1(it.blur)}</td><td>${it.format}</td>`) +
        `<td>${r2(it.size / 1024)}</td>${st}</tr>`
      );
    })
    .join("");
}
function iCSV() {
  dl(new Blob(["\ufeff" + Papa.unparse(imgRows(IM.items))], { type: "text/csv;charset=utf-8;" }), "image_table.csv");
}
// Dashboard PNG: the four charts on one picture (like Module five's dataset_health.png).
function iDashPNG() {
  const f = imgInfo(IM.items),
    cs = ["ch-files", "ch-color", "ch-blur", "ch-pen"].map((i) => $(i)),
    cw = 520,
    hs = cs.map((c) => (cw * c.height) / c.width),
    rowH = [Math.max(hs[0], hs[1]), Math.max(hs[2], hs[3])],
    c = document.createElement("canvas");
  c.width = 1100;
  c.height = Math.round(90 + rowH[0] + rowH[1] + 50);
  const x = c.getContext("2d");
  x.fillStyle = "#0a0e17";
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#d4af37";
  x.font = "700 26px Inter,sans-serif";
  x.textAlign = "center";
  x.fillText(`Dataset Health: ${f.score} / 100 (${f.label})`, c.width / 2, 48);
  cs.forEach((cv, i) => x.drawImage(cv, 40 + (i % 2) * 540, 80 + (i > 1 ? rowH[0] + 20 : 0), cw, hs[i]));
  c.toBlob((b) => dl(b, "dataset_health.png"), "image/png");
}

/* ============================================================
   Tab 2: Clean & process (Module six)
   ============================================================ */
// Save an undo snapshot before a change (images are never changed in place, so a shallow copy is enough).
function isnap(d) {
  IM.hist.push({ items: IM.items.map((i) => ({ ...i })), d, t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
}
function iLabelsDropped() {
  if (IM.LB) IM.lbDropped = true;
  IM.LB = null;
  IM.split = null;
}
function iundo() {
  if (!IM.hist.length) return;
  IM.items = IM.hist.pop().items.map((i) => ({ ...i }));
  IM.last = null;
  iLabelsDropped();
  iRefresh();
}
// Download the list of cleaning steps as a JSON file (for reports and reproducibility).
function iLog() {
  const steps = [...IM.histOld, ...IM.hist.map(({ d, t }) => ({ d, t }))];
  dl(
    new Blob(
      [JSON.stringify({ tool: "DataRefine Platform", dataset: IM.name, exported: new Date().toISOString(), images_original: IM.orig.length, images_now: IM.items.length, steps: steps.map((x, i) => ({ step: i + 1, change: x.d, time: x.t })) }, null, 2)],
      { type: "application/json" },
    ),
    "change_log.json",
  );
}
async function irevert() {
  if (
    !IM.hist.length ||
    !(await ask("All cleaning steps will be undone and the images go back to the original upload.", {
      title: "Revert all changes?",
      ok: "Revert",
      danger: true,
    }))
  )
    return;
  IM.items = IM.orig.map((i) => ({ ...i }));
  IM.hist = [];
  IM.histOld = [];
  IM.last = null;
  iLabelsDropped();
  iRefresh();
}
function iopt(k, v) {
  IM.opt[k] = v;
  icView();
}
function icSub(k) {
  IM.sub = k;
  icAll();
}
function icAll() {
  const al = new Set(IM.items.map((i) => i.path)),
    cnt = {
      dups: IM.items.filter((i) => i.corrupted || isDup(i, al) || isNear(i, al)).length,
      blur: okItems().filter((i) => i.state === "Blank" || (!i.sharpened && (i.state === "Blurry" || i.state === "Very Blurry"))).length,
    };
  const SUBICON = { dups: "fa-clone", color: "fa-palette", blur: "fa-droplet", size: "fa-up-right-and-down-left-from-center", format: "fa-file-image" };
  $("ic-subs").innerHTML = ISUBS.map(
    ([k, l]) =>
      `<button onclick="icSub('${k}')" class="sub ${k === IM.sub ? "on" : ""} !px-2.5 !py-1.5 text-xs font-semibold flex items-center gap-1.5"><i class="fa-solid ${SUBICON[k]} text-[10px]"></i>${l}${cnt[k] ? `<span class="text-[9px] font-mono leading-none px-1 py-0.5 rounded-full bg-amber-500/20 text-amber-300">${cnt[k]}</span>` : ""}</button>`,
  ).join("");
  $("ic-undo").disabled = !IM.hist.length;
  $("ic-n").textContent = IM.hist.length;
  $("ic-log").innerHTML = IM.hist.length
    ? IM.hist.map((h, i) => `<div class="flex gap-2"><span class="text-gold w-5 text-right">${i + 1}.</span><span class="flex-1">${esc(h.d)}</span><span class="text-slate-500">${h.t}</span></div>`).join("")
    : '<div class="italic text-slate-500">No changes yet.</div>';
  $("ic-log").scrollTop = 1e6;
  icPane();
  icView();
}
// One big option card: a radio with a title and a short explanation. The selected card is highlighted by CSS (.rc:has(input:checked)).
const rad = (k, v, t, d = "") =>
  `<label class="rc flex items-start gap-2.5 !px-3 !py-2"><input type="radio" name="${k}" value="${v}" ${IM.opt[k] === v ? "checked" : ""} onchange="iopt('${k}',this.value)" class="mt-0.5 accent-[#d4af37]"><span class="min-w-0"><span class="block text-[13px] font-semibold text-slate-100">${t}</span>${d ? `<span class="block text-[11px] text-slate-400 leading-snug">${d}</span>` : ""}</span></label>`;
// Pane title with a one-line plain explanation.
const paneHead = (ic, c, t, s = "") =>
  `<div><h4 class="text-base font-bold text-slate-100 flex items-center gap-2"><i class="fa-solid ${ic} ${c}"></i>${t}</h4>${s ? `<p class="text-xs text-slate-400 mt-0.5">${s}</p>` : ""}</div>`;
// A group of options with a heading and how many images it affects.
const grp = (t, n, c, opts, hint = "") =>
  `<div class="space-y-2"><div class="flex items-center justify-between gap-3"><span class="text-xs font-semibold uppercase tracking-wide text-slate-300">${t}</span><span class="text-[11px] font-mono px-2 py-0.5 rounded-full ${n ? c : "bg-slate-800 text-slate-500"}">${n} found</span></div>${hint ? `<p class="text-xs text-slate-500 -mt-1">${hint}</p>` : ""}<div class="space-y-1.5">${opts}</div></div>`;
const note = (t) => `<p class="text-[11px] text-slate-500 leading-snug">${t}</p>`;
const applyBtn = (fn, cls, t) => `<button onclick="${fn}" class="btn ${cls} w-full !py-2.5">${t}</button>`;
const SIZE_LBL = {
  pct: "Percent (50 = half size)", width: "New width in pixels (height follows)", height: "New height in pixels (width follows)",
  exact: "Exact width and height, ratio NOT kept (e.g. 224 x 224)", mp: "Target megapixels (e.g. 0.25), ratio kept", bright: "Brightness factor (1.0 = same, 1.2 = 20% brighter)",
};
// What each size operation asks for: label, unit shown inside the box, example value and a short hint.
const SIZE_UI = {
  pct: ["Resize by percent", "Percent", "%", "50", "50 means half the size."],
  width: ["Resize by width", "Width", "px", "224", "The height follows, so the shape is kept."],
  height: ["Resize by height", "Height", "px", "224", "The width follows, so the shape is kept."],
  exact: ["Exact width and height", "Width and height", "px", "224", "Both sizes are forced, so the shape can stretch."],
  mp: ["Change megapixels", "Megapixels", "MP", "0.25", "The shape is kept."],
  bright: ["Change brightness", "Brightness", "x", "1.2", "1.0 is the same, 1.2 is 20% brighter."],
};
const FMT_DESC = { ".jpg": "Small files. No transparency.", ".png": "Lossless. Keeps transparency.", ".bmp": "Uncompressed. Large files.", ".webp": "Small and modern.", ".tiff": "Lossless. Large files." };
// The controls on the left of the Clean tab (they depend on the chosen sub-tab).
function icPane() {
  const al = new Set(IM.items.map((i) => i.path)),
    bad = IM.items.filter((i) => i.corrupted).length,
    dups = IM.items.filter((i) => isDup(i, al)).length,
    near = IM.items.filter((i) => isNear(i, al)).length,
    ok = okItems(),
    blurry = ok.filter((i) => !i.sharpened && (i.state === "Blurry" || i.state === "Very Blurry")).length,
    blank = ok.filter((i) => i.state === "Blank").length,
    fm = [".jpg", ".png", ".bmp", ".webp", ".tiff"];
  let h = "";
  if (IM.sub === "dups")
    h =
      paneHead("fa-clone", "text-red-400", "Duplicates and broken files", "Remove copies, similar pictures and files that cannot be opened.") +
      grp("Corrupted files", bad, "bg-amber-500/20 text-amber-300", rad("cor", "d", "Delete them", "Remove them from the cleaned dataset.") + rad("cor", "k", "Keep them")) +
      grp("Duplicate images", dups, "bg-red-500/20 text-red-300", rad("dup", "a", "Delete all duplicates", "The first copy is always kept.") + rad("dup", "k", "Keep all") + rad("dup", "o", "Choose one by one", "Tick the ones to delete on the right.")) +
      grp("Similar images", near, "bg-amber-500/20 text-amber-300", rad("near", "k", "Keep them", "Resized or re-saved copies are not exact duplicates, so check them first.") + rad("near", "d", "Delete similar copies", "The first picture of each group is always kept.")) +
      applyBtn("icRemove()", "b-red", "Apply");
  else if (IM.sub === "color")
    h =
      paneHead("fa-palette", "text-gold", "Colour mode", "Pick the colour format for every image.") +
      `<div class="space-y-1.5">${rad("color", "rgb", "RGB", "Most common for model training.")}${rad("color", "gray", "Grayscale", "Smaller and faster to train.")}${rad("color", "bgr", "BGR", "OpenCV order. Saved files look colour-swapped in normal viewers.")}</div>` +
      applyBtn("icColor()", "b-gold", "Apply colour mode")
  else if (IM.sub === "blur")
    h =
      paneHead("fa-droplet", "text-neon", "Blurry and blank images", "Fix or remove images that are out of focus or empty.") +
      grp("Blurry images", blurry, "bg-amber-500/20 text-amber-300", rad("blurry", "d", "Delete them") + rad("blurry", "s", "Sharpen them", "Uses an unsharp mask.") + rad("blurry", "k", "Keep them")) +
      grp("Blank images", blank, "bg-amber-500/20 text-amber-300", rad("blank", "d", "Delete them", "Images made of one flat colour.") + rad("blank", "k", "Keep them")) +
      applyBtn("icBlur()", "b-gold", "Apply")
  else if (IM.sub === "size") {
    const o = IM.opt,
      U = SIZE_UI[o.sop] || SIZE_UI.pct,
      box = (v, f) => `<div class="relative flex-1"><input class="in !py-2 !pr-9" type="number" min="0" step="any" placeholder="${U[3]}" value="${esc(v)}" oninput="IM.opt.${f}=this.value;icView()"><span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500">${U[2]}</span></div>`;
    h =
      paneHead("fa-up-right-and-down-left-from-center", "text-gold", "Size and brightness", "Change the size of every image, or make them brighter.") +
      `<div class="space-y-1"><label class="lbl">What do you want to change?</label><select class="in !py-2" onchange="iopt('sop',this.value);icPane()">${Object.keys(SIZE_UI).map((k) => `<option value="${k}" ${o.sop === k ? "selected" : ""}>${SIZE_UI[k][0]}</option>`).join("")}</select></div>` +
      `<div class="space-y-1"><label class="lbl">${U[1]}</label><div class="flex items-center gap-2">${box(o.a, "a")}${o.sop === "exact" ? `<span class="text-slate-500">x</span>${box(o.b, "b")}` : ""}</div><p class="text-[11px] text-slate-500">${U[4]}</p></div>` +
      applyBtn("icSize()", "b-gold", "Apply")
  } else
    h =
      paneHead("fa-file-image", "text-neon", "File format", "Choose the format all images are saved in.") +
      `<div class="grid grid-cols-2 gap-1.5">${fm.map((e) => rad("fmt", e, e, FMT_DESC[e])).join("")}</div>` +
      applyBtn("icFormat()", "b-gold", "Apply format")
  $("ic-pane").innerHTML = h;
}
// The right side of the Clean tab: last change, details of the open sub-tab, then the Live Image View.
function icView() {
  const al = new Set(IM.items.map((i) => i.path)),
    ok = okItems(),
    L = IM.last,
    by = new Map(IM.items.map((i) => [i.path, i])),
    sec = (t, c) => `<div class="text-xs font-mono ${c}">${t}</div>`;
  let h = "";
  if (L) {
    h += `<div class="p-3 rounded-xl border border-gold/30 bg-gold/5 space-y-3"><div class="text-xs font-bold text-gold"><i class="fa-solid fa-circle-check mr-1"></i>${esc(L.text)}</div>`;
    if (L.ex)
      h += `<div class="flex items-start gap-3 text-[11px] text-slate-300"><div class="w-36 shrink-0"><img class="thumb" src="${L.ex.bt}"><div class="mt-1 text-slate-400">Before</div><div>${esc(L.ex.b)}</div></div><i class="fa-solid fa-arrow-right text-gold mt-10"></i><div class="w-36 shrink-0"><img class="thumb" src="${L.ex.at}"><div class="mt-1 text-slate-400">After</div><div>${esc(L.ex.a)}</div></div><div class="text-slate-500 min-w-0 break-words">${esc(L.ex.name)}</div></div>`;
    h += "</div>";
  }
  if (IM.sub === "dups") {
    const bad = IM.items.filter((i) => i.corrupted),
      dups = IM.items.filter((i) => isDup(i, al)),
      near = IM.items.filter((i) => isNear(i, al));
    if (!bad.length && !dups.length && !near.length) h += `<div class="text-sm text-slate-400"><i class="fa-solid fa-circle-check text-emerald-400 mr-1"></i>No duplicates, similar images or corrupted files.</div>`;
    if (bad.length)
      h += sec(`Corrupted (${bad.length})`, "text-amber-400") + bad.slice(0, 12).map((i) => `<div class="flex gap-2 text-[11px] font-mono"><span class="text-gold">${esc(i.path)}</span><span class="text-slate-500 truncate">${esc(i.error)}</span></div>`).join("");
    if (dups.length)
      h += sec(`Duplicates (${dups.length}) - ${IM.opt.dup === "o" ? "tick the ones to delete" : "shown with their first copy"}`, "text-red-400") +
        `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${dups.slice(0, 20).map((i) => {
          const o = by.get(i.dupOf);
          return `<div class="p-2 rounded-xl border border-red-500/30 bg-red-950/10 flex items-center gap-2"><div class="w-16 shrink-0">${thumbHTML(i)}</div><div class="text-[10px] text-slate-400 min-w-0 flex-1"><div class="truncate text-slate-200">${esc(i.name)}</div>is a copy of<div class="truncate text-gold">${esc(o ? o.name : i.dupOf)}</div>${IM.opt.dup === "o" ? `<label class="flex items-center gap-1 mt-1 text-red-300 cursor-pointer"><input type="checkbox" class="accent-[#ef4444]" ${IM.keep.has(i.id) ? "" : "checked"} onchange="this.checked?IM.keep.delete(${i.id}):IM.keep.add(${i.id})"> delete</label>` : ""}</div></div>`;
        }).join("")}</div>${dups.length > 20 ? `<div class="text-[11px] text-slate-500">...and ${dups.length - 20} more</div>` : ""}`;
    if (near.length)
      h += sec(`Similar images (${near.length}) - shown with the picture they look like`, "text-amber-400") +
        `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${near.slice(0, 20).map((i) => {
          const o = by.get(i.nearOf);
          return `<div class="p-2 rounded-xl border border-amber-500/30 bg-amber-950/10 flex items-center gap-2"><div class="w-16 shrink-0">${thumbHTML(i)}</div><div class="text-[10px] text-slate-400 min-w-0 flex-1"><div class="truncate text-slate-200">${esc(i.name)}</div>looks like<div class="truncate text-gold">${esc(o ? o.name : i.nearOf)}</div></div></div>`;
        }).join("")}</div>${near.length > 20 ? `<div class="text-[11px] text-slate-500">...and ${near.length - 20} more</div>` : ""}`;
  } else if (IM.sub === "color") {
    const f = imgInfo(IM.items);
    h += `<div class="grid grid-cols-3 gap-3 text-center">${Object.entries(f.colors).map(([k, v]) => `<div class="p-3 rounded-xl bg-[#080c14] border border-slate-800"><div class="text-2xl font-extrabold text-gold">${v}</div><div class="text-[11px] text-slate-400">${k}</div></div>`).join("")}</div>`;
  } else if (IM.sub === "blur") {
    h += `<div class="text-[11px] text-slate-500">Blur score = variance of the Laplacian (sharp is above ${BLUR_T}, very blurry below ${r1(BLUR_T / 3)}). Blurry and blank images are marked in the view below.</div>`;
  } else if (IM.sub === "size") {
    const f = imgInfo(IM.items),
      fn = icSizeFn(),
      ex = ok[0];
    h += sec(`${f.resolutions.length} different size(s): ${f.resolutions.slice(0, 6).map(([r, n]) => `<span class="chip">${r} <b class="text-gold">${n}</b></span>`).join(" ")}`, "text-slate-300");
    if (fn && ex) {
      const n = ok.filter((i) => fn.skip(i) === false).length;
      h += `<div class="p-3 rounded-xl border border-slate-800 bg-[#080c14] text-xs font-mono text-slate-300"><i class="fa-solid fa-circle-info text-neon mr-1"></i>${n} of ${ok.length} image(s) would change. Example: ${esc(ex.name)}: ${ex.w}x${ex.h}${fn.size ? " -> " + fn.size(ex).join("x") : ""}${fn.note ? " " + fn.note : ""}</div>`;
    }
  } else {
    const cnt = {};
    ok.forEach((i) => (cnt[outExt(i)] = (cnt[outExt(i)] || 0) + 1));
    h += sec(`Saved file formats: ${Object.entries(cnt).map(([k, v]) => `<span class="chip">${k} <b class="text-gold">${v}</b></span>`).join(" ")}`, "text-slate-300");
  }
  // Live Image View: every image with the same highlights as the table preview (modified / corrupted / duplicate).
  const badge = { dups: (i) => (isDup(i, al) ? "duplicate" : isNear(i, al) ? "similar" : i.corrupted ? "corrupted" : ""), color: (i) => i.mode, blur: (i) => (i.sharpened ? "Sharpened " : i.state + " ") + r1(i.blur), size: (i) => `${i.w}x${i.h}`, format: (i) => outExt(i) }[IM.sub],
    list = IM.showAll ? IM.items : IM.items.slice(0, 30),
    changed = IM.items.filter((i) => i.changed).length;
  h += `<div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800"><h3 class="text-lg font-bold text-gold pt-3"><i class="fa-solid fa-eye text-neon mr-2"></i>Live Image View</h3><div class="flex gap-4 text-xs font-mono pt-3"><span class="text-neon"><i class="inline-block w-3 h-3 rounded bg-neon/30 border border-neon align-middle mr-1"></i>Modified</span><span class="text-amber-400"><i class="inline-block w-3 h-3 rounded bg-amber-500/40 border border-amber-400 align-middle mr-1"></i>Corrupted</span><span class="text-red-400"><i class="inline-block w-3 h-3 rounded bg-red-500/30 border border-red-500 align-middle mr-1"></i>Duplicate</span></div></div>`;
  h += `<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">${list.map((it) => {
    const d = isDup(it, al),
      c = it.corrupted ? "ring-amber-500/70 bg-amber-500/10" : d ? "ring-red-500/70 bg-red-500/10" : isNear(it, al) ? "ring-amber-500/50 bg-amber-500/5" : it.changed ? "ring-neon/60 bg-neon/10" : "ring-slate-800 bg-[#080c14]/60",
      bd = it.corrupted ? "corrupted" : badge(it);
    return `<div class="p-1.5 rounded-xl ring-1 ${c} space-y-1 min-w-0"><div class="relative">${thumbHTML(it)}${bd ? `<span class="absolute top-1 left-1 text-[9px] px-1.5 py-0.5 rounded bg-black/75 text-amber-300 font-mono">${esc(bd)}</span>` : ""}</div><div class="text-[10px] text-slate-400 truncate" title="${esc(it.path)}">${esc(it.name)}</div></div>`;
  }).join("")}</div>`;
  h += `<div class="flex items-center justify-between text-xs font-mono text-slate-400"><span>${IM.items.length} images &middot; ${changed} modified</span>${IM.items.length > 30 ? `<button onclick="IM.showAll=!IM.showAll;icView()" class="btn b-dark !py-1">${IM.showAll ? "Show fewer" : `Show all ${IM.items.length}`}</button>` : ""}</div>`;
  $("ic-view").innerHTML = h;
}
// What the chosen size operation would do: {skip(it) -> true when unchanged, size(it) -> [w, h], note}.
function icSizeFn() {
  const { sop: o, a: A, b: B } = IM.opt,
    a = parseFloat(A),
    b = parseFloat(B),
    R = (v) => Math.max(1, Math.round(v));
  if (!(a > 0) || (o === "exact" && !(b > 0))) return null;
  if (o === "bright") return { skip: () => a === 1, note: "(brightness x" + a + ")" };
  const size = (it) =>
    ({
      pct: [it.w * (a / 100), it.h * (a / 100)], width: [a, (it.h * a) / it.w], height: [(it.w * a) / it.h, a], exact: [a, b],
      mp: ((s) => [it.w * s, it.h * s])(Math.sqrt((a * 1e6) / (it.w * it.h))),
    })[o].map(R);
  return { size, skip: (it) => size(it).join() === [it.w, it.h].join() };
}
// Apply fn to every valid image. skip(it) leaves an image untouched; op(px, it) returns {px, mode} or null.
async function icRun(label, skip, op) {
  const list = okItems();
  let n = 0,
    ex = null;
  for (let k = 0; k < list.length; k++) {
    const it = list[k];
    busy(`${label}... ${k + 1} / ${list.length}`);
    if (k % 2) await tick();
    if (skip && skip(it)) continue;
    const before = await getPx(it),
      r = await op(before, it);
    if (!r) continue;
    const b = ex ? null : { name: it.name, b: descr(it), bt: imgThumb(before) };
    Object.assign(it, imgStats(r.px), { px: r.px, changed: true, th: imgThumb(r.px), mode: r.mode || it.mode });
    n++;
    if (b) ex = { ...b, a: descr(it), at: it.th };
  }
  return { n, ex };
}
// Finish a cleaning step: keep the undo snapshot only when something changed.
function icFinish(n, text, ex) {
  busy("");
  if (!n) {
    IM.hist.pop();
    IM.last = { text: "Nothing needed changing.", ex: null };
  } else {
    IM.hist[IM.hist.length - 1].d = text;
    while (IM.hist.length > HIST_IMG_MAX) {
      const o = IM.hist.shift();
      IM.histOld.push({ d: o.d, t: o.t });
    }
    IM.last = { text, ex };
    iLabelsDropped();
  }
  icAll();
}
function icRemove() {
  const al = new Set(IM.items.map((i) => i.path)),
    o = IM.opt,
    rm = new Set();
  IM.items.forEach((i) => {
    if (i.corrupted && o.cor === "d") rm.add(i.id);
    if (isDup(i, al) && (o.dup === "a" || (o.dup === "o" && !IM.keep.has(i.id)))) rm.add(i.id);
    if (isNear(i, al) && o.near === "d") rm.add(i.id);
  });
  isnap("Removed files");
  IM.items = IM.items.filter((i) => !rm.has(i.id));
  icFinish(rm.size, `Removed ${rm.size} file(s) from the cleaned dataset (the originals are not touched)`, null);
}
async function icColor() {
  const k = IM.opt.color,
    nm = { rgb: "RGB", gray: "Grayscale", bgr: "BGR" }[k];
  isnap("Colour mode");
  const r = await icRun(`Converting to ${nm}`, (it) => (k === "rgb" && it.mode === "RGB") || (k === "gray" && it.mode === "Grayscale"), (d) => ({ px: opColor(d, k), mode: k === "gray" ? "Grayscale" : "RGB" }));
  icFinish(r.n, `Converted to ${nm}: ${r.n} image(s) changed`, r.ex);
}
async function icBlur() {
  const o = IM.opt,
    ok = okItems(),
    sel = o.blurry === "s" ? ok.filter((i) => !i.sharpened && (i.state === "Blurry" || i.state === "Very Blurry")) : [],
    rm = new Set();
  if (o.blurry === "d") ok.filter((i) => !i.sharpened && (i.state === "Blurry" || i.state === "Very Blurry")).forEach((i) => rm.add(i.id));
  if (o.blank === "d") ok.filter((i) => i.state === "Blank").forEach((i) => rm.add(i.id));
  const before = sel.map((i) => i.blur);
  isnap("Fixed blurry images");
  IM.items = IM.items.filter((i) => !rm.has(i.id));
  const ids = new Set(sel.map((i) => i.id)),
    r = await icRun("Sharpening", (it) => !ids.has(it.id), (d) => ({ px: opSharpen(d) }));
  sel.forEach((i) => (i.sharpened = true));
  let t = `Deleted ${rm.size} image(s), sharpened ${r.n} image(s)`;
  if (r.n) t += `. Average blur score ${r1(before.reduce((a, b) => a + b, 0) / before.length)} -> ${r1(sel.reduce((a, i) => a + i.blur, 0) / sel.length)} (higher = sharper)`;
  icFinish(r.n + rm.size, t, r.ex);
}
async function icSize() {
  const fn = icSizeFn(),
    o = IM.opt;
  if (!fn) return alert("Type a number bigger than 0 first.");
  const lbl = { pct: `Resized to ${o.a}%`, width: `Resized to width ${o.a}`, height: `Resized to height ${o.a}`, exact: `Resized to ${o.a}x${o.b}`, mp: `Changed to ~${o.a} MP`, bright: `Brightness x${o.a}` }[o.sop];
  isnap(lbl);
  const r = await icRun(lbl, (it) => fn.skip(it), (d, it) => {
    if (o.sop === "bright") return { px: opBright(d, parseFloat(o.a)) };
    const [w, h] = fn.size(it);
    return { px: opResize(d, w, h) };
  });
  icFinish(r.n, `${lbl}: ${r.n} image(s) changed`, r.ex);
}
function icFormat() {
  const e = IM.opt.fmt;
  isnap("File format");
  let n = 0;
  IM.items.forEach((it) => {
    const cur = outExt(it);
    if (it.corrupted || IMG_FMT[cur] === IMG_FMT[e]) return; // already that format (.jpg = .jpeg, .tif = .tiff)
    it.newExt = e;
    it.changed = true;
    n++;
  });
  icFinish(n, `${n} image(s) will be saved as ${e}`, null);
}
async function icExport() {
  const used = new Set();
  await zipDownload(
    IM.items.map((it) => {
      const name = uniqueName(used, it.rel, stem(it.name), outExt(it));
      return { path: (it.rel ? it.rel + "/" : "") + name, item: it, force: false };
    }),
    "cleaned_dataset.zip",
  );
}

/* ============================================================
   Tab 3: Label (Module seven) - the labeling window of the Python version, inside the page
   ============================================================ */
function ilAdd() {
  const L = IM.lab;
  L.err = "";
  $("il-in").value.split(",").map((s) => s.trim()).filter(Boolean).forEach((n) => {
    if (/[\\/:*?"<>|]/.test(n)) L.err = 'Avoid these characters in a label name: \\ / : * ? " < > |';
    else if (L.names.some((x) => x.toLowerCase() === n.toLowerCase())) L.err = `"${n}" is already used.`;
    else L.names.push(n);
  });
  ilRender();
  $("il-in").focus();
}
// "What You Will Get": the folder layout of the downloaded labeled dataset for the chosen labeling type and label names.
function ilPreview(L) {
  const nm = L.names.length ? L.names : ["label_1", "label_2"],
    tree = (rows) => {
      const w = Math.max(...rows.map((r) => r[0].length));
      return "labeled_dataset/\n" + rows.map(([a, b], i) => (i === rows.length - 1 ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ") + (b ? a.padEnd(w + 3) + "(" + b + ")" : a)).join("\n");
    },
    P = {
      folder: ["One label per image - folder format", () => nm.slice(0, 6).map((n) => [n + "/", `the images you label as ${n}`]).concat(nm.length > 6 ? [["...", `${nm.length - 6} more label folders`]] : [])],
      cls: ["One label per image - YOLO classification", () => [["images/", "all the images you label"], ["classes.txt", "one label name per line"], ["label_mapping.py", "image name -> label number"]]],
      det: ["Many boxes per image - YOLO object detection", () => [["images/", "the images you draw boxes on"], ["labels/", "one .txt per image: class x_center y_center width height"], ["data.yaml", "the file YOLO trains from"], ["classes.txt", "one label name per line"]]],
    }[L.kind];
  return `<div class="card space-y-4"><div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-lg font-bold text-gold"><i class="fa-solid fa-eye text-neon mr-2"></i>What You Will Get</h3><span class="text-xs font-mono text-slate-400">${P[0]}</span></div><pre class="bg-[#080c14] border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">${esc(tree(P[1]()))}</pre></div>`;
}
function ilRender() {
  const L = IM.lab;
  if (L.active) {
    ilBuild();
    return ilShow();
  }
  const ok = okItems(),
    bad = IM.items.length - ok.length,
    kinds = { folder: ["fa-folder-tree", "Folder format", "One sub-folder per label: Cat/, Dog/ ..."], cls: ["fa-list-ol", "YOLO classification", "images/ + classes.txt + label_mapping.py"], det: ["fa-vector-square", "YOLO object detection", "Draw many boxes inside each image"] };
  let h = "";
  if (IM.lbDropped && !IM.LB) h += `<div class="card !py-3 border-amber-500/30 text-sm text-amber-300"><i class="fa-solid fa-triangle-exclamation mr-2"></i>Your labels were cleared because the images changed (box positions would no longer match). Label again after cleaning.</div>`;
  if (L.err) h += `<div class="card !py-3 border-amber-500/30 text-sm text-amber-300">${esc(L.err)}</div>`;
  if (IM.LB) {
    const B = IM.LB,
      c = lbCounts(B, { fr: [1, 0, 0], parts: { train: B.entries } }).train,
      struct = { folder: Object.values(B.names).map((n) => n + "/").join(" ") + " (one sub-folder per label)", cls: "images/ + classes.txt + label_mapping.py", det: "images/ + labels/ (one .txt per image: class x_center y_center width height, 0 to 1) + data.yaml + classes.txt" }[B.kind];
    h += `<div class="card space-y-3 border-emerald-500/30"><h3 class="font-bold text-emerald-400"><i class="fa-solid fa-circle-check mr-2"></i>Labeled dataset ready</h3><div class="text-xs font-mono text-slate-300 space-y-1"><div>${LB_KINDS[B.kind]}</div><div class="text-slate-400">Structure: ${esc(struct)}</div><div>${B.entries.length} image(s) saved${B.kind === "det" ? `, ${c.boxes} box(es)` : ""}. Left out (skipped or not reached): ${B.left}.</div>${B.kind === "det" ? "" : Object.entries(c.per).map(([k, v]) => `<span class="chip">${esc(k)} <b class="text-gold">${v}</b></span>`).join(" ")}</div><div class="flex flex-wrap gap-3"><button onclick="zipDownload(lbFiles(IM.LB,null),'labeled_dataset.zip')" class="btn b-blue"><i class="fa-solid fa-file-zipper mr-1"></i> Download labeled dataset (ZIP)</button>${B.kind === "det" ? `<button onclick="zipDownload(lbCoco(IM.LB,null),'labeled_dataset_coco.zip')" class="btn b-dark"><i class="fa-solid fa-file-code mr-1"></i> Download as COCO (ZIP)</button>` : ""}<button onclick="igo('isplit')" class="btn b-gold">Continue to Split &amp; Export <i class="fa-solid fa-arrow-right ml-1"></i></button></div></div>`;
  }
  h += `<div class="card space-y-5"><div class="border-b border-slate-800 pb-3"><h2 class="text-xl font-bold text-gold"><i class="fa-solid fa-tags text-neon mr-2"></i>Label Images</h2><p class="text-xs text-slate-400">Labels the images as they are now (cleaned and resized). Corrupted images are left out.</p></div>` +
    `<div class="grid grid-cols-1 lg:grid-cols-12 gap-6"><div class="lg:col-span-5 space-y-3"><div class="text-xs font-mono uppercase tracking-wider text-slate-400">1. Labeling type</div>${Object.entries(kinds).map(([k, [ic, t, d]]) => `<div onclick="IM.lab.kind='${k}';ilRender()" class="rc flex items-start gap-3 ${L.kind === k ? "on" : ""}"><i class="fa-solid ${L.kind === k ? "fa-circle-dot text-gold" : "fa-circle text-slate-600"} mt-0.5 text-sm"></i><div><div class="text-sm font-bold text-slate-200"><i class="fa-solid ${ic} text-gold mr-2"></i>${t}</div><div class="text-[11px] text-slate-400">${d}</div></div></div>`).join("")}</div>` +
    `<div class="lg:col-span-7 space-y-3 text-xs font-mono"><div class="uppercase tracking-wider text-slate-400">2. Label names</div><div class="flex gap-2"><input id="il-in" class="in" placeholder="Type a name and press Enter, or use commas: Cat, Dog" onkeydown="if(event.key==='Enter'){event.preventDefault();ilAdd()}"><button onclick="ilAdd()" class="btn b-dark whitespace-nowrap"><i class="fa-solid fa-plus mr-1"></i> Add</button></div>` +
    `<div class="flex flex-wrap content-start gap-2 p-4 rounded-xl bg-[#080c14] border border-slate-800 min-h-[5rem]">${L.names.map((n, i) => `<span class="chip"><b class="text-gold">${i + 1}</b> ${esc(n)}<button onclick="IM.lab.names.splice(${i},1);ilRender()" class="text-red-400 ml-1" title="Remove">&times;</button></span>`).join("") || '<span class="text-slate-500">No labels yet. Add at least one.</span>'}</div>` +
    `<button onclick="ilStart()" class="btn b-gold w-full !py-2.5" ${ok.length && L.names.length ? "" : "disabled"}><i class="fa-solid fa-play mr-1"></i> Start labeling</button></div></div></div>`;
  h += ilPreview(L);
  $("il-root").innerHTML = h;
}
function ilStart() {
  const L = IM.lab,
    items = okItems();
  if (!items.length || !L.names.length) return;
  Object.assign(L, { active: true, items, i: 0, answers: new Map(), boxes: new Map(items.map((i) => [i.id, []])), done: new Set(), cls: 0, tok: 0, nm: [...L.names], err: "" });
  ilRender();
}
// Build the labeling screen (image canvas, class buttons, actions) and wire the mouse / touch drawing.
// The zoom controls shown next to the picture when drawing boxes (YOLO object detection).
const IL_ZOOM_HTML = `<div class="p-3 rounded-xl bg-[#080c14] border border-slate-800 space-y-2"><div class="flex items-center justify-between"><span class="text-slate-400">Zoom</span><b id="il-zoom" class="text-gold">100%</b></div><div class="grid grid-cols-4 gap-2"><button onclick="ilZoom(1/1.5)" class="btn b-dark" title="Zoom out (-)" aria-label="Zoom out"><i class="fa-solid fa-magnifying-glass-minus"></i></button><button onclick="ilZoom(1.5)" class="btn b-dark" title="Zoom in (+)" aria-label="Zoom in"><i class="fa-solid fa-magnifying-glass-plus"></i></button><button onclick="ilFit()" class="btn b-dark" title="Fit the whole picture (0)" aria-label="Fit the whole picture"><i class="fa-solid fa-expand"></i></button><button id="il-pan" onclick="ilPanMode()" class="btn b-dark" title="Move the picture: drag to pan (or hold Space and drag)" aria-label="Move the picture"><i class="fa-solid fa-hand"></i></button></div><div id="il-xy" class="text-[11px] text-slate-500 min-h-[1rem]">Scroll over the picture to zoom.</div></div>`;
function ilBuild() {
  const L = IM.lab,
    det = L.kind === "det",
    b = (t, f, c) => `<button onclick="${f}" class="btn ${c || "b-dark"}">${t}</button>`;
  $("il-root").innerHTML =
    `<div class="card space-y-4"><div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3"><div class="min-w-0"><h2 class="text-xl font-bold text-gold"><i class="fa-solid fa-tags text-neon mr-2"></i>${det ? "Draw boxes" : "Pick a label"} for each image</h2><p id="il-file" class="text-xs text-slate-400 font-mono truncate"></p></div>${b('<i class="fa-solid fa-floppy-disk mr-1"></i> Finish &amp; save', "ilFinish()", "b-blue")}</div>` +
    `<div class="h-1.5 rounded bg-slate-800"><div id="il-bar" class="h-1.5 rounded bg-gold transition-all" style="width:0"></div></div>` +
    `<div class="grid grid-cols-1 lg:grid-cols-12 gap-5"><div id="il-wrap" class="lg:col-span-8 flex items-center justify-center bg-[#080c14]/90 rounded-2xl border border-slate-800 p-3 min-h-[300px]"><canvas id="il-cv" style="touch-action:none;max-width:100%;cursor:${det ? "crosshair" : "default"}"></canvas></div>` +
    `<div class="lg:col-span-4 space-y-4 text-xs font-mono"><div class="p-3 rounded-xl bg-[#080c14] border border-slate-800 space-y-1"><div id="il-pos" class="text-gold font-bold text-sm"></div><div id="il-cur" class="text-slate-200"></div><div id="il-stat" class="text-slate-500"></div></div>${det ? IL_ZOOM_HTML : ""}` +
    `<div><div class="lbl">${det ? "Class to draw" : "Label (click or press the number)"}</div><div id="il-cls" class="grid grid-cols-1 gap-2"></div></div>` +
    `<div class="grid grid-cols-2 gap-2">${b('<i class="fa-solid fa-arrow-left mr-1"></i> Back', "ilGo(-1)")}${b("Skip image", "ilSkip()")}${det ? b('<i class="fa-solid fa-rotate-left mr-1"></i> Undo box', "ilUndo()") + b("Clear boxes", "ilClear()") + b('Next &amp; save <i class="fa-solid fa-arrow-right ml-1"></i>', "ilAccept()", "b-gold col-span-2") : ""}</div>` +
    `<p class="text-[11px] text-slate-500">${det ? "Drag on the image to draw a box. Scroll (or press + and -) to zoom in for exact corners, then hold Space and drag, or tap the hand, to move around. 0 shows the whole picture. Keys 1-9 pick the class, Enter = next &amp; save, Backspace = undo box. Only images accepted with Next are saved (no boxes = background image)." : "Keys 1-9 pick a label, the left arrow goes back. Skipped and unlabeled images are not saved."}</p></div></div></div>`;
  const cv = $("il-cv"),
    at = (e) => {
      const r = cv.getBoundingClientRect();
      return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height]; // canvas position
    };
  cv.onpointerdown = (e) => {
    if (!L.src) return;
    if (L.pan || L.space || e.button === 1) {
      // move the picture instead of drawing
      cv.setPointerCapture(e.pointerId);
      L.panning = { x: e.clientX, y: e.clientY, vx: L.vx, vy: L.vy };
      ilCursor();
      return e.preventDefault();
    }
    if (!det || e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    const [x, y] = ilReal(L, ...at(e));
    L.drag = [x, y, x, y];
  };
  cv.onpointermove = (e) => {
    const [cx, cy] = at(e);
    L.mx = cx;
    L.my = cy;
    if (L.panning) {
      const r = cv.getBoundingClientRect(),
        k = cv.width / r.width / (L.sc * L.z);
      L.vx = L.panning.vx - (e.clientX - L.panning.x) * k;
      L.vy = L.panning.vy - (e.clientY - L.panning.y) * k;
      ilClamp(L);
    } else if (L.drag) [L.drag[2], L.drag[3]] = ilReal(L, cx, cy);
    if (det && L.src && $("il-xy")) {
      const [rx, ry] = ilReal(L, cx, cy);
      $("il-xy").textContent = `x ${Math.round(rx)}, y ${Math.round(ry)} px (picture is ${L.w} x ${L.h})`;
    }
    ilDraw();
  };
  cv.onpointerup = (e) => {
    if (L.panning) {
      L.panning = null;
      return ilCursor();
    }
    if (!L.drag) return;
    [L.drag[2], L.drag[3]] = ilReal(L, ...at(e));
    const [x0, y0, x1, y1] = L.drag,
      s = L.sc * L.z;
    L.drag = null;
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    if ((xb - xa) * s >= 4 && (yb - ya) * s >= 4) L.boxes.get(L.items[L.i].id).push([L.cls, xa, ya, xb, yb]); // boxes are kept in real picture pixels
    ilDraw();
    ilInfo();
  };
  cv.onpointercancel = () => {
    L.drag = L.panning = null;
    ilCursor();
    ilDraw();
  };
  cv.onpointerleave = () => {
    L.mx = null;
    ilDraw();
  };
  if (det)
    cv.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault(); // zoom the picture, not the page
        const [cx, cy] = at(e);
        ilZoom(Math.exp(-(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) * 0.0015), cx, cy);
      },
      { passive: false },
    );
}
const ILZMAX = 20; // largest zoom (20 = 2000%)
// Canvas position -> real picture pixel for the current zoom (L.z) and view corner (L.vx, L.vy), kept inside the picture.
function ilReal(L, cx, cy) {
  const s = L.sc * L.z;
  return [Math.min(L.w, Math.max(0, L.vx + cx / s)), Math.min(L.h, Math.max(0, L.vy + cy / s))];
}
// Keep the visible part of the picture inside the picture.
function ilClamp(L) {
  L.vx = Math.min(Math.max(0, L.vx), L.w - L.w / L.z);
  L.vy = Math.min(Math.max(0, L.vy), L.h - L.h / L.z);
}
function ilZoomUI() {
  const L = IM.lab;
  if ($("il-zoom")) $("il-zoom").textContent = Math.round(L.z * 100) + "%";
  if ($("il-pan")) $("il-pan").className = "btn " + (L.pan ? "b-gold" : "b-dark");
}
function ilCursor() {
  const L = IM.lab,
    cv = $("il-cv");
  if (cv) cv.style.cursor = L.panning ? "grabbing" : L.pan || L.space ? "grab" : L.kind === "det" ? "crosshair" : "default";
}
// Zoom by the factor f and keep the spot under (cx, cy) - a canvas position, default the middle - where it is.
function ilZoom(f, cx, cy) {
  const L = IM.lab,
    cv = $("il-cv");
  if (!L.src) return;
  if (cx == null) [cx, cy] = [cv.width / 2, cv.height / 2];
  const [px, py] = ilReal(L, cx, cy);
  L.z = Math.min(ILZMAX, Math.max(1, L.z * f));
  L.vx = px - cx / (L.sc * L.z);
  L.vy = py - cy / (L.sc * L.z);
  ilClamp(L);
  ilZoomUI();
  ilDraw();
}
function ilFit() {
  const L = IM.lab;
  L.z = 1;
  L.vx = L.vy = 0;
  ilZoomUI();
  ilDraw();
}
function ilPanMode() {
  IM.lab.pan = !IM.lab.pan;
  ilZoomUI();
  ilCursor();
}
async function ilShow() {
  const L = IM.lab,
    tok = ++L.tok;
  if (L.i >= L.items.length) return ilFinish();
  const d = await getPx(L.items[L.i]);
  if (tok !== L.tok) return; // a newer image was requested meanwhile
  L.src = px2canvas(d);
  L.sc = Math.min(Math.min(900, $("il-wrap").clientWidth - 24 || 900) / d.width, 520 / d.height, 4);
  const cv = $("il-cv");
  cv.width = Math.max(1, Math.round(d.width * L.sc));
  cv.height = Math.max(1, Math.round(d.height * L.sc));
  Object.assign(L, { w: d.width, h: d.height, z: 1, vx: 0, vy: 0, drag: null, panning: null, mx: null }); // every picture starts fully visible
  ilZoomUI();
  ilCursor();
  ilDraw();
  ilInfo();
}
function ilDraw() {
  const L = IM.lab,
    cv = $("il-cv");
  if (!cv || !L.src) return;
  const s = L.sc * (L.z || 1),
    vx = L.vx || 0,
    vy = L.vy || 0,
    x = cv.getContext("2d");
  x.imageSmoothingEnabled = s < 3; // zoomed far in: show the real pixels, not a blur
  x.imageSmoothingQuality = "high";
  x.drawImage(L.src, vx, vy, cv.width / s, cv.height / s, 0, 0, cv.width, cv.height); // only the visible part of the picture
  if (L.kind !== "det") return;
  L.boxes.get(L.items[L.i].id).forEach(([c, x1, y1, x2, y2]) => {
    x.strokeStyle = x.fillStyle = ICOL[c % ICOL.length];
    x.lineWidth = 2;
    x.strokeRect((x1 - vx) * s, (y1 - vy) * s, (x2 - x1) * s, (y2 - y1) * s);
    x.font = "bold 12px Inter,sans-serif";
    x.textBaseline = "top";
    x.shadowColor = "#000";
    x.shadowBlur = 3;
    x.fillText(L.nm[c], (x1 - vx) * s + 4, (y1 - vy) * s + 3);
    x.shadowBlur = 0;
  });
  if (L.drag) {
    x.setLineDash([5, 3]);
    x.strokeStyle = ICOL[L.cls % ICOL.length];
    x.lineWidth = 2;
    x.strokeRect((L.drag[0] - vx) * s, (L.drag[1] - vy) * s, (L.drag[2] - L.drag[0]) * s, (L.drag[3] - L.drag[1]) * s);
    x.setLineDash([]);
  }
  if (L.mx != null && !L.panning && !L.pan && !L.space) {
    // thin guide lines through the pointer help to place the corners exactly
    x.save();
    x.strokeStyle = "rgba(255,255,255,0.55)";
    x.lineWidth = 1;
    x.setLineDash([4, 4]);
    x.beginPath();
    x.moveTo(Math.round(L.mx) + 0.5, 0);
    x.lineTo(Math.round(L.mx) + 0.5, cv.height);
    x.moveTo(0, Math.round(L.my) + 0.5);
    x.lineTo(cv.width, Math.round(L.my) + 0.5);
    x.stroke();
    x.restore();
  }
}
function ilInfo() {
  const L = IM.lab,
    it = L.items[L.i];
  if (!it || !$("il-pos")) return;
  const det = L.kind === "det",
    nb = det ? L.boxes.get(it.id).length : 0;
  $("il-file").textContent = it.path;
  $("il-pos").textContent = `Image ${L.i + 1} / ${L.items.length}`;
  $("il-cur").textContent = det ? `${nb} box(es) | ${L.done.has(it.id) ? "accepted" : "not accepted yet"}` : `Label: ${L.answers.has(it.id) ? L.nm[L.answers.get(it.id)] : "not labeled yet"}`;
  $("il-stat").textContent = `${det ? L.done.size : L.answers.size} of ${L.items.length} ${det ? "accepted" : "labeled"} so far`;
  $("il-bar").style.width = (L.i / L.items.length) * 100 + "%";
  $("il-cls").innerHTML = L.nm
    .map((n, k) => {
      const on = det ? L.cls === k : L.answers.get(it.id) === k,
        c = ICOL[k % ICOL.length];
      return `<button onclick="ilPick(${k})" class="btn b-dark text-left flex items-center gap-2" style="border-color:${on ? c : "#334155"};${on ? `background:${c}33;` : ""}"><span class="px-1.5 rounded bg-black/40 text-[10px]" style="color:${c}">${k + 1}</span><span class="truncate">${esc(n)}</span>${on ? '<i class="fa-solid fa-check ml-auto"></i>' : ""}</button>`;
    })
    .join("");
}
function ilPick(k) {
  const L = IM.lab;
  if (L.kind === "det") {
    L.cls = k;
    return ilInfo();
  }
  L.answers.set(L.items[L.i].id, k);
  ilGo(1);
}
function ilGo(s) {
  IM.lab.i = Math.max(0, IM.lab.i + s);
  ilShow();
}
function ilSkip() {
  const L = IM.lab,
    id = L.items[L.i].id;
  L.answers.delete(id);
  L.done.delete(id);
  L.boxes.set(id, []);
  ilGo(1);
}
function ilAccept() {
  IM.lab.done.add(IM.lab.items[IM.lab.i].id);
  ilGo(1);
}
function ilUndo() {
  const L = IM.lab;
  L.boxes.get(L.items[L.i].id).pop();
  ilDraw();
  ilInfo();
}
function ilClear() {
  const L = IM.lab;
  L.boxes.set(L.items[L.i].id, []);
  ilDraw();
  ilInfo();
}
// Close the labeling screen and build the labeled dataset (only labeled / accepted images are kept).
function ilFinish() {
  const L = IM.lab,
    det = L.kind === "det",
    names = Object.fromEntries(L.nm.map((n, i) => [i, n])),
    used = new Set(),
    entries = [];
  L.items.forEach((it) => {
    if (det ? !L.done.has(it.id) : !L.answers.has(it.id)) return;
    const label = det ? null : L.answers.get(it.id),
      e = { item: it, w: it.w, h: it.h, name: uniqueName(used, L.kind === "folder" ? names[label] : "images", stem(it.name), outExt(it)) };
    if (det) e.boxes = L.boxes.get(it.id).map((b) => [...b]);
    else e.label = label;
    entries.push(e);
  });
  L.active = false;
  IM.split = null;
  IM.lbDropped = false;
  if (entries.length) {
    IM.LB = { kind: L.kind, names, entries, left: L.items.length - entries.length };
    L.err = "";
  } else {
    IM.LB = null;
    L.err = "No image was labeled, so nothing was saved.";
  }
  ilRender();
}

/* ============================================================
   Tab 4: Split & export (Module eight)
   ============================================================ */
// What to split: the dataset labeled in the Label tab, or - if the uploaded folder has one sub-folder per label - those folders.
function isSource() {
  if (IM.LB) return { LB: IM.LB, from: `the dataset labeled in the Label tab (${LB_KINDS[IM.LB.kind]})` };
  const g = {};
  okItems().forEach((i) => {
    const f = i.rel.split("/")[0];
    if (f) (g[f] = g[f] || []).push(i);
  });
  const keys = Object.keys(g).sort();
  if (keys.length < 2) return null;
  const names = {},
    entries = [],
    used = new Set();
  keys.forEach((k, idx) => {
    names[idx] = k;
    g[k].forEach((it) => entries.push({ item: it, label: idx, name: uniqueName(used, k, stem(it.name), outExt(it)) }));
  });
  const skipped = okItems().length - entries.length;
  return { LB: { kind: "folder", names, entries }, from: `the sub-folders of your upload (${keys.length} labels: ${keys.join(", ")})${skipped ? `. ${skipped} image(s) outside the sub-folders are ignored` : ""}` };
}
function isInit() {
  const first = !$("is-sliders").children.length;
  if (first)
    $("is-sliders").innerHTML = ISP.map(
      ([k, l, , t, , , v, mn, mx]) =>
        `<div><div class="flex justify-between mb-1 font-bold ${t}"><span>${l} Set Ratio</span><span id="i-${k}-l">${v}%</span></div><input type="range" id="i-${k}-r" min="${mn}" max="${mx}" step="5" value="${v}" oninput="isRatios('${k}')"></div>`,
    ).join("");
  isRun();
}
// Keep the three ratios adding up to 100 when one slider moves (same rule as the table splitter).
function isRatios(ch) {
  let tr = +$("i-train-r").value,
    va = +$("i-valid-r").value,
    te = +$("i-test-r").value;
  if (ch === "train") {
    const m = 100 - tr;
    va = Math.min(50, r5(m / 2));
    te = m - va;
  } else if (ch === "valid") {
    const m = 100 - va;
    tr = r5(m * 0.8);
    te = m - tr;
  } else {
    const m = 100 - te;
    tr = r5(m * 0.8);
    va = m - tr;
  }
  [["train", tr], ["valid", va], ["test", te]].forEach(([k, v]) => {
    $(`i-${k}-r`).value = v;
    $(`i-${k}-l`).textContent = v + "%";
  });
  $("is-tot").textContent = tr + va + te + "%";
  isRun();
}
// One ZIP per split (train, valid, test): smaller files, so the browser needs less memory at a time.
async function isZipEach() {
  for (const s of SPN) {
    const list = IM.split.parts[s];
    if (list.length) await zipDownload(lbFiles({ ...IM.splitLB, entries: list }, null), `${s}_dataset.zip`);
  }
}
function isRun() {
  const S = isSource();
  $("is-empty").classList.toggle("hidden", !!S);
  $("is-main").classList.toggle("hidden", !S);
  if (!S) return;
  $("is-coco").classList.toggle("hidden", S.LB.kind !== "det");
  ISP.forEach(([k, , c]) => {
    const e = $(`i-${k}-r`),
      p = ((e.value - e.min) / (e.max - e.min)) * 100;
    e.style.background = `linear-gradient(to right,${c} ${p}%,#1e293b ${p}%)`;
  });
  const fr = ISP.map(([k]) => +$(`i-${k}-r`).value / 100);
  IM.splitLB = S.LB;
  IM.split = lbSplit(S.LB, fr, Math.floor(+$("is-seed").value) || 0);
  const c = lbCounts(S.LB, IM.split),
    det = S.LB.kind === "det",
    labels = Object.values(S.LB.names);
  $("is-src").innerHTML = `Splitting ${S.LB.entries.length} images from ${esc(S.from)}. ${det ? "Images are shuffled randomly and each .txt label file moves with its image." : "Each label is split on its own, so every split contains every label."}`;
  $("is-cards").innerHTML = ISP.map(([k, l, col, t, b, ic], i) => {
    const n = IM.split.parts[k].length;
    return `<div class="card text-center space-y-2" style="border-color:${col}66"><div class="w-12 h-12 mx-auto rounded-xl flex items-center justify-center text-xl ${t}" style="background:${col}33"><i class="fa-solid ${ic}"></i></div><h4 class="font-bold ${t}">${l} Subset</h4><div class="text-2xl font-mono font-extrabold">${fr[i] > 0 ? n + " images" : "not used"}</div></div>`;
  }).join("");
  $("is-th").innerHTML = `<tr><th>Split</th><th>Images</th>${det ? "<th>Boxes</th>" : labels.map((n) => `<th>${esc(n)}</th>`).join("")}</tr>`;
  $("is-tb").innerHTML = ISP.map(([k, l, , t], i) => {
    const o = c[k];
    return `<tr><td class="font-bold ${t}">${l}</td>${o ? `<td>${o.images}</td>${det ? `<td>${o.boxes}</td>` : labels.map((n) => `<td>${o.per[n]}</td>`).join("")}` : `<td colspan="${det ? 2 : labels.length + 1}" class="text-slate-500">not used (0%)</td>`}</tr>`;
  }).join("");
  if (IM.ch.split) IM.ch.split.destroy();
  const d = ISP.map(([k]) => IM.split.parts[k].length),
    n = d[0] + d[1] + d[2] || 1,
    cl = ISP.map((s) => s[2]);
  IM.ch.split = new Chart($("is-chart"), {
    type: "doughnut",
    data: { labels: ISP.map((s) => s[1]), datasets: [{ data: d, backgroundColor: cl, borderWidth: 2, borderColor: "#0f172a" }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: { legend: { position: window.innerWidth < 640 ? "bottom" : "right", labels: { color: "#e2e8f0", usePointStyle: true, generateLabels: () => ISP.map((s, i) => ({ text: `${s[1]}: ${d[i]} images (${Math.round((d[i] / n) * 100)}%)`, fillStyle: cl[i], strokeStyle: cl[i], fontColor: "#e2e8f0", pointStyle: "circle", index: i })) } } },
    },
  });
}

/* ============================================================
   Page markup (built once) and keyboard shortcuts
   ============================================================ */
function imgBuild() {
  const chart = (id) => `<div class="bg-[#080c14]/90 rounded-xl border border-slate-800 p-2 h-60"><canvas id="${id}"></canvas></div>`;
  $("app-img").innerHTML = `
    <div id="ib" class="hidden fixed inset-0 z-[60] bg-[#080c14]/85 flex items-center justify-center"><div class="card flex items-center gap-3"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-neon"></i><span id="ib-t" class="text-sm font-mono"></span></div></div>

    <section id="p-iinfo" class="space-y-5">
      <div id="ii-meta" class="card !py-3 flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono text-slate-300"></div>
      <div id="ii-cards" class="grid grid-cols-2 lg:grid-cols-4 gap-4"></div>
      <div id="ii-issues" class="card !py-4"><div class="flex items-start gap-3"><i id="ii-ic"></i><p id="ii-tx" class="text-sm"></p></div><button id="ii-btn" onclick="igo('iclean')" class="btn b-gold whitespace-nowrap">Fix in Clean &amp; Process <i class="fa-solid fa-arrow-right ml-1"></i></button></div>
      <div class="card space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-bold text-gold"><i class="fa-solid fa-chart-column text-neon mr-2"></i>Dataset Health Dashboard</h3><p class="text-xs text-slate-400">File health, colour modes, sharpness and what lowers the score</p></div>
          <div class="flex gap-2"><button onclick="iDashPNG()" class="btn b-dark"><i class="fa-solid fa-image mr-1"></i> Dashboard PNG</button><button onclick="iCSV()" class="btn b-blue"><i class="fa-solid fa-file-csv mr-1"></i> Image table CSV</button></div></div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${chart("ch-files")}${chart("ch-color")}${chart("ch-blur")}${chart("ch-pen")}</div>
      </div>
      <div class="card space-y-3">
        <h3 class="font-bold text-gold"><i class="fa-solid fa-list-check text-neon mr-2"></i>Detailed Feature Breakdown</h3>
        <div class="overflow-x-auto"><table><thead><tr><th>Feature</th><th>Min</th><th>Max</th><th>Mean</th><th>Median</th></tr></thead><tbody id="ii-det"></tbody></table></div>
        <div id="ii-extra" class="text-xs font-mono space-y-2"></div>
        <p class="text-[11px] text-slate-500">Colour mode is read from the pixels: Grayscale means every pixel has R = G = B, RGBA means some transparency. BGR cannot be detected from files.</p>
      </div>
      <div class="card space-y-3">
        <div class="flex flex-wrap justify-between gap-2"><h3 class="font-bold text-gold"><i class="fa-solid fa-table text-neon mr-2"></i>All Images</h3><div class="flex gap-4 text-xs font-mono"><span class="text-red-400"><i class="inline-block w-3 h-3 rounded bg-red-500/30 border border-red-500 align-middle mr-1"></i>Duplicate</span><span class="text-amber-400"><i class="inline-block w-3 h-3 rounded bg-amber-500/40 border border-amber-400 align-middle mr-1"></i>Corrupted</span></div></div>
        <div class="flex flex-wrap items-center justify-between gap-3"><input id="it-q" oninput="IM.page=1;iTable()" placeholder="Search file name..." class="in !w-64"><div id="it-f" class="flex flex-wrap gap-1.5 text-xs font-mono">${IFILT.map(([k, l]) => `<button data-f="${k}" onclick="IM.filter='${k}';IM.page=1;iTable()" class="btn b-dark !py-1 !px-3 font-mono">${l}</button>`).join("")}</div><span id="it-info" class="text-xs font-mono text-slate-400"></span></div>
        <div class="overflow-x-auto border border-slate-800 rounded-xl"><table><thead><tr><th>Preview</th><th>#</th><th>File</th><th>Size px</th><th>Mode</th><th>Bright.</th><th>Blur</th><th>Format</th><th>KB</th><th>Status</th></tr></thead><tbody id="it-b"></tbody></table></div>
        <div class="flex items-center justify-between"><span id="it-pg" class="text-xs font-mono text-slate-400"></span><div class="flex gap-2"><button id="it-p" onclick="IM.page--;iTable()" class="btn b-dark">Prev</button><button id="it-n" onclick="IM.page++;iTable()" class="btn b-dark">Next</button></div></div>
      </div>
    </section>

    <section id="p-iclean" class="hidden space-y-5">
      <div class="card space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div class="flex-1 min-w-[16rem]"><h2 class="text-xl font-bold text-gold"><i class="fa-solid fa-wand-magic-sparkles text-neon mr-2"></i>Image Cleaning &amp; Preprocessing</h2><p class="text-xs text-slate-400">Remove bad files, fix blur, resize and convert. Originals are never changed. Every step can be undone.</p></div>
          <div class="flex flex-wrap gap-3"><button id="ic-undo" onclick="iundo()" class="btn b-dark font-mono !text-neon"><i class="fa-solid fa-rotate-left mr-1"></i> Undo Last Step</button><button onclick="icExport()" class="btn b-blue"><i class="fa-solid fa-file-zipper mr-1"></i> Export Cleaned Images (ZIP)</button></div>
        </div>
        <div class="bg-[#080c14]/80 p-3 rounded-xl border border-slate-800"><div class="flex justify-between text-xs font-mono mb-2"><span class="text-gold font-bold"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Change History (<span id="ic-n">0</span> steps)</span><span class="flex gap-4"><button onclick="iLog()" class="text-gold hover:underline">Download log</button><button onclick="irevert()" class="text-red-500 hover:underline">Revert All to Original</button></span></div><div id="ic-log" class="max-h-24 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-400"></div></div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div class="lg:col-span-5 card !p-4 space-y-4 lg:sticky lg:top-24 self-start"><div id="ic-subs" class="flex flex-wrap gap-1.5"></div><div id="ic-pane" class="space-y-4"></div></div>
        <div id="ic-view" class="lg:col-span-7 card space-y-4"></div>
      </div>
    </section>

    <section id="p-ilabel" class="hidden space-y-5"><div id="il-root" class="space-y-5"></div></section>

    <section id="p-isplit" class="hidden space-y-5">
      <div id="is-empty" class="card hidden space-y-3"><h2 class="text-xl font-bold text-gold"><i class="fa-solid fa-arrows-split-up-and-left text-neon mr-2"></i>Nothing to split yet</h2><p class="text-sm text-slate-300">The splitter needs a labeled dataset. Label your images in the Label tab, or upload a folder that already has one sub-folder per label (Cat/, Dog/ ...).</p><button onclick="igo('ilabel')" class="btn b-gold">Go to Label <i class="fa-solid fa-arrow-right ml-1"></i></button></div>
      <div id="is-main" class="space-y-5">
        <div class="card space-y-4">
          <div><h2 class="text-xl font-bold text-gold"><i class="fa-solid fa-arrows-split-up-and-left text-neon mr-2"></i>Train / Validation / Test Splitter</h2><p id="is-src" class="text-xs text-slate-400"></p></div>
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
            <div class="lg:col-span-5 space-y-4 text-xs font-mono">
              <div id="is-sliders" class="space-y-4 bg-[#080c14] p-4 rounded-xl border border-slate-800"></div>
              <div class="text-right text-[11px] text-slate-400">Total: <b id="is-tot" class="text-emerald-400">100%</b></div>
              <div class="flex items-end gap-2"><div class="flex-1"><label class="lbl">Seed (same seed = same split)</label><input id="is-seed" type="number" class="in" value="42" oninput="isRun()"></div><button onclick="$('is-seed').value=Math.floor(Math.random()*1e6);isRun()" class="btn b-dark whitespace-nowrap"><i class="fa-solid fa-shuffle mr-1"></i> New seed</button></div>
            </div>
            <div class="lg:col-span-7 bg-[#080c14] p-5 rounded-xl border border-slate-800"><h4 class="text-xs font-mono font-bold text-slate-300 mb-2">Partition Summary</h4><div class="h-52 relative"><canvas id="is-chart"></canvas></div></div>
          </div>
        </div>
        <div id="is-cards" class="grid grid-cols-1 md:grid-cols-3 gap-4"></div>
        <div class="card space-y-3"><h3 class="font-bold text-gold"><i class="fa-solid fa-table text-neon mr-2"></i>Contents of each split</h3><div class="overflow-x-auto"><table><thead id="is-th"></thead><tbody id="is-tb"></tbody></table></div>
          <div class="flex flex-wrap gap-3"><button onclick="zipDownload(lbFiles(IM.splitLB,IM.split),'split_dataset.zip')" class="btn b-gold !py-3 !text-sm"><i class="fa-solid fa-file-zipper mr-1"></i> Download split dataset (ZIP)</button><button onclick="zipDownload(lbFiles(IM.splitLB,null),'labeled_dataset.zip')" class="btn b-dark !py-3 !text-sm">Download labeled dataset without split (ZIP)</button><button id="is-coco" onclick="zipDownload(lbCoco(IM.splitLB,IM.split),'split_dataset_coco.zip')" class="btn b-dark !py-3 !text-sm hidden"><i class="fa-solid fa-file-code mr-1"></i> Download split as COCO (ZIP)</button><button onclick="isZipEach()" class="btn b-dark !py-3 !text-sm" title="One smaller ZIP per split, so the browser needs less memory at a time"><i class="fa-solid fa-boxes-stacked mr-1"></i> Download each split as its own ZIP</button></div></div>
      </div>
    </section>`;
}
imgBuild();
document.addEventListener("keydown", (e) => {
  const L = IM.lab;
  if (!L.active || IM.tab !== "ilabel" || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (/^[1-9]$/.test(e.key) && +e.key <= L.nm.length) ilPick(+e.key - 1);
  else if (e.key === "ArrowLeft") ilGo(-1);
  else if (e.key === "Enter" && L.kind === "det") ilAccept();
  else if ((e.key === "Backspace" || e.key === "z") && L.kind === "det") ilUndo();
  else if (L.kind === "det" && (e.key === "+" || e.key === "=")) ilZoom(1.5);
  else if (L.kind === "det" && (e.key === "-" || e.key === "_")) ilZoom(1 / 1.5);
  else if (L.kind === "det" && e.key === "0") ilFit();
  else if (L.kind === "det" && e.key === " ") {
    L.space = true; // hold Space and drag to move the picture
    ilCursor();
  } else return;
  e.preventDefault();
});
document.addEventListener("keyup", (e) => {
  const L = IM.lab;
  if (e.key === " " && L.space) {
    L.space = false;
    ilCursor();
    ilDraw();
  }
});
window.addEventListener("blur", () => (IM.lab.space = false));