"""
DataRefine - Image Part - Module 3: label the images (labeler).

    indicual_labber(images)      -> one label per image   (folder-based OR YOLO classification)
    labes_inside_images(images)  -> many boxes per image  (YOLO object detection)

`images` is the list from Module_five.open_images (or the list returned by Module_six,
so cleaned / resized images are labeled exactly as they will be saved).

A small window opens to show each image. The original folder is NEVER changed:
everything is written to a NEW folder (changed and unchanged images together),
ready to be used for training a model. If the output folder already exists,
files with the same name are overwritten, so use a fresh folder name each time.

Install : pip install pillow numpy matplotlib      (tkinter comes with normal Python)
Run     : python Module_seven.py <folder> [--output out] [--clean]
"""
import argparse
import os
import re
import shutil
from collections import Counter
from pprint import pformat

import numpy as np
from PIL import Image

try:                                  # the labeling window needs tkinter
    import tkinter as tk
    from PIL import ImageTk
except ImportError:
    tk = None

import Module_five as mf
import Module_six as m6
from Module_six import _ask_choice, PIL_FORMATS

MAX_W, MAX_H = 900, 600               # biggest size an image is shown at in the window
COLORS = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa", "#00acc1", "#fdd835", "#6d4c41"]


# ------------------------------------------------------------------------------------------
# small helpers (asking the user, preparing and saving images)
# ------------------------------------------------------------------------------------------
def _ask_int(prompt, minimum=1):
    """Keep asking until the user types a whole number >= minimum."""
    while True:
        try:
            value = int(input(prompt).strip())
            if value >= minimum:
                return value
        except ValueError:
            pass
        print(f"  Please type a whole number, {minimum} or bigger.")


def _ask_label_names():
    """Ask how many labels there are and what they are called. Returns {0: 'Cat', 1: 'Dog'}."""
    count = _ask_int("How many labels (classes) do you want? ")
    names = {}
    while len(names) < count:
        name = input(f"  Name of label {len(names)}: ").strip()
        if not name:
            print("  The name cannot be empty.")
        elif re.search(r'[\\/:*?"<>|]', name):
            print('  Please avoid these characters:  \\ / : * ? " < > |')
        elif name.lower() in [n.lower() for n in names.values()]:
            print("  That name is already used.")
        else:
            names[len(names)] = name
    return names


def _valid_images(images):
    """Only images that could be read can be labeled (corrupted ones are left out)."""
    items = [i for i in images if i["image"] is not None]
    if len(items) < len(images):
        print(f"{len(images) - len(items)} corrupted image(s) are left out of the labeling.")
    return items


def _to_pil(arr):
    pil = Image.fromarray(np.ascontiguousarray(arr))
    return pil if pil.mode in ("RGB", "L") else pil.convert("RGB")


def _fit(pil):
    """Resize to fit the window. Returns (picture, scale) where scale = shown size / real size."""
    scale = min(MAX_W / pil.width, MAX_H / pil.height, 4.0)
    size = (max(1, int(pil.width * scale)), max(1, int(pil.height * scale)))
    return pil.resize(size, Image.LANCZOS), scale


def _out_ext(item):
    """Extension the image will be saved with (Module six may have changed the format)."""
    return item.get("new_extension", item["extension"])


def _unique_path(folder, stem, ext, used):
    """A file path that was not used yet (two images can have the same file name)."""
    path, n = os.path.join(folder, stem + ext), 1
    while path.lower() in used:
        path = os.path.join(folder, f"{stem}_{n}{ext}")
        n += 1
    used.add(path.lower())
    return path


def _write_image(item, target, force_encode=False):
    """Save one image. Unchanged images are copied byte-for-byte (no quality loss);
    changed images are saved from the edited pixels.
    force_encode=True always saves from the pixels. It is used for object detection so the
    box coordinates always match the saved picture (phone photos can carry a hidden rotation
    flag that would make a plain copy look rotated in some tools)."""
    if os.path.exists(target) and os.path.samefile(target, item["path"]):      # last safety net
        raise ValueError(f"'{target}' is an original image. Use a NEW output folder so the "
                         f"originals are not overwritten.")
    if not force_encode and not item.get("changed"):
        shutil.copy2(item["path"], target)
        return
    fmt = PIL_FORMATS.get(_out_ext(item), "PNG")
    pil = Image.fromarray(np.ascontiguousarray(item["image"]))
    if fmt in ("JPEG", "BMP") and pil.mode == "RGBA":
        pil = pil.convert("RGB")
    options = {"quality": 95} if fmt in ("JPEG", "WEBP") else {}
    pil.save(target, fmt, **options)


def _output_overlaps_originals(items, out, subfolders):
    """True when saving into `out` (or out/<subfolder>) would write into a folder the images
    were read from. Checked BEFORE the labeling window opens, so no labeling work is lost."""
    sources = {os.path.normcase(os.path.dirname(os.path.abspath(i["path"]))) for i in items}
    places = [out] + [os.path.join(out, s) for s in subfolders]
    if any(os.path.normcase(os.path.abspath(p)) in sources for p in places):
        print(f"The output folder '{out}' would write into the original images' folder. "
              f"Choose a NEW folder so the originals stay untouched. Nothing was saved.")
        return True
    return False


def _need_tkinter():
    if tk is None:
        raise RuntimeError("tkinter is not installed. It comes with the normal Python installer "
                           "(on Linux: sudo apt install python3-tk).")


# ------------------------------------------------------------------------------------------
# window 1: pick ONE label for each image
# ------------------------------------------------------------------------------------------
def _label_images_gui(items, names):
    """Show the images one by one with a button per label.
    Returns {image path: label id} for every image the user labeled."""
    _need_tkinter()
    root = tk.Tk()
    root.title("DataRefine - Labeler")
    state = {"i": 0, "photo": None}
    answers = {}                                   # image path -> label id
    info = tk.StringVar()

    picture = tk.Label(root)
    picture.pack(padx=10, pady=10)
    tk.Label(root, textvariable=info, font=("Arial", 11)).pack()

    def show():
        i = state["i"]
        if i >= len(items):                        # last image done -> close the window
            root.destroy()
            return
        item = items[i]
        pil, _ = _fit(_to_pil(item["image"]))
        state["photo"] = ImageTk.PhotoImage(pil)   # keep a reference, or tkinter drops the picture
        picture.config(image=state["photo"])
        current = names.get(answers.get(item["path"]), "not labeled yet")
        info.set(f"Image {i + 1} / {len(items)}:  {item['filename']}   |   label: {current}")

    def go(step):
        state["i"] = max(0, state["i"] + step)
        show()

    def choose(label_id):
        if state["i"] < len(items):
            answers[items[state["i"]]["path"]] = label_id
            go(1)

    def skip():                                    # leave this image out of the dataset
        if state["i"] < len(items):
            answers.pop(items[state["i"]]["path"], None)
            go(1)

    buttons = tk.Frame(root)
    buttons.pack(pady=5)
    for k, name in names.items():
        tk.Button(buttons, text=f"{k + 1}: {name}  (id {k})", width=16,
                  command=lambda k=k: choose(k)).grid(row=k // 5, column=k % 5, padx=3, pady=3)
        if k < 9:
            root.bind(str(k + 1), lambda event, k=k: choose(k))   # keyboard shortcut

    extra = tk.Frame(root)
    extra.pack(pady=5)
    tk.Button(extra, text="< Back", width=10, command=lambda: go(-1)).pack(side="left", padx=3)
    tk.Button(extra, text="Skip image", width=10, command=skip).pack(side="left", padx=3)
    tk.Button(extra, text="Finish", width=10, command=root.destroy).pack(side="left", padx=3)
    tk.Label(root, text="Keys 1-9 pick a label. Skipped and unlabeled images are not saved.",
             fg="gray").pack(pady=(0, 8))

    show()
    root.mainloop()
    return answers


# ------------------------------------------------------------------------------------------
# window 2: draw MANY boxes inside each image
# ------------------------------------------------------------------------------------------
def _box_images_gui(items, names):
    """Show the images one by one. Drag the mouse to draw a box, pick the class first.
    Returns {image path: [(class id, x1, y1, x2, y2), ...]} in real pixels, only for the
    images the user accepted with 'Next' (an image with no boxes = background image)."""
    _need_tkinter()
    root = tk.Tk()
    root.title("DataRefine - Bounding Box Labeler")
    state = {"i": 0, "photo": None, "scale": 1.0, "size": (1, 1), "start": None}
    boxes = {it["path"]: [] for it in items}       # path -> [[class id, x1, y1, x2, y2], ...]
    done = set()                                   # images accepted with "Next"
    info = tk.StringVar()
    current_class = tk.IntVar(value=0)

    canvas = tk.Canvas(root, cursor="cross", highlightthickness=0, bd=0)
    canvas.pack(padx=10, pady=10)
    tk.Label(root, textvariable=info, font=("Arial", 11)).pack()

    def redraw():
        i = state["i"]
        if i >= len(items):
            root.destroy()
            return
        item = items[i]
        pil, scale = _fit(_to_pil(item["image"]))
        state["photo"], state["scale"], state["size"] = ImageTk.PhotoImage(pil), scale, pil.size
        canvas.config(width=pil.width, height=pil.height)
        canvas.delete("all")
        canvas.create_image(0, 0, image=state["photo"], anchor="nw")
        for cid, x1, y1, x2, y2 in boxes[item["path"]]:
            color = COLORS[cid % len(COLORS)]
            canvas.create_rectangle(x1 * scale, y1 * scale, x2 * scale, y2 * scale,
                                    outline=color, width=2)
            canvas.create_text(x1 * scale + 4, y1 * scale + 2, text=names[cid], fill=color,
                               anchor="nw", font=("Arial", 11, "bold"))
        status = "accepted" if item["path"] in done else "not accepted yet"
        info.set(f"Image {i + 1} / {len(items)}:  {item['filename']}   |   "
                 f"{len(boxes[item['path']])} box(es)   |   {status}")

    # ---- mouse: press = start corner, drag = preview, release = finish the box ----
    def press(event):
        state["start"] = (event.x, event.y)
        color = COLORS[current_class.get() % len(COLORS)]
        canvas.delete("preview")
        canvas.create_rectangle(event.x, event.y, event.x, event.y, outline=color,
                                width=2, dash=(4, 2), tags="preview")

    def drag(event):
        if state["start"] is not None:
            x0, y0 = state["start"]
            canvas.coords("preview", x0, y0, event.x, event.y)

    def release(event):
        if state["start"] is None or state["i"] >= len(items):
            return
        x0, y0 = state["start"]
        state["start"] = None
        width, height = state["size"]
        x1, x2 = sorted((x0, event.x))
        y1, y2 = sorted((y0, event.y))
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(width, x2), min(height, y2)
        if x2 - x1 >= 4 and y2 - y1 >= 4:          # ignore accidental clicks
            s = state["scale"]                     # window pixels -> real image pixels
            boxes[items[state["i"]]["path"]].append(
                [current_class.get(), x1 / s, y1 / s, x2 / s, y2 / s])
        redraw()

    canvas.bind("<ButtonPress-1>", press)
    canvas.bind("<B1-Motion>", drag)
    canvas.bind("<ButtonRelease-1>", release)

    # ---- buttons ----
    def go(step):
        state["i"] = max(0, state["i"] + step)
        redraw()

    def undo():
        if state["i"] < len(items) and boxes[items[state["i"]]["path"]]:
            boxes[items[state["i"]]["path"]].pop()
            redraw()

    def clear():
        if state["i"] < len(items):
            boxes[items[state["i"]]["path"]].clear()
            redraw()

    def accept():
        if state["i"] < len(items):
            done.add(items[state["i"]]["path"])
            go(1)

    def skip():                                    # leave this image out of the dataset
        if state["i"] < len(items):
            path = items[state["i"]]["path"]
            done.discard(path)
            boxes[path].clear()
            go(1)

    classes = tk.Frame(root)
    classes.pack(pady=3)
    tk.Label(classes, text="Class to draw:").grid(row=0, column=0, padx=5)
    for k, name in names.items():
        tk.Radiobutton(classes, text=f"{k + 1}: {name}", variable=current_class, value=k,
                       fg=COLORS[k % len(COLORS)]).grid(row=k // 6, column=k % 6 + 1, padx=3)
        if k < 9:
            root.bind(str(k + 1), lambda event, k=k: current_class.set(k))

    actions = tk.Frame(root)
    actions.pack(pady=5)
    for text, command in (("< Back", lambda: go(-1)), ("Undo last box", undo),
                          ("Clear boxes", clear), ("Skip image", skip),
                          ("Next >  (save)", accept), ("Finish", root.destroy)):
        tk.Button(actions, text=text, width=13, command=command).pack(side="left", padx=3)
    tk.Label(root, text="Keys 1-9 pick the class. Only images accepted with 'Next' are saved "
                        "(no boxes = background image).", fg="gray").pack(pady=(0, 8))

    redraw()
    root.mainloop()
    return {p: [tuple(b) for b in boxes[p]] for p in done}


# ------------------------------------------------------------------------------------------
# writing the output folders
# ------------------------------------------------------------------------------------------
def _save_folder_format(items, answers, names, out):
    """out/Cat/*.jpg, out/Dog/*.jpg ... one sub-folder per label."""
    for name in names.values():
        os.makedirs(os.path.join(out, name), exist_ok=True)
    used = set()
    for item in items:
        if item["path"] in answers:
            folder = os.path.join(out, names[answers[item["path"]]])
            stem = os.path.splitext(item["filename"])[0]
            _write_image(item, _unique_path(folder, stem, _out_ext(item), used))


def _save_yolo_classification(items, answers, names, out):
    """out/images/ (all images), out/classes.txt (id + name), out/label_mapping.py (metadata)."""
    image_folder = os.path.join(out, "images")
    os.makedirs(image_folder, exist_ok=True)
    used = set()
    label_to_images = {k: [] for k in names}                 # {0: ['a.jpg', ...], 1: [...]}
    for item in items:
        if item["path"] in answers:
            stem = os.path.splitext(item["filename"])[0]
            target = _unique_path(image_folder, stem, _out_ext(item), used)
            _write_image(item, target)
            label_to_images[answers[item["path"]]].append(os.path.basename(target))

    with open(os.path.join(out, "classes.txt"), "w", encoding="utf-8") as f:
        for k, name in names.items():
            f.write(f"{k} {name}\n")
    with open(os.path.join(out, "label_mapping.py"), "w", encoding="utf-8") as f:
        f.write("# Label mapping created by DataRefine - Module 7 (YOLO classification)\n\n")
        f.write(f"label_names = {pformat(names, width=100)}\n\n")
        f.write(f"label_to_images = {pformat(label_to_images, width=100)}\n")


def _save_yolo_detection(items, annotations, names, out):
    """out/images/x.jpg + out/labels/x.txt (one line per box: class x_center y_center w h,
    all between 0 and 1) + out/classes.txt (one class name per line, line number = class id)."""
    image_folder, label_folder = os.path.join(out, "images"), os.path.join(out, "labels")
    os.makedirs(image_folder, exist_ok=True)
    os.makedirs(label_folder, exist_ok=True)
    used = set()
    for item in items:
        if item["path"] not in annotations:
            continue
        stem = os.path.splitext(item["filename"])[0]
        target = _unique_path(image_folder, stem, _out_ext(item), used)
        _write_image(item, target, force_encode=True)

        img_h, img_w = item["image"].shape[:2]
        lines = []
        for cid, x1, y1, x2, y2 in annotations[item["path"]]:
            x_center, y_center = (x1 + x2) / 2 / img_w, (y1 + y2) / 2 / img_h
            width, height = (x2 - x1) / img_w, (y2 - y1) / img_h
            lines.append(f"{cid} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}")
        txt_name = os.path.splitext(os.path.basename(target))[0] + ".txt"
        with open(os.path.join(label_folder, txt_name), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + ("\n" if lines else ""))      # empty file = background

    with open(os.path.join(out, "classes.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(names[k] for k in sorted(names)) + "\n")


# ------------------------------------------------------------------------------------------
# 1) one label per image
# ------------------------------------------------------------------------------------------
def indicual_labber(images, output_folder="labeled_dataset"):
    # Normal Format (Folder-based):
    #     Asks the user how many labels to create and gets their names (e.g., Cat, Dog).
    #     Prompts the user to assign each image to one of those labels.
    #     Output Structure: A main folder containing subfolders for each label name, with images sorted into their respective label folders.
    # YOLO Classification Format:
    #     Asks for the label names and assigns each a numeric ID key in a dictionary (e.g., {0: "Cat", 1: "Dog"}).
    #     Asks the user to pick the numeric label ID for each image.
    #     Maps the label IDs to their assigned image filenames in a dictionary.
    #     Output Structure: A main folder containing:
    #     A single subfolder with all images.
    #     A .txt file listing label IDs and their names.
    #     A python file storing the label-to-image mapping metadata.
    items = _valid_images(images)
    if not items:
        print("No images to label.")
        return ""

    print("\nLabel format:")
    print("  1 = normal format   (one sub-folder per label: Cat/, Dog/ ...)")
    print("  2 = YOLO classification (images/ + classes.txt + label_mapping.py)")
    choice = _ask_choice("Choose: ", ["1", "2"])
    names = _ask_label_names()
    if _output_overlaps_originals(items, output_folder, names.values() if choice == "1" else ["images"]):
        return ""

    print("\nA window will open. Click a label button (or press its number key) for each image.")
    answers = _label_images_gui(items, names)
    if not answers:
        print("No image was labeled, nothing was saved.")
        return ""

    if choice == "1":
        _save_folder_format(items, answers, names, output_folder)
    else:
        _save_yolo_classification(items, answers, names, output_folder)

    counts = Counter(answers.values())
    print(f"\nSaved {len(answers)} labeled image(s) to '{output_folder}':")
    for k, name in names.items():
        print(f"  {name} (id {k}): {counts[k]} image(s)")
    print(f"Left out (skipped or not reached): {len(items) - len(answers)} image(s).")
    return output_folder


# ------------------------------------------------------------------------------------------
# 2) many labels (boxes) inside one image
# ------------------------------------------------------------------------------------------
def labes_inside_images(images, output_folder="yolo_detection_dataset"):
    # This handles multiple labels inside a single image (Object Detection):
    #     Asks the user to define the class names, mapped to numeric IDs in a dictionary.
    #     Iterates image-by-image, allowing the user to mark multiple labeled regions/bounding boxes per image.
    #     Output Format: Exports the annotations in standard YOLO bounding-box format (where each image gets a matching .txt file storing class_id x_center y_center width height coordinates normalized between 0 and 1).
    items = _valid_images(images)
    if not items:
        print("No images to label.")
        return ""

    names = _ask_label_names()                     # {0: 'Cat', 1: 'Dog', ...}
    if _output_overlaps_originals(items, output_folder, ["images", "labels"]):
        return ""
    print("\nA window will open. Pick a class, then drag the mouse over an object to draw a box.")
    annotations = _box_images_gui(items, names)
    if not annotations:
        print("No image was accepted, nothing was saved.")
        return ""

    _save_yolo_detection(items, annotations, names, output_folder)

    total_boxes = sum(len(b) for b in annotations.values())
    print(f"\nSaved {len(annotations)} image(s) with {total_boxes} box(es) to '{output_folder}'")
    print("  images/       the pictures")
    print("  labels/       one .txt per picture: class_id x_center y_center width height (0 to 1)")
    print("  classes.txt   class names (line number = class id)")
    print(f"Left out (skipped or not reached): {len(items) - len(annotations)} image(s).")
    return output_folder


# ------------------------------------------------------------------------------------------
# Run from the command line
# ------------------------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DataRefine - label an image dataset")
    parser.add_argument("folder", help="folder containing the images")
    parser.add_argument("--output", default="",
                        help="NEW folder for the labeled dataset (default depends on the labeler)")
    parser.add_argument("--clean", action="store_true",
                        help="run the Module six cleaning menu first, then label the result")
    args = parser.parse_args()

    image_list = mf.open_images(args.folder)
    if not image_list:
        print("No images found.")
    else:
        if args.clean:
            image_list = m6.clean_and_process(mf.get_information(image_list), image_list)
        print("\n1 = one label per image (Cat / Dog ...)")
        print("2 = boxes inside images (object detection)")
        if _ask_choice("Choose: ", ["1", "2"]) == "1":
            indicual_labber(image_list, args.output or "labeled_dataset")
        else:
            labes_inside_images(image_list, args.output or "yolo_detection_dataset")