/**
 * DataRefine Platform - image engine (browser version of Module_five / six / seven / eight)
 *
 *   Module five  : read images, health score, duplicates, colour modes, blur     -> imgRead, imgInfo
 *   Module six   : clean and process (colour, sharpen, resize, brightness, format) -> op*, imgBlob
 *   Module seven : label images (one label per image, or boxes)                    -> lbFiles (UI is in image-ui.js)
 *   Module eight : train / valid / test split of a labeled dataset                 -> splitList, lbFiles
 *
 * The original files are only read. Results are downloaded as ZIP files.
 * Libraries (loaded in index.html): JSZip (ZIP files). Everything else is plain browser code.
 *
 * Differences from the Python version (the browser cannot do these exactly):
 *   - Colour mode is read from the pixels (Grayscale = every pixel has R = G = B, RGBA = some transparency).
 *   - Resizing uses the browser's high-quality canvas scaling (Python uses LANCZOS).
 *   - Grayscale images are saved with three identical channels (canvas cannot write 1-channel files).
 *   - Split shuffling is repeatable with a seed, but gives different (not identical) splits than Python.
 *   - GIF cannot be written by the browser: an edited GIF is saved as PNG.
 *
 * Short names: it = one image record, px = ImageData (RGBA pixels), LB = labeled dataset.
 */

/* ============================================================
   Constants and small helpers
   ============================================================ */
const IMG_EXT = [".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp"];
const IMG_FMT = { ".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".bmp": "BMP", ".gif": "GIF", ".tif": "TIFF", ".tiff": "TIFF", ".webp": "WEBP" };
const IMG_MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const BLUR_T = 100; // Laplacian variance below this = blurry (below a third of it = very blurry)
const SPN = ["train", "valid", "test"];
const imgExt = (n) => (n.lastIndexOf(".") < 0 ? "" : n.slice(n.lastIndexOf(".")).toLowerCase());
const isImgName = (n) => IMG_EXT.includes(imgExt(n));
const tick = () => new Promise((r) => setTimeout(r, 0)); // let the page redraw between heavy steps
const toBlob = (c, t, q) => new Promise((r) => c.toBlob(r, t, q));
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const pct = (n, base) => (base ? (100 * n) / base : 0);
let imgSeq = 0;

// Canvas <-> ImageData helpers.
function px2canvas(d) {
  const c = document.createElement("canvas");
  c.width = d.width;
  c.height = d.height;
  c.getContext("2d").putImageData(d, 0, 0);
  return c;
}
const newPx = (d) => new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
// Small JPEG data-URL preview of an ImageData (used for thumbnails of edited images).
function imgThumb(d, m = 160) {
  const s = px2canvas(d),
    k = Math.min(1, m / Math.max(d.width, d.height)),
    c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(d.width * k));
  c.height = Math.max(1, Math.round(d.height * k));
  c.getContext("2d").drawImage(s, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
// Decode a file into RGBA pixels (throws if the file is broken or the browser cannot read it).
async function imgDecode(file) {
  const b = await createImageBitmap(file),
    c = document.createElement("canvas");
  c.width = b.width;
  c.height = b.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(b, 0, 0);
  if (b.close) b.close();
  return x.getImageData(0, 0, c.width, c.height);
}
// Pixels of an image: the edited pixels if it was changed, otherwise decoded from the original file.
const getPx = async (it) => it.px || imgDecode(it.file);

/* ============================================================
   Module five: read images and gather information
   ============================================================ */
// Size, brightness, colour mode and blur state of one image (blur = variance of the Laplacian).
function imgStats(d) {
  const a = d.data,
    w = d.width,
    h = d.height,
    n = w * h,
    g = new Float32Array(n);
  let s = 0,
    s2 = 0,
    alpha = false,
    gray = true;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = a[j],
      gg = a[j + 1],
      b = a[j + 2],
      v = (r + gg + b) / 3;
    if (a[j + 3] < 255) alpha = true;
    if (r !== gg || gg !== b) gray = false;
    g[i] = v;
    s += v;
    s2 += v * v;
  }
  const mean = s / n,
    std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  let blur = 0;
  if (w >= 3 && h >= 3) {
    let ls = 0,
      ls2 = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1, i = y * w + 1; x < w - 1; x++, i++) {
        const v = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
        ls += v;
        ls2 += v * v;
      }
    const m = (w - 2) * (h - 2);
    blur = Math.max(0, ls2 / m - (ls / m) ** 2);
  }
  const state = std < 1 ? "Blank" : blur < BLUR_T / 3 ? "Very Blurry" : blur < BLUR_T ? "Blurry" : "Sharp";
  return { w, h, mode: alpha ? "RGBA" : gray ? "Grayscale" : "RGB", bright: mean, blur, state };
}
// Fingerprint of the file bytes, used to find exact duplicates.
async function imgHash(file) {
  const buf = await file.arrayBuffer();
  if (window.crypto && crypto.subtle) {
    try {
      const h = await crypto.subtle.digest("SHA-256", buf);
      return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {}
  }
  const u = new Uint8Array(buf); // fallback when crypto.subtle is not available
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < u.length; i++) {
    h1 = Math.imul(h1 ^ u[i], 2654435761);
    h2 = Math.imul(h2 ^ u[i], 1597334677);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + "-" + u.length;
}
// Read one file into an image record. Broken files are kept and flagged as corrupted.
async function imgRead(file, path) {
  const name = path.split("/").pop(),
    ext = imgExt(name),
    it = {
      id: ++imgSeq, path, name, ext, file, size: file.size, format: IMG_FMT[ext] || "",
      px: null, th: null, url: null, corrupted: false, error: "", hash: "",
      w: 0, h: 0, mode: "", bright: 0, blur: 0, state: "", dupOf: "",
      changed: false, newExt: null, sharpened: false, rel: "",
    };
  try {
    const d = await imgDecode(file);
    Object.assign(it, imgStats(d));
    it.hash = await imgHash(file);
  } catch (e) {
    it.corrupted = true;
    it.error = ((e && e.name) || "Error") + ": " + ((e && e.message) || "cannot be read as an image");
    if (ext === ".tif" || ext === ".tiff") it.error = "This browser cannot read TIFF files (or the file is broken)";
    it.error = it.error.slice(0, 150);
  }
  return it;
}
// Turn the chosen files / dropped folders / ZIP files into a flat list of {file, path}.
async function imgCollect(inputs) {
  const out = [];
  for (const f of inputs) {
    const file = f.file || f,
      path = (f.path || file.webkitRelativePath || file.name).replace(/\\/g, "/");
    if (/\.zip$/i.test(file.name)) {
      const z = await JSZip.loadAsync(file);
      for (const e of Object.values(z.files)) {
        if (e.dir || e.name.split("/").some((s) => s === "__MACOSX" || s.startsWith("."))) continue;
        if (isImgName(e.name)) out.push({ file: new File([await e.async("blob")], e.name.split("/").pop()), path: e.name });
      }
    } else if (isImgName(file.name)) out.push({ file, path });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
// Read all images (one by one so the page stays responsive) and mark exact duplicates.
async function imgReadAll(entries, progress) {
  const out = [],
    seen = new Map();
  for (let i = 0; i < entries.length; i++) {
    const it = await imgRead(entries[i].file, entries[i].path);
    if (!it.corrupted) {
      if (seen.has(it.hash)) it.dupOf = seen.get(it.hash);
      else seen.set(it.hash, it.path);
    }
    out.push(it);
    if (progress) progress(i + 1, entries.length);
    if (i % 3 === 2) await tick();
  }
  const dirs = out.map((i) => i.path.split("/").slice(0, -1));
  let root = dirs[0] || [];
  dirs.forEach((d) => {
    let k = 0;
    while (k < root.length && k < d.length && root[k] === d[k]) k++;
    root = root.slice(0, k);
  });
  out.forEach((i, k) => (i.rel = dirs[k].slice(root.length).join("/"))); // folder inside the dataset root
  return { items: out, root: root.join("/") };
}
// Min / max / mean / median of a list of numbers.
function imgStat(v) {
  if (!v.length) return { min: 0, max: 0, mean: 0, median: 0 };
  const s = [...v].sort((a, b) => a - b),
    n = s.length;
  return {
    min: r2(s[0]),
    max: r2(s[n - 1]),
    mean: r2(s.reduce((a, b) => a + b, 0) / n),
    median: r2(n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2),
  };
}
// Dataset report: health score, duplicates, colour modes, blur (same formula as Module five).
function imgInfo(items) {
  const total = items.length,
    good = items.filter((i) => !i.corrupted),
    nG = good.length,
    nB = total - nG,
    alive = new Set(items.map((i) => i.path)),
    dups = good.filter((i) => i.dupOf && alive.has(i.dupOf)).length,
    cnt = (k, v) => good.filter((i) => i[k] === v).length,
    colors = { RGB: cnt("mode", "RGB"), Grayscale: cnt("mode", "Grayscale"), RGBA: cnt("mode", "RGBA") },
    blur = { Sharp: cnt("state", "Sharp"), Blurry: cnt("state", "Blurry"), "Very Blurry": cnt("state", "Very Blurry"), Blank: cnt("state", "Blank") },
    pen = {
      corrupted: pct(nB, total) * 1.0,
      duplicates: pct(dups, nG) * 0.6,
      blurry: pct(blur.Blurry, nG) * 0.25,
      very_blurry: pct(blur["Very Blurry"], nG) * 0.5,
      blank: pct(blur.Blank, nG) * 0.5,
    };
  if (nG) pen.mixed_colors = (1 - Math.max(...Object.values(colors)) / nG) * 10;
  const score = total ? Math.max(0, 100 - Object.values(pen).reduce((a, b) => a + b, 0)) : 0,
    label = !total ? "No images" : score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 50 ? "Fair" : "Poor",
    res = {};
  good.forEach((i) => (res[i.w + "x" + i.h] = (res[i.w + "x" + i.h] || 0) + 1));
  const tally = (f) => {
    const o = {};
    good.forEach((i) => (o[f(i)] = (o[f(i)] || 0) + 1));
    return o;
  };
  return {
    total, valid: nG, bad: nB, badPct: r2(pct(nB, total)), mb: r2(items.reduce((a, i) => a + i.size, 0) / 1048576),
    score: r1(score), label, pen, colors, blur, dups, unique: nG - dups,
    resolutions: Object.entries(res).sort((a, b) => b[1] - a[1]),
    formats: tally((i) => i.format || "unknown"), extensions: tally((i) => i.ext),
    detail: {
      Width: imgStat(good.map((i) => i.w)), Height: imgStat(good.map((i) => i.h)),
      Megapixels: imgStat(good.map((i) => (i.w * i.h) / 1e6)), "File size (KB)": imgStat(good.map((i) => i.size / 1024)),
      Brightness: imgStat(good.map((i) => i.bright)), "Blur score": imgStat(good.map((i) => i.blur)),
    },
  };
}
// One table row per image (this is what the CSV download contains).
function imgRows(items) {
  return items.map((i, k) => ({
    index: k + 1, filename: i.name, path: i.path, extension: i.ext, format: i.format,
    file_size_kb: r2(i.size / 1024), corrupted: i.corrupted, error: i.error,
    width: i.corrupted ? "" : i.w, height: i.corrupted ? "" : i.h, resolution: i.corrupted ? "" : `${i.w}x${i.h}`,
    megapixels: i.corrupted ? "" : Math.round((i.w * i.h) / 1e3) / 1e3, aspect_ratio: i.corrupted ? "" : r2(i.w / i.h),
    color_mode: i.mode, brightness: i.corrupted ? "" : r1(i.bright), blur_score: i.corrupted ? "" : r1(i.blur),
    blur_state: i.state, duplicate_of: i.dupOf,
  }));
}

/* ============================================================
   Module six: pixel operations (each returns a NEW ImageData)
   ============================================================ */
// Colour mode: "rgb" drops transparency, "gray" uses the 0.299 / 0.587 / 0.114 weights, "bgr" swaps red and blue.
function opColor(d, kind) {
  const o = newPx(d),
    a = o.data;
  for (let i = 0; i < a.length; i += 4) {
    if (kind === "gray") a[i] = a[i + 1] = a[i + 2] = (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) | 0;
    else if (kind === "bgr") {
      const t = a[i];
      a[i] = a[i + 2];
      a[i + 2] = t;
    }
    a[i + 3] = 255;
  }
  return o;
}
// Multiply the brightness (1.0 = same). Transparency is left alone.
function opBright(d, f) {
  const o = newPx(d),
    a = o.data;
  for (let i = 0; i < a.length; i += 4) {
    a[i] *= f;
    a[i + 1] *= f;
    a[i + 2] *= f;
  }
  return o;
}
// Resize with the browser's high-quality scaling.
function opResize(d, nw, nh) {
  const c = document.createElement("canvas");
  c.width = nw;
  c.height = nh;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(px2canvas(d), 0, 0, nw, nh);
  return x.getImageData(0, 0, nw, nh);
}
// Gaussian blur of one channel (separable, edges repeat).
function gblur(src, w, h, sigma) {
  const r = Math.ceil(sigma * 3),
    k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = 0; i <= 2 * r; i++) s += k[i] = Math.exp(-((i - r) ** 2) / (2 * sigma * sigma));
  for (let i = 0; i <= 2 * r; i++) k[i] /= s;
  const t = new Float32Array(w * h),
    o = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += src[y * w + Math.min(w - 1, Math.max(0, x + j))] * k[j + r];
      t[y * w + x] = acc;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += t[Math.min(h - 1, Math.max(0, y + j)) * w + x] * k[j + r];
      o[y * w + x] = acc;
    }
  return o;
}
// Unsharp mask (radius 2, 150 percent, threshold 3 - the same settings as Module six).
function opSharpen(d) {
  const w = d.width,
    h = d.height,
    o = newPx(d),
    n = w * h;
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = d.data[i * 4 + c];
    const bl = gblur(ch, w, h, 2);
    for (let i = 0; i < n; i++) {
      const diff = ch[i] - bl[i];
      if (Math.abs(diff) > 3) o.data[i * 4 + c] = ch[i] + (diff * 150) / 100;
    }
  }
  return o;
}

/* ============================================================
   Saving images (ZIP files): JPG, PNG, WEBP through the canvas, BMP and TIFF written by hand
   ============================================================ */
function bmpBytes(d) {
  const w = d.width,
    h = d.height,
    rb = (w * 3 + 3) & ~3,
    size = 54 + rb * h,
    u = new Uint8Array(size),
    v = new DataView(u.buffer);
  u[0] = 0x42;
  u[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rb * h, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * rb;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      u[o++] = d.data[i + 2];
      u[o++] = d.data[i + 1];
      u[o++] = d.data[i];
    }
  }
  return u;
}
function tiffBytes(d) {
  const w = d.width,
    h = d.height,
    n = w * h * 3,
    off = 128,
    u = new Uint8Array(off + n),
    v = new DataView(u.buffer),
    // tag, type (3 = SHORT, 4 = LONG), count, value
    ent = [[256, 4, 1, w], [257, 4, 1, h], [258, 3, 3, 122], [262, 3, 1, 2], [273, 4, 1, off], [277, 3, 1, 3], [278, 4, 1, h], [279, 4, 1, n], [284, 3, 1, 1]];
  v.setUint16(0, 0x4949, true);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, ent.length, true);
  ent.forEach(([t, ty, c, val], i) => {
    const p = 10 + i * 12;
    v.setUint16(p, t, true);
    v.setUint16(p + 2, ty, true);
    v.setUint32(p + 4, c, true);
    if (ty === 3 && c === 1) v.setUint16(p + 8, val, true);
    else v.setUint32(p + 8, val, true);
  });
  [122, 124, 126].forEach((p) => v.setUint16(p, 8, true)); // 8 bits per channel
  for (let i = 0, o = off; i < w * h; i++) {
    u[o++] = d.data[i * 4];
    u[o++] = d.data[i * 4 + 1];
    u[o++] = d.data[i * 4 + 2];
  }
  return u;
}
async function imgEncode(d, ext) {
  if (ext === ".bmp") return new Blob([bmpBytes(d)], { type: "image/bmp" });
  if (ext === ".tif" || ext === ".tiff") return new Blob([tiffBytes(d)], { type: "image/tiff" });
  const type = IMG_MIME[ext] || "image/png";
  let src = d;
  if (type === "image/jpeg") {
    src = newPx(d); // JPG has no transparency: drop the alpha channel (as Module six does)
    for (let i = 3; i < src.data.length; i += 4) src.data[i] = 255;
  }
  const b = await toBlob(px2canvas(src), type, 0.95);
  if (!b || b.type !== type) throw new Error("This browser cannot save " + ext + " files");
  return b;
}
// Extension an image is saved with (an edited GIF becomes PNG).
const outExt = (it) => it.newExt || (it.changed && it.ext === ".gif" ? ".png" : it.ext);
// File content to save: untouched images are copied byte for byte, edited ones are encoded from the pixels.
// force = always encode (object detection, so the box coordinates match the saved picture).
async function imgBlob(it, force) {
  if (!force && !it.changed) return it.file;
  return imgEncode(await getPx(it), outExt(it));
}
// A file name that is not used yet in this folder (two images can share a name).
function uniqueName(used, folder, stem, ext) {
  let name = stem + ext,
    n = 1;
  while (used.has((folder + "/" + name).toLowerCase())) name = `${stem}_${n++}${ext}`;
  used.add((folder + "/" + name).toLowerCase());
  return name;
}

/* ============================================================
   Module seven / eight: labeled datasets and the split
   LB = { kind: "folder" | "cls" | "det", names: {0: "Cat", ...}, entries: [...] }
   entry = { item, name (file name inside the dataset), label (id) or boxes ([[class, x1, y1, x2, y2], ...]), w, h }
   ============================================================ */
const LB_KINDS = {
  folder: "One label per image - folder format",
  cls: "One label per image - YOLO classification",
  det: "Boxes inside images - YOLO object detection",
};
// Seeded random numbers (same seed = same split).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pyRound = (x) => {
  const f = Math.floor(x),
    d = x - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 ? f + 1 : f;
}; // like Python's round(): .5 goes to the even number
// Shuffle (repeatable) and cut a list into [train, valid, test]; small groups still get a valid / test image.
function splitList(list, fr, seed) {
  const a = [...list].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)),
    r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const n = a.length;
  let nv = pyRound(n * fr[1]),
    nt = pyRound(n * fr[2]);
  if (n >= 3) {
    if (fr[1] > 0) nv = Math.max(1, nv);
    if (fr[2] > 0) nt = Math.max(1, nt);
  }
  while (n > 0 && n - nv - nt < 1) nv >= nt ? nv-- : nt--; // train always keeps at least one image
  const ntr = n - nv - nt;
  return [a.slice(0, ntr), a.slice(ntr, ntr + nv), a.slice(ntr + nv)];
}
// Split a labeled dataset: each label on its own (folder / classification), or all images together (detection).
function lbSplit(LB, fr, seed) {
  const parts = { train: [], valid: [], test: [] };
  const groups = LB.kind === "det" ? [LB.entries] : Object.keys(LB.names).map((k) => LB.entries.filter((e) => e.label === +k));
  groups.forEach((g) => splitList(g, fr, seed).forEach((p, i) => parts[SPN[i]].push(...p)));
  return { fr, seed, parts };
}
// Counts per split for the summary table: {train: {images, boxes (detection), per: {label: n}}, ...}.
function lbCounts(LB, sp) {
  const out = {};
  SPN.forEach((s, i) => {
    if (!(sp.fr[i] > 0)) return;
    const list = sp.parts[s],
      o = { images: list.length, per: {} };
    if (LB.kind === "det") o.boxes = list.reduce((n, e) => n + e.boxes.length, 0);
    else Object.entries(LB.names).forEach(([k, nm]) => (o.per[nm] = list.filter((e) => e.label === +k).length));
    out[s] = o;
  });
  return out;
}
const pyStr = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
function mappingPy(title, names, list) {
  const ids = Object.keys(names).map(Number).sort((a, b) => a - b);
  return (
    `# Label mapping created by DataRefine Platform (YOLO classification${title})\n\n` +
    `label_names = {\n${ids.map((k) => `    ${k}: ${pyStr(names[k])},\n`).join("")}}\n\n` +
    `label_to_images = {\n${ids.map((k) => `    ${k}: [${list.filter((e) => e.label === k).map((e) => pyStr(e.name)).join(", ")}],\n`).join("")}}\n`
  );
}
// Every file of a labeled dataset (sp = null) or of its split (sp = lbSplit result).
// A file is {path, text} for text files or {path, item, force} for images.
function lbFiles(LB, sp) {
  const { kind, names, entries } = LB,
    ids = Object.keys(names).map(Number).sort((a, b) => a - b),
    out = [],
    img = (path, e) => out.push({ path, item: e.item, force: kind === "det" }),
    txt = (path, text) => out.push({ path, text }),
    classes = ids.map((k) => (kind === "det" ? names[k] : `${k} ${names[k]}`)).join("\n") + "\n",
    groups = sp ? SPN.filter((s, i) => sp.fr[i] > 0).map((s) => [s, sp.parts[s]]) : [["", entries]];
  groups.forEach(([s, list]) => {
    const p = s ? s + "/" : "";
    if (kind === "folder") list.forEach((e) => img(`${p}${names[e.label]}/${e.name}`, e));
    else if (kind === "cls") {
      list.forEach((e) => img(`${p}images/${e.name}`, e));
      txt(`${p}classes.txt`, classes);
      txt(`${p}label_mapping.py`, mappingPy(s ? ", " + s : "", names, list));
    } else {
      list.forEach((e) => {
        img(s ? `images/${s}/${e.name}` : `images/${e.name}`, e);
        const lines = e.boxes.map(([c, x1, y1, x2, y2]) =>
          [c, (x1 + x2) / 2 / e.w, (y1 + y2) / 2 / e.h, (x2 - x1) / e.w, (y2 - y1) / e.h].map((v, i) => (i ? v.toFixed(6) : v)).join(" "),
        );
        txt(`labels/${s ? s + "/" : ""}${e.name.replace(/\.[^.]+$/, "")}.txt`, lines.join("\n") + (lines.length ? "\n" : ""));
      });
    }
  });
  if (kind === "det") {
    txt("classes.txt", classes);
    // data.yaml: where the images are and the class names (split = one folder per subset, not split = one "images" folder)
    let y = "path: .\n";
    if (sp) {
      y += "train: images/train\n";
      if (sp.fr[1] > 0) y += "val: images/valid\n";
      if (sp.fr[2] > 0) y += "test: images/test\n";
    } else y += "train: images\nval: images\n";
    txt("data.yaml", y + "names:\n" + ids.map((k) => `  ${k}: ${JSON.stringify(names[k])}\n`).join(""));
  }
  return out;
}