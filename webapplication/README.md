# DataRefine Platform

Clean, label and split **tables** and **images** for machine learning, entirely in the browser.
Your files are never uploaded anywhere: everything runs on your own computer.

Open `index.html` in a modern browser (Chrome, Edge or Firefox). No build step and no server are needed
(an internet connection is needed once per visit for Tailwind, Chart.js, Papa Parse, SheetJS, JSZip and Font Awesome from their CDNs).

## What it does

**Tables** (CSV, Excel, JSON)
- Health check: missing values, duplicates, types (numbers, dates, text), outliers, correlations, charts.
- Cleaning with undo: fill or drop missing values, remove duplicates, rename and drop columns, encode text
  (label, one-hot, ordinal, frequency) and split dates into year / month / day.
- Train / validation / test split with a **seed** (same seed = same split) and an optional **stratified** split.
- Your work is **saved in the browser** (IndexedDB) and can be resumed after a refresh.
- Download the cleaned data, the splits and a `change_log.json` of every cleaning step.

**Images** (folder, ZIP or loose files)
- Health score; corrupted files, exact duplicates, **similar images** (perceptual hash), blur, blank and colour-mode checks.
- Cleaning with undo: remove bad files, colour mode, sharpen, resize, brightness, file format.
- Labeling inside the page: folder format, YOLO classification, YOLO object detection (draw boxes, with zoom up to 2000%, panning and guide lines for exact corners).
- Seeded train / validation / test split. Exports: YOLO detection (with `data.yaml`), YOLO classification, folder format and **COCO** (detection), as one ZIP or one ZIP per split.

## Limits (please read)

- Everything is held in the browser's memory. Up to a few thousand images or about a million table cells works comfortably;
  the app warns before loading more. Very large sets are better cleaned in batches.
- Undo keeps the last 20 steps (tables) or 15 steps (images). Older steps stay in the change log as text only.
- Image sessions are not saved between visits (the files themselves are too large); table sessions are.
- Similar-image detection finds resized or re-saved copies, not different photos of the same scene.
- Cleaning and encoding are applied to the whole table before the split. For a real model, fit imputers and encoders on the
  training subset only, otherwise information from validation / test leaks into training.

## Project layout

| File | Role |
|---|---|
| `index.html` | Page markup. Loads the scripts in this order: `logos.js`, `script.js`, `image-core.js`, `image-ui.js`. |
| `script.js` | Table app (loading, cleaning, charts, split) and shared helpers (`$`, `esc`, `ask` dialog, `Store`). |
| `image-core.js` | Image engine without any page code: reading, analysis, hashing, pixel operations, labeled-dataset export. |
| `image-ui.js` | Image app screens (Info, Clean, Label, Split). |
| `style.css` | The custom styles (Tailwind provides most layout). |
| `logos.js` | The logos as embedded data. |
| `tests/run.js` | Automated tests. |

All scripts share one global scope, so a name used in two files is an error ("Identifier has already been declared").
Naming convention in `image-ui.js`: `ic*` Clean tab, `il*` Label tab, `is*` Split tab, `ii*` Info tab, `IM` = all image state.
The test suite loads all four scripts together and fails if two of them clash.

## Tests

```
npm test        # or: node tests/run.js      (Node 18 or newer, no packages to install)
```

The tests run without a browser: the scripts are loaded into a fake page and the pure logic is checked (splits, hashing,
COCO export, undo cap, saved session with a fake IndexedDB, and that every `onclick` points to a function that exists).
GitHub Actions runs them on every push (`.github/workflows/ci.yml`).