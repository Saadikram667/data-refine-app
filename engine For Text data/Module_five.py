"""
DataRefine - Image Part - Module 1: get the dataset, gather information, display it.

    open_images(Folder_Path)    -> list of image records (corrupted files are kept, flagged)
    get_information(imag_list)  -> dict with health score, duplicates, colour modes, blur, per-image rows
    SaveGraphAndTable(info, out) -> saves a health dashboard (PNG) and a per-image table (CSV)

Nothing is edited, moved or deleted: every image is only read.

Install : pip install pillow numpy matplotlib
Run     : python module1_dataset_info.py <folder> [--output out] [--detailed]
"""
import argparse
import csv
import hashlib
import os
from collections import Counter

import numpy as np
from PIL import Image

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp"}
BLUR_THRESHOLD = 100.0   # Laplacian variance below this = blurry (below a third of it = very blurry)


# ------------------------------------------------------------------------------------------
# 1) open_images
# ------------------------------------------------------------------------------------------
def open_images(Folder_Path):
    """Read every image file in a folder (and sub-folders) into a list, corrupted files included.

    Each item is a dict:
        path, filename, extension, file_size (bytes),
        image (numpy array, or None if corrupted), pil_mode, format,
        corrupted (True/False), error (text)
    """
    images = []
    if not os.path.isdir(Folder_Path):
        print(f"Folder not found: {Folder_Path}")
        return images

    paths = []
    for root, _, files in os.walk(Folder_Path):
        for name in files:
            if os.path.splitext(name)[1].lower() in IMAGE_EXTENSIONS:
                paths.append(os.path.join(root, name))

    for path in sorted(paths):
        item = {"path": path, "filename": os.path.basename(path),
                "extension": os.path.splitext(path)[1].lower(),
                "file_size": os.path.getsize(path), "image": None,
                "pil_mode": "", "format": "", "corrupted": False, "error": ""}
        try:
            with Image.open(path) as im:
                item["pil_mode"], item["format"] = im.mode, im.format or ""
                im.load()                                  # raises an error if the file is broken
                if im.mode not in ("L", "RGB", "RGBA"):    # palette, CMYK, 16-bit ... -> RGB
                    im = im.convert("RGB")
                item["image"] = np.array(im)
        except Exception as e:
            item["corrupted"] = True
            item["error"] = f"{type(e).__name__}: {e}"[:150]
        images.append(item)
    return images


# ------------------------------------------------------------------------------------------
# helpers for get_information
# ------------------------------------------------------------------------------------------
def _to_gray(arr):
    if arr.ndim == 2:
        return arr.astype(np.float32)
    return arr[..., :3].astype(np.float32).mean(axis=2)


def _blur_score(gray):
    """Variance of the Laplacian: high = sharp, low = blurry."""
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0
    lap = (gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2] + gray[1:-1, 2:]
           - 4 * gray[1:-1, 1:-1])
    return float(lap.var())


def _color_mode(arr):
    """Grayscale / RGB / RGBA. (BGR cannot be told apart from RGB inside a file.)"""
    if arr.ndim == 2:
        return "Grayscale"
    if arr.shape[2] == 4:
        return "RGBA"
    return "RGB"


def _file_hash(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _stats(values):
    if not values:
        return {"min": 0, "max": 0, "mean": 0, "median": 0}
    return {"min": round(float(np.min(values)), 2), "max": round(float(np.max(values)), 2),
            "mean": round(float(np.mean(values)), 2), "median": round(float(np.median(values)), 2)}


# ------------------------------------------------------------------------------------------
# 2) get_information
# ------------------------------------------------------------------------------------------
def get_information(imag_list, detailed=False):
    """Look at every image and report on the dataset without editing anything.

    Returns a dict:
        summary, health, color_modes, blur, duplicates, detailed (or None), images (one row per file)
    """
    rows = []
    seen_hash = {}                  # file hash -> filename of the first copy
    exact_dups = 0

    for i, item in enumerate(imag_list, 1):
        row = {"index": i, "filename": item["filename"], "path": item["path"],
               "extension": item["extension"], "format": item["format"],
               "file_size_kb": round(item["file_size"] / 1024, 2),
               "corrupted": item["corrupted"], "error": item["error"],
               "width": "", "height": "", "resolution": "", "megapixels": "", "aspect_ratio": "",
               "color_mode": "", "brightness": "", "blur_score": "", "blur_state": "",
               "duplicate_of": ""}

        arr = item["image"]
        if not item["corrupted"] and arr is not None:
            h, w = arr.shape[:2]
            gray = _to_gray(arr)
            score = _blur_score(gray)
            if gray.std() < 1:
                state = "Blank"
            elif score < BLUR_THRESHOLD / 3:
                state = "Very Blurry"
            elif score < BLUR_THRESHOLD:
                state = "Blurry"
            else:
                state = "Sharp"
            row.update({"width": w, "height": h, "resolution": f"{w}x{h}",
                        "megapixels": round(w * h / 1e6, 3), "aspect_ratio": round(w / h, 2),
                        "color_mode": _color_mode(arr), "brightness": round(float(gray.mean()), 1),
                        "blur_score": round(score, 1), "blur_state": state})
            digest = _file_hash(item["path"])
            if digest in seen_hash:
                row["duplicate_of"] = seen_hash[digest]
                exact_dups += 1
            else:
                seen_hash[digest] = item["filename"]
        rows.append(row)

    total = len(rows)
    good = [r for r in rows if not r["corrupted"]]
    n_good, n_bad = len(good), total - len(good)

    colors = Counter(r["color_mode"] for r in good)
    blur = Counter(r["blur_state"] for r in good)

    # health score: 100 minus penalties (each = % of images affected x weight)
    def pct(n, base):
        return 100.0 * n / base if base else 0.0

    penalties = {
        "corrupted": pct(n_bad, total) * 1.0,
        "duplicates": pct(exact_dups, n_good) * 0.6,
        "blurry": pct(blur["Blurry"], n_good) * 0.25,
        "very_blurry": pct(blur["Very Blurry"], n_good) * 0.5,
        "blank": pct(blur["Blank"], n_good) * 0.5,
    }
    if n_good:  # mixed colour modes -> small penalty (max 10)
        penalties["mixed_colors"] = (1 - max(colors.values()) / n_good) * 10
    score = max(0.0, 100.0 - sum(penalties.values())) if total else 0.0
    label = ("No images" if not total else "Excellent" if score >= 90 else
             "Good" if score >= 75 else "Fair" if score >= 50 else "Poor")

    info = {
        "summary": {"total_files": total, "valid_images": n_good, "corrupted_images": n_bad,
                    "corrupted_percent": round(pct(n_bad, total), 2),
                    "total_size_mb": round(sum(i["file_size"] for i in imag_list) / 1048576, 2)},
        "health": {"score": round(score, 1), "label": label,
                   "penalties": {k: round(v, 2) for k, v in penalties.items()}},
        "color_modes": {"RGB": colors["RGB"], "Grayscale": colors["Grayscale"], "RGBA": colors["RGBA"],
                        "note": "BGR cannot be detected from image files; colour images are counted as RGB."},
        "blur": {"Sharp": blur["Sharp"], "Blurry": blur["Blurry"], "Very Blurry": blur["Very Blurry"],
                 "Blank": blur["Blank"], "threshold": BLUR_THRESHOLD},
        "duplicates": {"exact_duplicates": exact_dups, "unique_images": n_good - exact_dups},
        "detailed": None,
        "images": rows,
    }

    if detailed:
        info["detailed"] = {
            "width": _stats([r["width"] for r in good]),
            "height": _stats([r["height"] for r in good]),
            "megapixels": _stats([r["megapixels"] for r in good]),
            "file_size_kb": _stats([r["file_size_kb"] for r in good]),
            "brightness": _stats([r["brightness"] for r in good]),
            "blur_score": _stats([r["blur_score"] for r in good]),
            "formats": dict(Counter(r["format"] or "unknown" for r in good)),
            "extensions": dict(Counter(r["extension"] for r in good)),
            "most_common_resolutions": Counter(r["resolution"] for r in good).most_common(5),
        }
    return info


# ------------------------------------------------------------------------------------------
# 3) SaveGraphAndTable
# ------------------------------------------------------------------------------------------
def SaveGraphAndTable(info, output_folder="output"):
    """Save a health dashboard (dataset_health.png) and a per-image table (image_table.csv).
    Returns (png_path, csv_path)."""
    import matplotlib
    matplotlib.use("Agg")                      # no window needed, just save files
    import matplotlib.pyplot as plt

    os.makedirs(output_folder, exist_ok=True)
    png_path = os.path.join(output_folder, "dataset_health.png")
    csv_path = os.path.join(output_folder, "image_table.csv")

    # ---- table (CSV) ----
    rows = info["images"]
    if rows:
        with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
    else:
        csv_path = ""

    # ---- graph (PNG) ----
    s, hl, d = info["summary"], info["health"], info["duplicates"]
    fig, ax = plt.subplots(2, 2, figsize=(11, 8))
    fig.suptitle(f"Dataset Health: {hl['score']} / 100 ({hl['label']})", fontsize=15, fontweight="bold")

    def bars(axis, title, data, colors):
        axis.bar(list(data.keys()), list(data.values()), color=colors)
        axis.set_title(title)
        for x, v in enumerate(data.values()):
            axis.text(x, v, str(v), ha="center", va="bottom")

    bars(ax[0, 0], "Files", {"Valid": s["valid_images"], "Corrupted": s["corrupted_images"],
                             "Duplicates": d["exact_duplicates"]}, ["#4caf50", "#e53935", "#fb8c00"])
    bars(ax[0, 1], "Colour modes", {k: info["color_modes"][k] for k in ("RGB", "Grayscale", "RGBA")},
         ["#1e88e5", "#757575", "#8e24aa"])
    b = info["blur"]
    bars(ax[1, 0], "Sharpness", {k: b[k] for k in ("Sharp", "Blurry", "Very Blurry", "Blank")},
         ["#4caf50", "#fdd835", "#e53935", "#9e9e9e"])

    pen = {k: v for k, v in hl["penalties"].items() if v > 0}
    if pen:
        ax[1, 1].barh(list(pen.keys()), list(pen.values()), color="#e53935")
        ax[1, 1].set_title("Health score penalties (points lost)")
    else:
        ax[1, 1].text(0.5, 0.5, "No penalties", ha="center", va="center", fontsize=14)
        ax[1, 1].axis("off")

    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(png_path, dpi=120)
    plt.close(fig)
    return png_path, csv_path


# ------------------------------------------------------------------------------------------
# Run from the command line
# ------------------------------------------------------------------------------------------
def print_report(info):
    """Print only the key dataset results (per-image details go to the CSV file, not the screen)."""
    s, hl, cm, bl, d = (info[k] for k in ("summary", "health", "color_modes", "blur", "duplicates"))
    sizes = Counter(r["resolution"] for r in info["images"] if not r["corrupted"])
    penalties = {k: v for k, v in hl["penalties"].items() if v > 0}

    print("\n" + "=" * 56)
    print(f" DATASET HEALTH: {hl['score']} / 100  ({hl['label']})")
    print("=" * 56)
    print(f"Images        : {s['total_files']} found, {s['valid_images']} valid, {s['total_size_mb']} MB")
    print(f"Corrupted     : {s['corrupted_images']} ({s['corrupted_percent']}%)")
    print(f"Duplicates    : {d['exact_duplicates']} exact copies ({d['unique_images']} unique images)")
    print(f"Colour modes  : RGB {cm['RGB']} | Grayscale {cm['Grayscale']} | RGBA {cm['RGBA']}"
          f"   (BGR can't be detected from files)")
    print(f"Blur state    : Sharp {bl['Sharp']} | Blurry {bl['Blurry']} | "
          f"Very Blurry {bl['Very Blurry']} | Blank {bl['Blank']}")
    if sizes:
        common, count = sizes.most_common(1)[0]
        print(f"Image sizes   : {len(sizes)} different, most common {common} ({count} images)")
    biggest = max(penalties, key=penalties.get).replace("_", " ") if penalties else "none"
    print(f"Biggest issue : {biggest}")

    if info["detailed"]:                       # only with --detailed
        print("\nDetailed statistics:")
        for key, value in info["detailed"].items():
            print(f"  {key}: {value}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DataRefine - image dataset information")
    parser.add_argument("folder", help="folder containing the images")
    parser.add_argument("--output", default="output", help="folder for the PNG and CSV (default: output)")
    parser.add_argument("--detailed", action="store_true", help="include the detailed feature breakdown")
    args = parser.parse_args()

    image_list = open_images(args.folder)
    if not image_list:
        print("No images found.")
    else:
        result = get_information(image_list, detailed=args.detailed)
        print_report(result)
        png, table = SaveGraphAndTable(result, args.output)
        print(f"\nSaved: {png}\n       {table}")