"""
DataRefine - Image Part - Module 2: clean and process the dataset.

    delete_duplicate_and_corrupted(info, images) -> images
    Chnage_Color_mode(info, images)              -> images
    sharpen_blure_state(info, images)            -> images
    Chnage_size_and_resolution_megapixels_brightness(info, images) -> images
    change_format(info, images)                  -> images
    save_images(images, output_folder)           -> saves everything into a NEW folder
    clean_and_process(info, images, output)      -> menu that runs all of the above

`info` and `images` come from Module_five (get_information / open_images).
Every function returns the updated list of images, so the steps can be chained.

The original folder is NEVER changed or deleted from. All changes happen in memory,
and the final result (changed + unchanged images) is written to a new folder,
ready to be used for training a model.

Install : pip install pillow numpy matplotlib
Run     : python Module_six.py <folder> [--output cleaned_dataset]
"""
import argparse
import os
import shutil

import numpy as np
from PIL import Image, ImageFilter

import Module_five as mf


# ------------------------------------------------------------------------------------------
# small helpers (asking the user, copying items, describing an image)
# ------------------------------------------------------------------------------------------
def _ask_choice(prompt, choices):
    """Keep asking until the user types one of the allowed choices."""
    choices = [c.lower() for c in choices]
    while True:
        answer = input(prompt).strip().lower()
        if answer in choices:
            return answer
        print(f"  Please type one of: {', '.join(choices)}")


def _ask_number(prompt):
    """Keep asking until the user types a number bigger than 0."""
    while True:
        try:
            value = float(input(prompt).strip())
            if value > 0:
                return value
        except ValueError:
            pass
        print("  Please type a number bigger than 0.")


def _rows_by_path(info):
    """Per-image rows from get_information, found by file path."""
    return {r["path"]: r for r in info["images"]}


def _with_image(item, new_array):
    """Copy of an image record with a new pixel array, marked as changed."""
    new_item = dict(item)
    new_item["image"] = new_array
    new_item["changed"] = True
    return new_item


def _describe(arr):
    """Short text: size, colour mode and brightness (used to show every change)."""
    h, w = arr.shape[:2]
    return f"{w}x{h}, {mf._color_mode(arr)}, brightness {mf._to_gray(arr).mean():.0f}"


def _apply_to_all(images, func, what):
    """Run func(array) on every valid image, then print how many changed and one example.
    If func returns the same array, nothing was needed and the image stays untouched."""
    result, changed, example = [], 0, ""
    for item in images:
        if item["image"] is None:                 # corrupted file kept by the user
            result.append(item)
            continue
        before = item["image"]
        after = func(before)
        if after is before:
            result.append(item)
            continue
        result.append(_with_image(item, after))
        changed += 1
        if not example:
            example = f"{item['filename']}: {_describe(before)}  ->  {_describe(after)}"
    print(f"  {what}: {changed} image(s) changed")
    if example:
        print(f"  Example: {example}")
    return result


# ------------------------------------------------------------------------------------------
# 1) duplicates and corrupted files
# ------------------------------------------------------------------------------------------
def delete_duplicate_and_corrupted(info, images):
    # in this the dublicate images will be asked if ther want to delete it or keep it
    # also there will be an option to delete the correpted files
    # also it will show the image which are dublicates (for web app don't built this now only this line)
    rows = _rows_by_path(info)
    corrupted = [i for i in images if i["corrupted"]]
    duplicates = [i for i in images if not i["corrupted"]
                  and rows.get(i["path"], {}).get("duplicate_of")]
    remove = set()                                # paths that will not be saved

    # ---- corrupted files ----
    print(f"\nCorrupted files : {len(corrupted)}")
    if corrupted:
        if _ask_choice("  Delete them from the cleaned dataset? (d = delete, k = keep): ",
                       ["d", "k"]) == "d":
            remove.update(i["path"] for i in corrupted)

    # ---- exact duplicates (the first copy is always kept) ----
    print(f"Duplicate files : {len(duplicates)}")
    if duplicates:
        choice = _ask_choice("  a = delete all duplicates, k = keep all, o = ask one by one: ",
                             ["a", "k", "o"])
        if choice == "a":
            remove.update(i["path"] for i in duplicates)
        elif choice == "o":
            for item in duplicates:
                same_as = rows[item["path"]]["duplicate_of"]
                print(f"  {item['filename']} is a copy of {same_as}")
                if _ask_choice("    d = delete, k = keep: ", ["d", "k"]) == "d":
                    remove.add(item["path"])

    result = [i for i in images if i["path"] not in remove]
    print(f"Removed {len(images) - len(result)} file(s) from the cleaned dataset "
          f"(the original folder is not touched).")
    return result


# ------------------------------------------------------------------------------------------
# 2) colour mode
# ------------------------------------------------------------------------------------------
def _to_rgb(arr):
    if arr.ndim == 2:                             # grayscale -> 3 equal channels
        return np.stack([arr] * 3, axis=2)
    return arr[..., :3]                           # RGBA -> RGB (alpha dropped)


def Chnage_Color_mode(info, images):
    # in this we could change the color modes of the images like RGB to BGR or to BGR to Gryscale and common colors used in model trainning
    print("\nColour mode:")
    print("  1 = RGB        (most common for model training)")
    print("  2 = Grayscale  (1 channel, smaller and faster to train)")
    print("  3 = BGR        (OpenCV order; saved files will look colour-swapped in normal viewers)")
    print("  0 = cancel")
    choice = _ask_choice("Choose: ", ["1", "2", "3", "0"])

    if choice == "1":
        def to_rgb(a):
            if a.ndim == 3 and a.shape[2] == 3:
                return a                          # already RGB
            return np.ascontiguousarray(_to_rgb(a))
        return _apply_to_all(images, to_rgb, "Converted to RGB")
    if choice == "2":
        def to_gray(a):
            if a.ndim == 2:
                return a                          # already grayscale
            gray = a[..., :3] @ np.array([0.299, 0.587, 0.114])
            return np.clip(gray, 0, 255).astype(np.uint8)
        return _apply_to_all(images, to_gray, "Converted to Grayscale")
    if choice == "3":
        def to_bgr(a):
            return np.ascontiguousarray(_to_rgb(a)[..., ::-1])
        return _apply_to_all(images, to_bgr, "Converted to BGR")
    return images


# ------------------------------------------------------------------------------------------
# 3) blurry images
# ------------------------------------------------------------------------------------------
def sharpen_blure_state(info, images):
    # in this a user can chnage or delete the blured images
    # also show the blure image and its stae and show what the changes occures when changeing the blures (for web app don't built this now only this line)
    rows = _rows_by_path(info)

    def state(item):                              # "Sharp", "Blurry", "Very Blurry", "Blank"
        return item.get("blur_state") or rows.get(item["path"], {}).get("blur_state", "")

    blurry = [i for i in images if i["image"] is not None and state(i) in ("Blurry", "Very Blurry")]
    blank = [i for i in images if i["image"] is not None and state(i) == "Blank"]
    print(f"\nBlurry images : {len(blurry)}   Blank images : {len(blank)}")
    if not blurry and not blank:
        print("  Nothing to fix.")
        return images

    remove, sharpen = set(), set()
    if blurry:
        choice = _ask_choice("  Blurry images: d = delete, s = sharpen them, k = keep: ",
                             ["d", "s", "k"])
        if choice == "d":
            remove.update(i["path"] for i in blurry)
        elif choice == "s":
            sharpen.update(i["path"] for i in blurry)
    if blank:
        if _ask_choice("  Blank images (one flat colour): d = delete, k = keep: ",
                       ["d", "k"]) == "d":
            remove.update(i["path"] for i in blank)

    result, before_scores, after_scores = [], [], []
    for item in images:
        if item["path"] in remove:
            continue
        if item["path"] in sharpen:
            before = item["image"]
            after = np.array(Image.fromarray(before).filter(
                ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3)))
            before_scores.append(mf._blur_score(mf._to_gray(before)))
            after_scores.append(mf._blur_score(mf._to_gray(after)))
            item = _with_image(item, after)
            item["blur_state"] = "Sharpened"      # so it is not offered again
        result.append(item)

    print(f"  Deleted {len(remove)} image(s), sharpened {len(sharpen)} image(s).")
    if before_scores:
        print(f"  Average blur score: {np.mean(before_scores):.1f} -> {np.mean(after_scores):.1f} "
              f"(higher = sharper, sharp images are above {mf.BLUR_THRESHOLD:.0f})")
        print("  Note: sharpening helps, but it cannot bring back detail that was never there.")
    return result


# ------------------------------------------------------------------------------------------
# 4) size, resolution, megapixels, brightness
# ------------------------------------------------------------------------------------------
def _resizer(get_size):
    """Make a function that resizes an array. get_size(w, h) -> (new_w, new_h).
    LANCZOS resampling is used because it keeps edges (sharpness) as well as possible."""
    def run(arr):
        h, w = arr.shape[:2]
        new_w, new_h = get_size(w, h)
        new_w, new_h = max(1, int(round(new_w))), max(1, int(round(new_h)))
        if (new_w, new_h) == (w, h):
            return arr
        return np.array(Image.fromarray(arr).resize((new_w, new_h), Image.LANCZOS))
    return run


def _brightness(factor):
    """Make a function that multiplies the brightness (1.0 = same). Alpha is left alone."""
    def run(arr):
        if factor == 1.0:
            return arr
        out = arr.astype(np.float32)
        if out.ndim == 3:
            out[..., :3] *= factor
        else:
            out *= factor
        return np.clip(out, 0, 255).astype(np.uint8)
    return run


def Chnage_size_and_resolution_megapixels_brightness(info, images):
    # this the most important part
    # in this there are options like
    # resize images using persent or by height or width
    # chnage resilutions and megapixle keeping the sharpen untouch
    # change the brightness
    # and every changes will be shown (for web app don't built this now only this line)
    while True:
        print("\nSize / resolution / brightness:")
        print("  1 = resize by percent        (50 = half size)")
        print("  2 = resize by width          (height follows, ratio kept)")
        print("  3 = resize by height         (width follows, ratio kept)")
        print("  4 = exact width and height   (e.g. 224 x 224 for a model, ratio NOT kept)")
        print("  5 = change megapixels        (ratio kept)")
        print("  6 = change brightness        (1.0 = same, 1.2 = 20% brighter, 0.8 = darker)")
        print("  0 = done")
        choice = _ask_choice("Choose: ", ["1", "2", "3", "4", "5", "6", "0"])

        if choice == "0":
            return images
        if choice == "1":
            pct = _ask_number("  Percent: ")
            func = _resizer(lambda w, h: (w * pct / 100, h * pct / 100))
            images = _apply_to_all(images, func, f"Resized to {pct:g}%")
        elif choice == "2":
            new_w = _ask_number("  New width in pixels: ")
            func = _resizer(lambda w, h: (new_w, h * new_w / w))
            images = _apply_to_all(images, func, f"Resized to width {new_w:g}")
        elif choice == "3":
            new_h = _ask_number("  New height in pixels: ")
            func = _resizer(lambda w, h: (w * new_h / h, new_h))
            images = _apply_to_all(images, func, f"Resized to height {new_h:g}")
        elif choice == "4":
            new_w = _ask_number("  New width in pixels: ")
            new_h = _ask_number("  New height in pixels: ")
            func = _resizer(lambda w, h: (new_w, new_h))
            images = _apply_to_all(images, func, f"Resized to {new_w:g}x{new_h:g}")
        elif choice == "5":
            target = _ask_number("  Target megapixels (e.g. 0.25): ")
            def get_size(w, h):
                scale = (target * 1e6 / (w * h)) ** 0.5
                return w * scale, h * scale
            images = _apply_to_all(images, _resizer(get_size), f"Changed to ~{target:g} MP")
        elif choice == "6":
            factor = _ask_number("  Brightness factor: ")
            images = _apply_to_all(images, _brightness(factor), f"Brightness x{factor:g}")


# ------------------------------------------------------------------------------------------
# 5) file format
# ------------------------------------------------------------------------------------------
def change_format(info, images):
    # this will allow user to chage the format of the images
    formats = {"1": ".jpg", "2": ".png", "3": ".bmp", "4": ".webp", "5": ".tiff"}
    print("\nFile format:")
    for key, ext in formats.items():
        print(f"  {key} = {ext}")
    print("  0 = cancel")
    choice = _ask_choice("Choose: ", list(formats) + ["0"])
    if choice == "0":
        return images

    new_ext, result, count = formats[choice], [], 0
    for item in images:
        current = item.get("new_extension", item["extension"])
        same = current == new_ext or {current, new_ext} == {".jpg", ".jpeg"}
        if item["image"] is None or same:         # corrupted files cannot be converted
            result.append(item)
            continue
        new_item = dict(item)
        new_item["new_extension"] = new_ext
        new_item["changed"] = True
        result.append(new_item)
        count += 1
    print(f"  {count} image(s) will be saved as {new_ext}")
    if new_ext == ".jpg":
        print("  (JPG has no transparency, so RGBA images will lose their alpha channel)")
    return result


# ------------------------------------------------------------------------------------------
# save everything into a new folder
# ------------------------------------------------------------------------------------------
PIL_FORMATS = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".bmp": "BMP",
               ".gif": "GIF", ".tif": "TIFF", ".tiff": "TIFF", ".webp": "WEBP"}


def save_images(images, output_folder="cleaned_dataset"):
    """Save all images (changed and unchanged) into a NEW folder.
    - sub-folders (for example Cat / Dog classes) are kept, so labels still work
    - unchanged images are copied byte-for-byte (no quality loss from re-saving)
    - changed images are saved from the edited pixels
    Returns (saved_count, failed_count)."""
    if not images:
        print("No images to save.")
        return 0, 0

    folders = [os.path.dirname(os.path.abspath(i["path"])) for i in images]
    try:
        root = os.path.commonpath(folders)
    except ValueError:                            # images on different drives
        root = ""

    # safety: never write into the original dataset folder (changed images would overwrite the originals)
    out_abs = os.path.normcase(os.path.abspath(output_folder))
    if out_abs in {os.path.normcase(f) for f in folders + [root] if f}:
        print("The output folder is the original dataset folder. Choose a NEW folder so the "
              "original images stay untouched. Nothing was saved.")
        return 0, 0

    os.makedirs(output_folder, exist_ok=True)
    used, saved, failed, edited = set(), 0, 0, 0

    for item in images:
        folder = os.path.dirname(os.path.abspath(item["path"]))
        rel = os.path.relpath(folder, root) if root else "."
        target_dir = os.path.normpath(os.path.join(output_folder, rel))
        os.makedirs(target_dir, exist_ok=True)

        ext = item.get("new_extension", item["extension"])
        stem = os.path.splitext(item["filename"])[0]
        target, n = os.path.join(target_dir, stem + ext), 1
        while target.lower() in used:             # two files with the same name
            target = os.path.join(target_dir, f"{stem}_{n}{ext}")
            n += 1
        used.add(target.lower())

        if os.path.exists(target) and os.path.samefile(target, item["path"]):   # last safety net
            failed += 1
            print(f"  Skipped {item['filename']}: saving it would overwrite the original file.")
            continue

        try:
            if item["image"] is None or not item.get("changed"):
                shutil.copy2(item["path"], target)        # untouched -> plain copy
            else:
                fmt = PIL_FORMATS.get(ext, "PNG")
                pil = Image.fromarray(np.ascontiguousarray(item["image"]))
                if fmt in ("JPEG", "BMP") and pil.mode == "RGBA":
                    pil = pil.convert("RGB")
                options = {"quality": 95} if fmt in ("JPEG", "WEBP") else {}
                pil.save(target, fmt, **options)
                edited += 1
            saved += 1
        except Exception as e:
            failed += 1
            print(f"  Could not save {item['filename']}: {type(e).__name__}: {e}")

    print(f"\nSaved {saved} image(s) to '{output_folder}' "
          f"({edited} edited, {saved - edited} unchanged, {failed} failed).")
    return saved, failed


# ------------------------------------------------------------------------------------------
# menu that runs the whole module
# ------------------------------------------------------------------------------------------
def clean_and_process(info, images, output_folder="cleaned_dataset"):
    """Let the user pick the cleaning steps in any order, then save the result."""
    if not images:
        print("No images to process.")
        return images

    while True:
        print("\n" + "=" * 56)
        print(f" CLEAN AND PROCESS  ({len(images)} images in the working set)")
        print("=" * 56)
        print("  1 = delete duplicate / corrupted images")
        print("  2 = change colour mode")
        print("  3 = fix blurry images")
        print("  4 = size, resolution, megapixels, brightness")
        print("  5 = change file format")
        print("  6 = SAVE to new folder and finish")
        print("  7 = exit without saving")
        choice = _ask_choice("Choose: ", ["1", "2", "3", "4", "5", "6", "7"])

        if choice == "1":
            images = delete_duplicate_and_corrupted(info, images)
        elif choice == "2":
            images = Chnage_Color_mode(info, images)
        elif choice == "3":
            images = sharpen_blure_state(info, images)
        elif choice == "4":
            images = Chnage_size_and_resolution_megapixels_brightness(info, images)
        elif choice == "5":
            images = change_format(info, images)
        elif choice == "6":
            save_images(images, output_folder)
            return images
        else:
            print("Exited without saving.")
            return images


# ------------------------------------------------------------------------------------------
# Run from the command line
# ------------------------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DataRefine - clean and process an image dataset")
    parser.add_argument("folder", help="folder containing the images")
    parser.add_argument("--output", default="cleaned_dataset",
                        help="NEW folder for the cleaned images (default: cleaned_dataset)")
    args = parser.parse_args()

    image_list = mf.open_images(args.folder)
    if not image_list:
        print("No images found.")
    else:
        dataset_info = mf.get_information(image_list)
        mf.print_report(dataset_info)
        clean_and_process(dataset_info, image_list, args.output)