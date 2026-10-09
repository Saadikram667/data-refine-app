/**
 * DataRefine Platform - automated tests (no browser needed).  Run:  node tests/run.js   (or  npm test)
 *
 * The four scripts are loaded, in the same order as index.html, into a fake browser (a Node "vm" with a stand-in DOM).
 * Then pure functions are checked directly: splitting, hashing, COCO export, undo cap, size maths ...
 * It also checks that every function used by an onclick="..." in the pages really exists
 * (this catches typos and "Identifier has already been declared" name clashes between the scripts).
 */
const fs = require("fs"),
  vm = require("vm"),
  path = require("path"),
  assert = require("assert");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// A stand-in for the DOM: every property is another stand-in, every call returns one.
const dom = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : dom()), apply: () => dom(), construct: () => dom(), set: () => true });
const ctx = vm.createContext({ document: dom(), window: dom(), Chart: dom(), Papa: dom(), XLSX: dom(), JSZip: dom(), URL: dom(), Blob: dom(), File: dom(), navigator: dom(), localStorage: dom(), console, setTimeout, clearTimeout, structuredClone, alert() {}, confirm: () => true });
// Results are copied through JSON so arrays/objects from inside the fake browser compare equal in Node (promises are returned as they are).
const run = (code) => {
  const v = vm.runInContext(code, ctx);
  return v && typeof v === "object" && typeof v.then !== "function" ? JSON.parse(JSON.stringify(v)) : v;
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- loading ---------------------------------------------------------------------------------
const SCRIPTS = ["logos.js", "script.js", "image-core.js", "image-ui.js"];
test("all scripts load together (no redeclared names)", () => SCRIPTS.forEach((f) => new vm.Script(read(f), { filename: f }).runInContext(ctx)));

// --- every onclick / onchange / oninput calls a function that exists --------------------------
test("every function used by an inline handler exists", () => {
  const src = ["index.html", "script.js", "image-ui.js"].map(read).join("\n"),
    missing = new Set();
  for (const m of src.matchAll(/\bon(?:click|change|input|keydown)=\\?"([^"]*)"/g))
    m[1].split(";").forEach((part) => {
      const f = /^\s*([A-Za-z_$][\w$]*)\(/.exec(part);
      if (f && !["if", "for", "while", "return", "switch"].includes(f[1]) && run(`typeof ${f[1]}`) !== "function") missing.add(f[1]);
    });
  assert.deepStrictEqual([...missing], []);
});

// --- helpers ---------------------------------------------------------------------------------
test("arrMin / arrMax handle 500,000 values (Math.min(...x) would crash)", () => {
  assert.strictEqual(run("arrMin(Array.from({length: 500000}, (_, i) => i))"), 0);
  assert.strictEqual(run("arrMax(Array.from({length: 500000}, (_, i) => i))"), 499999);
});
test("rng gives the same numbers for the same seed", () => {
  assert.deepStrictEqual(run("[rng(7)(), rng(7)()]")[0], run("[rng(7)(), rng(7)()]")[1]);
  assert.notStrictEqual(run("rng(7)()"), run("rng(8)()"));
});
test("ctype tells numbers, dates and text apart", () => {
  run('cur = [{n: 1, d: "2024-01-05", t: "a"}, {n: 2, d: "2024-02-10", t: "b"}]');
  assert.deepStrictEqual(run('["n","d","t"].map(ctype)'), ["numeric", "date", "text"]);
});

// --- splitting -------------------------------------------------------------------------------
test("splitList: sizes add up, same seed = same split, new seed = different split", () => {
  run("var L = Array.from({length: 100}, (_, i) => ({name: 'f' + String(i).padStart(3, '0')}))");
  const a = run("splitList(L, [0.7, 0.2, 0.1], 42).map((p) => p.map((x) => x.name))"),
    b = run("splitList(L, [0.7, 0.2, 0.1], 42).map((p) => p.map((x) => x.name))"),
    c = run("splitList(L, [0.7, 0.2, 0.1], 43).map((p) => p.map((x) => x.name))");
  assert.deepStrictEqual(a.map((p) => p.length), [70, 20, 10]);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
  assert.strictEqual(new Set(a.flat()).size, 100); // no row twice
});
test("splitList keeps at least one item in validation and test for 3+ items", () => {
  const p = run("splitList([{name:'a'},{name:'b'},{name:'c'}], [0.8, 0.1, 0.1], 1).map((x) => x.length)");
  assert.deepStrictEqual(p, [1, 1, 1]);
});

// --- labeled dataset export ------------------------------------------------------------------
const mkDet = () =>
  run(`var DET = { kind: "det", names: {0: "Car", 1: "Bus"}, entries: Array.from({length: 10}, (_, i) => ({
    item: {}, w: 200, h: 100, name: "img" + i + ".jpg", boxes: [[i % 2, 10, 20, 60, 70]] })) }; 1`);
test("lbFiles folder format: one folder per label", () => {
  run(`var FOLD = { kind: "folder", names: {0: "Cat", 1: "Dog"}, entries: [
    {item: {}, label: 0, name: "a.jpg"}, {item: {}, label: 1, name: "b.jpg"}] }; 1`);
  assert.deepStrictEqual(run("lbFiles(FOLD, null).map((f) => f.path).sort()"), ["Cat/a.jpg", "Dog/b.jpg"]);
});
test("lbCoco: valid COCO file with 1-based categories and [x, y, w, h] boxes", () => {
  mkDet();
  const files = run("lbCoco(DET, null)"),
    j = JSON.parse(files.find((f) => f.path === "annotations/instances_all.json").text);
  assert.strictEqual(j.images.length, 10);
  assert.strictEqual(j.annotations.length, 10);
  assert.deepStrictEqual(j.categories.map((c) => [c.id, c.name]), [[1, "Car"], [2, "Bus"]]);
  assert.deepStrictEqual(j.annotations[0].bbox, [10, 20, 50, 50]);
  assert.strictEqual(j.annotations[0].area, 2500);
  assert.strictEqual(new Set(j.annotations.map((a) => a.id)).size, 10);
  assert.ok(files.some((f) => f.path === "images/img0.jpg"));
});
test("lbCoco with a split writes one annotation file per used split", () => {
  mkDet();
  const paths = run("lbCoco(DET, lbSplit(DET, [0.7, 0.3, 0], 5)).map((f) => f.path)");
  assert.ok(paths.includes("annotations/instances_train.json") && paths.includes("annotations/instances_valid.json"));
  assert.ok(!paths.includes("annotations/instances_test.json"));
  const total = run("lbSplit(DET, [0.7, 0.3, 0], 5).parts").train.length + run("lbSplit(DET, [0.7, 0.3, 0], 5).parts").valid.length;
  assert.strictEqual(total, 10);
});

test("YOLO detection export always contains data.yaml (with and without a split)", () => {
  mkDet();
  const yaml = (sp) => run(`lbFiles(DET, ${sp}).find((f) => f.path === "data.yaml").text`);
  const plain = yaml("null");
  assert.ok(/^train: images$/m.test(plain) && /^val: images/m.test(plain) && /^nc: 2$/m.test(plain));
  assert.ok(plain.includes('  0: "Car"') && plain.includes('  1: "Bus"'));
  const split = yaml("lbSplit(DET, [0.7, 0.2, 0.1], 5)");
  assert.ok(/^train: images\/train$/m.test(split) && /^val: images\/valid$/m.test(split) && /^test: images\/test$/m.test(split));
  const noVal = yaml("lbSplit(DET, [0.8, 0, 0.2], 5)");
  assert.ok(/^val: images\/train/m.test(noVal) && !/^val: images\/valid/m.test(noVal)); // YOLO needs a val entry
  assert.ok(!/^path:/m.test(plain + split)); // no path line: the folders are relative to the file itself
  assert.ok(!run('lbFiles({ kind: "folder", names: {0: "Cat"}, entries: [] }, null)').some((f) => f.path === "data.yaml")); // only for detection
});

// --- similar images (perceptual hash) --------------------------------------------------------
vm.runInContext(`var mkImg = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x / w, y / h), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } return { data: d, width: w, height: h }; }`, ctx);
const PATTERN = "(x, y) => 128 + 100 * Math.sin(x * 25) * Math.cos(y * 17)";
test("popcnt and hamming count differing bits", () => {
  assert.strictEqual(run("popcnt(0xffffffff)"), 32);
  assert.strictEqual(run("hamming([0, 0], [0xffffffff, 1])"), 33);
  assert.strictEqual(run("hamming([5, 9], [5, 9])"), 0);
});
test("dhash: the same picture at another size is 'near', a different picture is not", () => {
  const same = run(`hamming(dhash(mkImg(64, 64, ${PATTERN})), dhash(mkImg(160, 160, ${PATTERN})))`),
    other = run(`hamming(dhash(mkImg(64, 64, ${PATTERN})), dhash(mkImg(64, 64, (x, y) => 128 + 100 * Math.sin(y * 31 + x * 3))))`);
  assert.ok(same <= 5, `resized copy differs by ${same} bits`);
  assert.ok(other > 5, `different picture differs by only ${other} bits`);
});
test("imgNear marks similar pictures, skips exact copies, blank and broken ones", async () => {
  await run(`(async () => {
    const H = (w, h, f) => dhash(mkImg(w, h, f)), P = ${PATTERN}, Q = (x, y) => 128 + 100 * Math.sin(y * 31 + x * 3),
      mk = (path, dh, o = {}) => ({ path, dh, corrupted: false, dupOf: "", state: "Sharp", nearOf: "", ...o });
    globalThis.NEARS = [mk("a", H(64, 64, P)), mk("b", H(128, 128, P)), mk("c", H(64, 64, Q)), mk("d", H(64, 64, P), { dupOf: "a" }), mk("e", H(64, 64, P), { state: "Blank" }), mk("f", null, { corrupted: true })];
    await imgNear(NEARS);
  })()`);
  assert.deepStrictEqual(run("NEARS.map((i) => i.nearOf)"), ["", "a", "", "", "", ""]);
});

test("imgNear gives the same answer as comparing every pair (random hashes + copies with 1-8 flipped bits)", async () => {
  await run(`(async () => {
    const r = rng(99), word = () => (r() * 4294967296) >>> 0, flip = (h, n) => { const x = [h[0], h[1]]; for (let k = 0; k < n; k++) { const b = Math.floor(r() * 64); x[b < 32 ? 0 : 1] = (x[b < 32 ? 0 : 1] ^ (1 << (b % 32))) >>> 0; } return x; };
    const mk = (i, dh) => ({ path: "p" + i, dh, corrupted: false, dupOf: "", state: "Sharp", nearOf: "" }), list = [];
    for (let i = 0; i < 1500; i++) list.push(mk(i, [word(), word()]));
    for (let i = 0; i < 400; i++) list.push(mk(1500 + i, flip(list[Math.floor(r() * 1500)].dh, 1 + Math.floor(r() * 8))));
    globalThis.brute_skip = []; // anchors are pictures that were not themselves marked near
    const exp = []; for (let i = 0; i < list.length; i++) { let f = -1; for (let j = 0; j < i; j++) if (!brute_skip[j] && hamming(list[i].dh, list[j].dh) <= NEAR_BITS) { f = j; break; } exp.push(f); brute_skip[i] = f >= 0; }
    await imgNear(list);
    globalThis.NEAR_RESULT = { got: list.map((x) => x.nearOf), exp: exp.map((j) => (j >= 0 ? "p" + j : "")) };
  })()`);
  const { got, exp } = run("NEAR_RESULT");
  assert.deepStrictEqual(got, exp);
  assert.ok(got.filter(Boolean).length > 100, "the test data should contain many near copies");
});
test("imgNear stays fast for 12,500 different pictures (the worst case)", async () => {
  const t0 = Date.now();
  await run(`(async () => { const r = rng(5), w = () => (r() * 4294967296) >>> 0; const L = Array.from({length: 12500}, (_, i) => ({ path: "p" + i, dh: [w(), w()], corrupted: false, dupOf: "", state: "Sharp", nearOf: "" })); await imgNear(L); })()`);
  const ms = Date.now() - t0;
  console.log(`         (12,500 pictures searched in ${ms} ms)`);
  assert.ok(ms < 5000, `took ${ms} ms`);
});

// --- undo history is capped ------------------------------------------------------------------
test("table undo keeps only the last 20 steps (older ones stay in the log as text)", () => {
  const r = run(`cur = [{a: 1}]; mod = {}; hist = []; histOld = []; for (let i = 0; i < 30; i++) snap("step " + i); [hist.length, histOld.length, histOld[0].d, hist[0].d]`);
  assert.deepStrictEqual(r, [20, 10, "step 0", "step 10"]);
});

// --- size maths ------------------------------------------------------------------------------
test("icSizeFn: 50% halves the size, nothing typed gives no change", () => {
  assert.deepStrictEqual(run('IM.opt.sop = "pct"; IM.opt.a = "50"; icSizeFn().size({w: 100, h: 50})'), [50, 25]);
  assert.strictEqual(run('IM.opt.a = ""; icSizeFn()'), null);
});

// --- storage never throws --------------------------------------------------------------------
test("saved-session storage resolves to null when IndexedDB is missing", async () => assert.strictEqual(await run('Store.get("table")'), null));


// --- table split (seed + stratified) and the saved session ------------------------------------
// A second fake browser whose form fields really hold values, with an in-memory IndexedDB.
function makeBrowser(fields = {}) {
  const store = new Map(),
    el = (id) => {
      const o = { value: "", textContent: "", innerHTML: "", ...(fields[id] || {}) };
      return new Proxy(dom(), { get: (t, k) => (k in o ? o[k] : k === "classList" ? { add() {}, remove() {}, toggle() {}, contains: () => false } : t[k]), set: (t, k, v) => ((o[k] = v), true) });
    },
    els = {},
    idb = {
      open() {
        const req = {},
          done = (t) => setTimeout(() => t.oncomplete && t.oncomplete(), 0);
        setTimeout(() => {
          req.result = {
            createObjectStore() {},
            transaction() {
              const t = {};
              t.objectStore = () => ({
                get: (k) => { const q = {}; setTimeout(() => { q.result = store.get(k); t.oncomplete && t.oncomplete(); }, 0); return q; },
                put: (v, k) => { store.set(k, structuredClone(v)); done(t); return {}; },
                delete: (k) => { store.delete(k); done(t); return {}; },
              });
              return t;
            },
          };
          req.onupgradeneeded && req.onupgradeneeded();
          req.onsuccess && req.onsuccess();
        }, 0);
        return req;
      },
    },
    doc = new Proxy(dom(), { get: (t, k) => (k === "getElementById" ? (id) => els[id] || (els[id] = el(id)) : t[k]) }),
    c = vm.createContext({ document: doc, window: dom(), Chart: dom(), Papa: dom(), XLSX: dom(), JSZip: dom(), URL: dom(), Blob: dom(), File: dom(), navigator: dom(), localStorage: dom(), indexedDB: idb, console, setTimeout, clearTimeout, structuredClone, alert() {}, confirm: () => true });
  SCRIPTS.forEach((f) => new vm.Script(read(f), { filename: f }).runInContext(c));
  return { c, els, store, run: (code) => { const v = vm.runInContext(code, c); return v && typeof v === "object" && typeof v.then !== "function" ? JSON.parse(JSON.stringify(v)) : v; } };
}
test("table split: same seed = same split, ratios respected, stratified keeps the mix", () => {
  const B = makeBrowser({ "sp-seed": { value: "42" }, "train-r": { value: "70" }, "val-r": { value: "20" }, "test-r": { value: "10" }, "sp-strat": { value: "" } });
  B.run(`cur = Array.from({length: 100}, (_, i) => ({ id: i, g: i < 80 ? "a" : "b" })); doSplit(); 1`);
  const plain = B.run("[trn, val, tst].map((p) => p.map((r) => r.id))");
  assert.deepStrictEqual(plain.map((p) => p.length), [70, 20, 10]);
  B.run("doSplit()");
  assert.deepStrictEqual(B.run("[trn, val, tst].map((p) => p.map((r) => r.id))"), plain); // same seed
  B.els["sp-seed"].value = "43";
  B.run("doSplit()");
  assert.notDeepStrictEqual(B.run("[trn, val, tst].map((p) => p.map((r) => r.id))"), plain); // other seed
  B.els["sp-seed"].value = "42";
  B.els["sp-strat"].value = "g";
  B.run("doSplit()");
  const share = B.run('[trn, val, tst].map((p) => p.filter((r) => r.g === "b").length)'); // 20 of the 100 rows are "b"
  assert.deepStrictEqual(share, [14, 4, 2]);
  assert.strictEqual(new Set(B.run("[...trn, ...val, ...tst].map((r) => r.id)")).size, 100);
});
test("saved session: save, read back, and resume restores data, edits and the change log", async () => {
  const B = makeBrowser();
  B.run(`meta = { name: "demo.csv", kb: 3 }; orig = [{ a: 1 }, { a: 2 }, { a: 3 }]; cur = [{ a: 1 }, { a: 3 }]; mod = { "0_a": 1 };
         hist = [{ d: "Removed a row", t: "10:00" }]; histOld = [{ d: "Older step", t: "09:00" }]; saveSoon(); 1`);
  await new Promise((r) => setTimeout(r, 1900)); // the save waits 1.5 s after the last change
  const meta = await B.run('Store.get("table-meta")');
  assert.deepStrictEqual([meta.name, meta.rows], ["demo.csv", 2]);
  await B.run("resumeSession()");
  assert.deepStrictEqual(B.run("cur"), [{ a: 1 }, { a: 3 }]);
  assert.deepStrictEqual(B.run("orig"), [{ a: 1 }, { a: 2 }, { a: 3 }]);
  assert.deepStrictEqual(B.run("histOld.map((x) => x.d)"), ["Older step", "Removed a row"]);
  await B.run("discardSession()");
  assert.ok(!(await B.run('Store.get("table")')), "the saved session should be gone");
  assert.ok(!(await B.run('Store.get("table-meta")')));
});


// --- zoom and pan in the box-drawing screen ----------------------------------------------------
test("zoom keeps the spot under the pointer fixed and boxes stay in real picture pixels", () => {
  const B = makeBrowser({ "il-cv": { width: 800, height: 400 } });
  B.run("IM.lab = { src: {}, items: [], w: 1000, h: 500, sc: 0.8, z: 1, vx: 0, vy: 0 }; 1");
  B.run("ilZoom(2)"); // zoom in on the middle of the canvas
  assert.deepStrictEqual(B.run("[IM.lab.z, IM.lab.vx, IM.lab.vy]"), [2, 250, 125]);
  assert.deepStrictEqual(B.run("ilReal(IM.lab, 400, 200)"), [500, 250]); // the centre is still the centre
  assert.deepStrictEqual(B.run("ilReal(IM.lab, 0, 0)"), [250, 125]); // top-left of the view
  // a point under the pointer stays under it while zooming (at several places and zoom steps)
  for (const [cx, cy, f] of [[100, 50, 1.5], [700, 350, 3], [400, 10, 0.7], [799, 399, 2]]) {
    const before = B.run(`ilReal(IM.lab, ${cx}, ${cy})`);
    B.run(`ilZoom(${f}, ${cx}, ${cy})`);
    const after = B.run(`ilReal(IM.lab, ${cx}, ${cy})`);
    if (B.run("IM.lab.vx > 0 && IM.lab.vy > 0 && IM.lab.z > 1")) assert.ok(Math.abs(before[0] - after[0]) < 1e-6 && Math.abs(before[1] - after[1]) < 1e-6, `moved at ${cx},${cy}`);
  }
});
test("zoom is limited: never below 100%, never above the maximum, and the view stays inside the picture", () => {
  const B = makeBrowser({ "il-cv": { width: 800, height: 400 } });
  B.run("IM.lab = { src: {}, items: [], w: 1000, h: 500, sc: 0.8, z: 1, vx: 0, vy: 0 }; 1");
  B.run("ilZoom(0.1)");
  assert.deepStrictEqual(B.run("[IM.lab.z, IM.lab.vx, IM.lab.vy]"), [1, 0, 0]);
  B.run("ilZoom(1000, 800, 400)");
  assert.strictEqual(B.run("IM.lab.z"), B.run("ILZMAX"));
  const [z, vx, vy] = B.run("[IM.lab.z, IM.lab.vx, IM.lab.vy]");
  assert.ok(vx >= 0 && vx <= 1000 - 1000 / z && vy >= 0 && vy <= 500 - 500 / z);
  B.run("IM.lab.vx = -50; IM.lab.vy = 99999; ilClamp(IM.lab)"); // panning past the edge is stopped
  assert.ok(B.run("IM.lab.vx") === 0 && B.run("IM.lab.vy") === 500 - 500 / z);
  B.run("ilFit()");
  assert.deepStrictEqual(B.run("[IM.lab.z, IM.lab.vx, IM.lab.vy]"), [1, 0, 0]);
});

// --- runner ----------------------------------------------------------------------------------
(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log("  ok   " + name);
    } catch (e) {
      failed++;
      console.log("  FAIL " + name + "\n         " + String((e && e.message) || e).split("\n").join("\n         "));
    }
  }
  console.log(`\n${tests.length - failed} of ${tests.length} tests passed`);
  process.exit(failed ? 1 : 0);
})();