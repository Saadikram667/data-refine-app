# Data-Refine-Platform
An end-to-end data preprocessing and visualization web application designed to automate data cleaning, encoding, exploratory analysis, and dataset splitting for Machine Learning workflows.

# CrimsonNova Data Suite: DataForge CLI & DataRefine Web

This repository contains a comprehensive data preprocessing ecosystem designed to refine raw tabular data into machine-learning-ready formats. It offers two distinct interfaces to suit different workflows: **DataForge CLI Studio**, a modular Python-based Command Line Interface, and **DataRefine**, an interactive end-to-end web application.

---

## Part 1: DataForge CLI Studio (Command Line Interface)

DataForge CLI Studio is engineered for terminal-based tabular data ingestion, profiling, preprocessing, visual analysis, and machine learning partitioning.

### Architecture & Project Structure

The CLI application is structured into four core Python modules and a central entry point:

```text
├── Main.py          # Interactive CLI main menu and workflow controller
├── Module_one.py    # Data ingestion, summary profiling, and HTML report generation
├── Module_two.py    # Missing value imputation, duplicate removal, column editing, and encoding
├── Module_three.py  # Statistical chart and plot generation using Seaborn & Matplotlib
└── Module_four.py   # Dataset partitioning into Train, Validation, and Test subsets

```

### CLI Features

* **Data Ingestion & Inspection (`Module_one.py`):** Imports `.csv`, `.xlsx`, `.xls`, and `.json` formats. Computes data types, nulls, entries, duplicates, min/max/median, and unique values. Exports styled HTML reports highlighting missing cells and generates a missing value bar chart.
* **Data Cleaning & Preprocessing (`Module_two.py`):**
* *Imputation:* Fill missing values using Mean, Median, Mode, Constant, or AI-based methods (IterativeImputer with RandomForestRegressor or KNNImputer with OrdinalEncoder).
* *Management:* Purge duplicate rows, rename headers, and swap column orders.
* *Encoding:* Transform non-numeric features via One-Hot, Ordinal, Target, or Native Pandas Categorical Codes.


* **Visual Analytics (`Module_three.py`):** Generates interactive Seaborn and Matplotlib graphics, including KDE Histograms, Boxplots, Scatter Plots, Pearson Correlation Heatmaps, and Line Charts.
* **Dataset Partitioning (`Module_four.py`):** Segregates data into Training, Validation, and Test partitions based on user ratios, automatically exporting to `train.csv`, `val.csv`, and `test.csv`.

### Installation & Setup

**Prerequisites:** Python 3.8 or higher.
**Install Dependencies:**

```bash
pip install pandas numpy seaborn matplotlib scikit-learn openpyxl

```

**How to Run:**
Clone the source code files into a single directory, open a terminal in that folder, and launch the application:

```bash
python Main.py

```

### Interactive Menu Overview

| Option | Action | Description |
| --- | --- | --- |
| **1** | Load Dataset | Load local `.csv`, `.xlsx`, `.xls`, or `.json` files into active memory. |
| **2** | Inspect & Profile Data | Print column summary statistics and optionally generate HTML/PNG reports. |
| **3** | Clean & Preprocess Data | Open sub-menu to fill nulls, drop duplicates, rename/swap columns, or encode variables. |
| **4** | Generate Visualizations | Open sub-menu to display interactive Seaborn plots. |
| **5** | Split Dataset | Partition dataset into Train, Test, and Validation ratios and export to CSV. |
| **6** | Export Cleaned CSV | Export the current cleaned state of the dataset to a target CSV path. |
| **7** | Exit | Close the application session. |

---

## Part 2: DataRefine (Web Application GUI)

DataRefine is an automated data preprocessing platform engineered by CrimsonNova. It functions as an end-to-end web application that consolidates dataset profiling, interactive imputation, categorical encoding, multi-graph visualization, and train-test splitting into a single graphical interface.

### Detailed Page Features

#### Ingestion Landing Page

* **File Upload Dropzone:** A central drag-and-drop area to import dataset files (CSV, Excel, JSON), supplemented by a local "Browse Files" button.
* **Demo Access:** A "Load Demo Dataset" button to populate the platform with sample data for immediate testing.

#### Tab 1: Dataset Overview

* **Health KPI Cards:** Top-level metrics displaying Data Health Score, total Missing Values (count/percentage), Total Columns, and Duplicate Rows.
* **Alert Banner:** An automated warning system explicitly stating the number of columns with missing values/duplicates, with a direct "Fix in Data Cleaning" button.
* **Visual Completeness:** A horizontal stacked bar chart mapping the ratio of complete data (blue) to missing data (yellow) for every column.
* **Feature Breakdown:** A tabular summary detailing each column's Name, Data Type, Null Count/Percentage, Unique Values, Mean/Mode, and Extrema.
* **Full Dataset Preview:** An interactive, paginated table with a search bar and quick-filters. Missing cells are tagged with yellow "null" text, and duplicates feature a red background.

#### Tab 2: Data Cleaning & Preprocessing Studio

* **Audit Trail:** A running chronological history log recording every dataset modification.
* **Missing Tab:** Apply imputation methods (Mode, Mean, Median, Constant, Forward Fill, Backward Fill) to target feature columns.
* **Duplicates Tab:** A single-click utility to instantly purge identical records.
* **Encode Tab:** Strategies for categorical encoding, including One-Hot (Dummy Variables), Label Codes, Ordinal Encoding, and Frequency/Value Count Encoding.
* **Columns Tab:** Rename headers and swap structural positions of selected columns.
* **Live Dataset View:** Real-time preview where modified cells receive a blue outline, nulls stay yellow, and duplicates stay red. Includes states to "Undo Last Step", "Revert All", or "Export Cleaned CSV".

#### Tab 3: Multi-Graph Visualization Studio

* **Active Graph Widget:** Select Chart Type (Histogram, Scatter Plot, Line Chart, Box Plot, Correlation Heatmap).
* **Axis & Color Mapping:** Dropdowns to assign X-Axis, Y-Axis, and optional Group/Color Maps.
* **Customization:** Set custom titles and select aesthetic palettes (e.g., Gold & Rose Blue Accent, Emerald & Teal, Crimson & Sunset).
* **Canvas Controls:** Render interactive plots, "+ Add New Graph" for side-by-side comparison, "Delete Graph", and "Download Chart JPG".

#### Tab 4: Train/Val/Test Splitter

* **Ratio Sliders:** Interactive sliders assigning percentage weights to Training, Validation, and Testing sets.
* **Validation Tracker:** A "Total Split Sum" indicator ensuring combined ratios equal exactly 100%.
* **Partition Summary:** A dynamic donut chart visually representing the created data splits.
* **Export Cards:** Dedicated output cards detailing row assignments per split, with independent download buttons for `train.csv`, `val.csv`, and `test.csv`.

### Web App Usage Guide

1. **Upload Data:** Drag and drop your raw CSV, Excel, or JSON file into the landing page dropzone, or click "Load Demo Dataset".
2. **Review Diagnostics:** Check the "Dataset Overview" tab's KPI cards and Feature Breakdown table to identify columns with missing values or incorrect data types.
3. **Execute Preprocessing:** In the "Data Cleaning" tab, use the left panel to fill missing values, remove duplicate rows, and encode string-based categorical columns. Verify changes using the live table and audit trail.
4. **Explore Relationships:** In the "Visualization" tab, build plots by selecting a chart type and assigning cleaned columns to axes. Click "Download Chart JPG" to export graphics.
5. **Generate ML Splits:** In the "Train/Val/Test Split" tab, adjust sliders to total 100%, click "Generate Subset Splits", and download the finalized CSV files from the output cards.
