# CrimsonNova Data Suite: DataForge CLI & DataRefine Web Engine

An end-to-end data engineering, preprocessing, computer vision suite, and visualization ecosystem designed to automate tabular data cleaning, exploratory data analysis, image diagnostics, pixel transformations, bounding-box annotations, and machine learning dataset partitioning.

---

## Repository Architecture & Structure

```text
CrimsonNova-Data-Suite/
├── CLI/
│   ├── Main.py          # Interactive CLI menu system and workflow controller
│   ├── Module_one.py    # Tabular: Ingestion, statistical profiling, and HTML reports
│   ├── Module_two.py    # Tabular: Missing value imputation, structural edits, encoding
│   ├── Module_three.py  # Tabular: Interactive plotting engine (Seaborn & Matplotlib)
│   ├── Module_four.py   # Tabular: Deterministic dataset partitioning (Train/Val/Test)
│   ├── Module_five.py   # Image Engine: Dataset diagnostics & health visual reports
│   ├── Module_six.py    # Image Engine: Image cleaning, pixel ops, color conversion
│   ├── Module_seven.py  # Image Engine: Annotation workspace & YOLO formatting
│   └── Module_eight.py  # Image Engine: Reproducible, stratified image dataset splitting
└── WebApp/
    ├── index.html       # Client-side web app dashboard layout and navigation UI
    ├── script.js        # Tabular Data Engine: Logic for imputation, charts, and CSV splits
    ├── logos.js         # Base64 WebP embedded platform brand assets
    ├── image-core.js    # Image CV Engine: Core health diagnostics, hashing, and canvas pixel ops
    └── image-ui.js      # Image CV UI: Annotation workspace, bounding boxes, and diagnostic layouts

```

---

## Part 1: DataForge CLI Studio (Command Line Interface)

DataForge CLI Studio is a terminal-driven Python application engineered for high-efficiency tabular data processing and automated computer vision dataset management.

### Tabular Engine (Modules 1–4)

* **Module One (`Module_one.py`)**: Ingests `.csv`, `.xlsx`, `.xls`, and `.json`. Computes null cell counts, extrema, medians, and unique values, exporting styled HTML health reports.
* **Module Two (`Module_two.py`)**: Applies AI-driven or statistical imputation (Mean, Median, Mode, `IterativeImputer`, `KNNImputer`). Manages categorical encoding (One-Hot, Ordinal, Target) and column restructuring.
* **Module Three (`Module_three.py`)**: Generates high-resolution Seaborn/Matplotlib figures (KDE Histograms, Boxplots, Scatter Plots, Correlation Heatmaps).
* **Module Four (`Module_four.py`)**: Segregates datasets into Train, Validation, and Test partitions according to user-defined ratios.

### Computer Vision Engine (Modules 5–8)

* **Module Five (`Module_five.py`)**: Runs dataset diagnostics, flagging corrupted files and calculating Laplacian variance to detect blur. Generates visual health reports.
* **Module Six (`Module_six.py`)**: Automates image cleaning and pixel preprocessing. Handles color mode conversions (RGB, Grayscale, BGR), unsharp mask sharpening, brightness adjustments, and batch resizing.
* **Module Seven (`Module_seven.py`)**: Provides an interactive terminal-driven annotation workspace for classification and bounding-box labeling, fully supporting YOLO `.txt` and `.yaml` formats.
* **Module Eight (`Module_eight.py`)**: Manages reproducible, PRNG-seeded, class-stratified dataset splitting for deep learning workflows.

---

## Part 2: DataRefine Platform (Web Application GUI)

DataRefine is a browser-native web application operating entirely on the client side without backend server dependencies.

### Tabular Processing Studio (Powered by `script.js`)

* **Dataset Overview**: KPI Health Cards, visual completeness charts, feature breakdown tables, and a paginated data viewer highlighting nulls (yellow) and duplicates (red).
* **Cleaning Studio**: Features a chronological audit trail with multi-method imputation, row purging, column swapping, and categorical encoding strategies.
* **Multi-Graph Visualization**: Interactive Chart.js plotting (Histograms, Scatter, Line, Box, Heatmaps) with customizable axes and JPG export.
* **Train/Val/Test Splitter**: Interactive percentage sliders validating to 100%, with independent CSV partition downloads.

### Computer Vision Studio (Powered by `image-core.js` & `image-ui.js`)

* **Health Diagnostics (Module 5 Logic)**: Evaluates dataset quality (0–100 score), identifying exact duplicates via SHA-256 byte hashing and flagging blurry images.
* **Pixel Operations (Module 6 Logic)**: Real-time non-destructive color space conversions, sharpening filters, Gaussian blurring, and high-quality canvas re-sampling. Encodes exports to JPEG, PNG, WEBP, or raw BMP/TIFF.
* **Annotation Workspace (Module 7 Logic)**: HTML5 canvas bounding-box drawing tool with pan, zoom, and crosshair guides. Exports YOLO classification (`classes.txt`) and object detection (`labels/*.txt`) data.
* **Reproducible Splitting (Module 8 Logic)**: PRNG-seeded stratified class-balanced partitioning, packaged and exported directly as structured `.zip` archives.

---

## Installation & Execution Guide

### 1. DataForge CLI

**Prerequisites**: Python 3.8+

```bash
pip install pandas numpy seaborn matplotlib scikit-learn openpyxl
cd CLI
python Main.py

```

### 2. DataRefine Web App

Because DataRefine executes strictly client-side via Web Workers and the HTML5 Canvas API, no backend is required.

* **Direct Launch**: Double-click `index.html` to open in any modern browser.
* **Local Server**:
```bash
cd WebApp
python -m http.server 8000

```


Navigate to `
