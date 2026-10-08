"""
DataRefine - Image Part - Module 4: split the labeled dataset into train / valid / test.

    split_condition_1(folder)  -> folder-based dataset      (Cat/, Dog/ ...)
    split_condition_2(folder)  -> YOLO classification       (images/ + label_mapping.py)
    split_condition_3(folder)  -> YOLO object detection     (images/ + labels/ + classes.txt)

`folder` is the output folder of Module seven. The original folder is NEVER changed:
the split dataset is written (copied) into a NEW folder, by default "<folder>_split".
If that folder already exists, files with the same name are overwritten.
The split is random but repeatable: the same seed gives the same split every time.

Run : python Module_eight.py <labeled_folder> [--output out] [--seed 42]
"""
import argparse
import ast
import json
import os
import random
import shutil
from pprint import pformat

import Module_five as mf

SPLITS = ("train", "valid", "test")


# ------------------------------------------------------------------------------------------
# small helpers (asking the user, listing files, splitting a list)
# ------------------------------------------------------------------------------------------
def _ask_split():
    """Ask for the train / valid / test percentages (press Enter to keep 70 / 20 / 10)."""
    defaults = (70, 20, 10)
    while True:
        values = []
        for name, default in zip(SPLITS, defaults):
            text = input(f"  {name} percent [{default}]: ").strip()
            try:
                values.append(float(text) if text else float(default))
            except ValueError:
                values.append(-1.0)
        if min(values) < 0:
            print("  Please type numbers that are 0 or bigger.")
        elif values[0] <= 0:
            print("  The train part must be bigger than 0.")
        elif abs(sum(values) - 100) > 0.01:
            print(f"  They add up to {sum(values):g}, but they must add up to 100.")
        else:
            return tuple(values)


def _get_fractions(ratios):
    """Percentages (or None = ask the user) -> fractions that add up to 1."""
    if ratios is None:
        print("\nHow should the dataset be split? (percentages, they must add up to 100)")
        ratios = _ask_split()
    total = float(sum(ratios))
    if len(ratios) != 3 or total <= 0 or min(ratios) < 0 or ratios[0] <= 0:
        raise ValueError("ratios must be three numbers (train, valid, test), train bigger than 0")
    return tuple(r / total for r in ratios)


def _list_images(folder):
    """Sorted names of the image files inside a folder (not looking into sub-folders)."""
    return sorted(n for n in os.listdir(folder)
                  if os.path.isfile(os.path.join(folder, n))
                  and os.path.splitext(n)[1].lower() in mf.IMAGE_EXTENSIONS)


def _split_list(items, fractions, seed):
    """Shuffle (repeatable) and cut a list into (train, valid, test)."""
    items = sorted(items)                          # same start order -> same result every run
    random.Random(seed).shuffle(items)
    n = len(items)
    n_valid, n_test = int(round(n * fractions[1])), int(round(n * fractions[2]))
    if n >= 3:                                     # small groups still get a valid / test image
        if fractions[1] > 0:
            n_valid = max(1, n_valid)
        if fractions[2] > 0:
            n_test = max(1, n_test)
    while n > 0 and n - n_valid - n_test < 1:      # train always keeps at least one image
        if n_valid >= n_test:
            n_valid -= 1
        else:
            n_test -= 1
    n_train = n - n_valid - n_test
    return items[:n_train], items[n_train:n_train + n_valid], items[n_train + n_valid:]


def _prepare_output(folder, output_folder):
    """Check the input folder and choose the output folder. Returns '' if something is wrong."""
    if not os.path.isdir(folder):
        print(f"Folder not found: {folder}")
        return ""
    output = output_folder or os.path.normpath(folder) + "_split"
    here, there = os.path.abspath(folder), os.path.abspath(output)
    if there == here or there.startswith(here + os.sep):
        print("The output folder must be a NEW folder outside the dataset folder.")
        return ""
    os.makedirs(output, exist_ok=True)
    return output


def _copy(src, dst_folder):
    os.makedirs(dst_folder, exist_ok=True)
    shutil.copy2(src, dst_folder)


def _print_counts(counts, what, total_key=None):
    """counts = {split: {group: number}} -> small table on the screen.
    The total is the sum of all groups, or only counts[split][total_key] if given."""
    print(f"\n{what} per split:")
    for split in SPLITS:
        if counts[split] is None:
            continue
        details = ", ".join(f"{k}: {v}" for k, v in counts[split].items())
        total = counts[split][total_key] if total_key else sum(counts[split].values())
        print(f"  {split:<6} {total:>6}   ({details})")


# ------------------------------------------------------------------------------------------
# 1) folder-based dataset
# ------------------------------------------------------------------------------------------
def split_condition_1(folder, output_folder=None, ratios=None, seed=42):
    # structure of saved files : main folder -> sub folders per lables
    # (each label is split on its own, so train / valid / test all contain every label)
    # Result: output/train/Cat, output/valid/Cat, output/test/Cat ...
    if not os.path.isdir(folder):
        print(f"Folder not found: {folder}")
        return ""
    labels = {}                                    # label name -> its image files
    for name in sorted(os.listdir(folder)):
        sub = os.path.join(folder, name)
        if os.path.isdir(sub) and _list_images(sub):
            labels[name] = _list_images(sub)
    if not labels:
        print("No label sub-folders with images were found in this folder.")
        return ""

    output = _prepare_output(folder, output_folder)
    if not output:
        return ""
    fractions = _get_fractions(ratios)

    counts = {s: ({} if fractions[k] > 0 else None) for k, s in enumerate(SPLITS)}
    for label, pictures in labels.items():
        parts = _split_list(pictures, fractions, seed)
        for k, (split, part) in enumerate(zip(SPLITS, parts)):
            if fractions[k] <= 0:
                continue
            target = os.path.join(output, split, label)
            os.makedirs(target, exist_ok=True)
            for picture in part:
                _copy(os.path.join(folder, label, picture), target)
            counts[split][label] = len(part)

    _print_counts(counts, "Images")
    print(f"\nSplit dataset saved to '{output}'")
    return output


# ------------------------------------------------------------------------------------------
# 2) YOLO classification (images folder + label_mapping.py)
# ------------------------------------------------------------------------------------------
def _read_mapping(path):
    """Read label_mapping.py WITHOUT running it: only plain values (dicts, lists, text, numbers)
    are read, so nothing inside the file can be executed."""
    values = {}
    with open(path, encoding="utf-8") as f:
        for node in ast.parse(f.read()).body:
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
                values[node.targets[0].id] = ast.literal_eval(node.value)
    return values


def _write_mapping(path, split, names, label_to_images):
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"# Label mapping created by DataRefine - Module 8 (YOLO classification, {split})\n\n")
        f.write(f"label_names = {pformat(names, width=100)}\n\n")
        f.write(f"label_to_images = {pformat(label_to_images, width=100)}\n")


def split_condition_2(folder, output_folder=None, ratios=None, seed=42):
    # structure of saved files : main folder -> images folder and a label mapping.py cantianing dicnary of the mapping like {0: ['a.jpg', ...], 1: [...]}
    # (each label is split on its own; every split gets its own images folder + label_mapping.py)
    # Result: output/train/images + output/train/label_mapping.py, same for valid and test
    image_folder = os.path.join(folder, "images")
    mapping_file = os.path.join(folder, "label_mapping.py")
    if not (os.path.isdir(image_folder) and os.path.isfile(mapping_file)):
        print("This folder needs an 'images' folder and a 'label_mapping.py' file.")
        return ""
    try:
        mapping = _read_mapping(mapping_file)
        names, label_to_images = mapping["label_names"], mapping["label_to_images"]
    except Exception as e:
        print(f"Could not read label_mapping.py ({type(e).__name__}: {e})")
        return ""

    output = _prepare_output(folder, output_folder)
    if not output:
        return ""
    fractions = _get_fractions(ratios)

    existing = set(_list_images(image_folder))
    ids = sorted(set(names) | set(label_to_images))
    maps = {s: {k: [] for k in ids} for s in SPLITS}           # the new mapping of each split
    missing = 0
    for label_id in ids:
        files = [f for f in label_to_images.get(label_id, []) if f in existing]
        missing += len(label_to_images.get(label_id, [])) - len(files)
        for split, part in zip(SPLITS, _split_list(files, fractions, seed)):
            maps[split][label_id] = part
            for picture in part:
                _copy(os.path.join(image_folder, picture), os.path.join(output, split, "images"))
    if missing:
        print(f"Warning: {missing} image(s) in label_mapping.py were not found in the images folder.")

    counts = {}
    for k, split in enumerate(SPLITS):
        if fractions[k] <= 0:
            counts[split] = None
            continue
        os.makedirs(os.path.join(output, split, "images"), exist_ok=True)
        _write_mapping(os.path.join(output, split, "label_mapping.py"), split, names, maps[split])
        classes = os.path.join(folder, "classes.txt")
        if os.path.isfile(classes):
            shutil.copy2(classes, os.path.join(output, split))
        counts[split] = {names.get(k2, k2): len(v) for k2, v in maps[split].items()}

    _print_counts(counts, "Images")
    print(f"\nSplit dataset saved to '{output}'")
    return output


# ------------------------------------------------------------------------------------------
# 3) YOLO object detection (images folder + labels folder)
# ------------------------------------------------------------------------------------------
def _write_yaml(output, folder, fractions):
    """data.yaml so the split dataset can be used directly (for example with Ultralytics YOLO)."""
    classes = os.path.join(folder, "classes.txt")
    if not os.path.isfile(classes):
        print("No classes.txt found, so data.yaml was not created.")
        return
    with open(classes, encoding="utf-8") as f:
        names = [line.strip() for line in f if line.strip()]
    with open(os.path.join(output, "data.yaml"), "w", encoding="utf-8") as f:
        f.write("path: .\n")
        f.write("train: images/train\n")
        if fractions[1] > 0:
            f.write("val: images/valid\n")
        if fractions[2] > 0:
            f.write("test: images/test\n")
        f.write("names:\n")
        for k, name in enumerate(names):
            f.write(f"  {k}: {json.dumps(name)}\n")          # quotes keep odd names valid


def split_condition_3(folder, output_folder=None, ratios=None, seed=42):
    # structure of saaved file: main folder -> image folder and lable folder (in which image has a txt file which has its box four coner points)
    # (an image can hold many classes, so the images are split randomly; its .txt file moves with it)
    # Result: output/images/train, output/labels/train, ... + classes.txt + data.yaml
    image_folder = os.path.join(folder, "images")
    label_folder = os.path.join(folder, "labels")
    if not (os.path.isdir(image_folder) and os.path.isdir(label_folder)):
        print("This folder needs an 'images' folder and a 'labels' folder.")
        return ""
    pictures = _list_images(image_folder)
    if not pictures:
        print("No images found in the images folder.")
        return ""

    output = _prepare_output(folder, output_folder)
    if not output:
        return ""
    fractions = _get_fractions(ratios)

    counts_images, counts_boxes = {}, {}
    parts = _split_list(pictures, fractions, seed)
    for k, (split, part) in enumerate(zip(SPLITS, parts)):
        if fractions[k] <= 0:
            counts_images[split] = counts_boxes[split] = None
            continue
        os.makedirs(os.path.join(output, "images", split), exist_ok=True)
        os.makedirs(os.path.join(output, "labels", split), exist_ok=True)
        boxes = 0
        for picture in part:
            _copy(os.path.join(image_folder, picture), os.path.join(output, "images", split))
            label_file = os.path.join(label_folder, os.path.splitext(picture)[0] + ".txt")
            if os.path.isfile(label_file):                    # no file = background image
                _copy(label_file, os.path.join(output, "labels", split))
                with open(label_file, encoding="utf-8") as f:
                    boxes += sum(1 for line in f if line.strip())
        counts_images[split], counts_boxes[split] = {"images": len(part)}, {"boxes": boxes}

    classes = os.path.join(folder, "classes.txt")
    if os.path.isfile(classes):
        shutil.copy2(classes, output)
    _write_yaml(output, folder, fractions)

    counts = {s: (None if counts_images[s] is None else {**counts_images[s], **counts_boxes[s]})
              for s in SPLITS}
    _print_counts(counts, "Images", total_key="images")
    print(f"\nSplit dataset saved to '{output}'")
    return output


# ------------------------------------------------------------------------------------------
# Run from the command line
# ------------------------------------------------------------------------------------------
def detect_structure(folder):
    """Which Module seven output is this? 1 = folder-based, 2 = YOLO classification,
    3 = YOLO object detection."""
    if os.path.isfile(os.path.join(folder, "label_mapping.py")):
        return 2
    if os.path.isdir(os.path.join(folder, "images")) and os.path.isdir(os.path.join(folder, "labels")):
        return 3
    return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DataRefine - split a labeled dataset")
    parser.add_argument("folder", help="the labeled dataset folder made by Module seven")
    parser.add_argument("--output", default=None, help="NEW folder for the split (default: <folder>_split)")
    parser.add_argument("--seed", type=int, default=42, help="same seed = same split (default: 42)")
    args = parser.parse_args()

    if not os.path.isdir(args.folder):
        print(f"Folder not found: {args.folder}")
    else:
        kind = detect_structure(args.folder)
        print({1: "Detected: folder-based dataset (one sub-folder per label)",
               2: "Detected: YOLO classification dataset (images + label_mapping.py)",
               3: "Detected: YOLO object detection dataset (images + labels)"}[kind])
        run = {1: split_condition_1, 2: split_condition_2, 3: split_condition_3}[kind]
        run(args.folder, args.output, None, args.seed)
