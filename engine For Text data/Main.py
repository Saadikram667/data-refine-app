"""
DataForge CLI Studio - main launcher.

    1 = Tabular data  (CSV / Excel / JSON)        -> Module_one .. Module_four   (unchanged)
    2 = Image data    (clean, label, split)       -> Module_five .. Module_eight (new)

Image flow (menu 2), in the order you normally use it:
    1  Load the image folder and check its health        (Module_five)
    2  Show the health report / save graph + table       (Module_five)
    3  Clean and process, save to a NEW folder           (Module_six)
    4  Label the images                                  (Module_seven)
    5  Split the labeled dataset into train/valid/test   (Module_eight)

The original image folder is never changed: every step writes into a NEW folder.

Run : python Main.py
"""
import os


# ==========================================================================================
# TABULAR DATA  (Modules 1-4)  - same menu as before, now reached from the main menu
# ==========================================================================================
def tabular_main():
    try:
        import matplotlib.pyplot as plt
        import Module_one as m1
        import Module_two as m2
        import Module_three as m3
        import Module_four as m4
    except ImportError as e:
        print(f"Could not load the tabular modules: {e}")
        print("Keep Module_one.py ... Module_four.py in the same folder as Main.py "
              "(and run: pip install pandas matplotlib).")
        return

    df = None
    print("\n=== TABULAR DATA (Modules 1-4) ===")

    while True:
        print("\n--- MAIN MENU ---")
        print("1. Load Dataset (Module 1)")
        print("2. Inspect & Profile Data (Module 1)")
        print("3. Clean & Preprocess Data (Module 2)")
        print("4. Generate Visualizations (Module 3)")
        print("5. Split Dataset into Train/Test/Val (Module 4)")
        print("6. Export Cleaned CSV")
        print("7. Back to main menu")
        
        choice = input("\nSelect an option (1-7): ").strip()

        # ==================== 1. LOAD DATASET ====================
        if choice == "1":
            path = input("Enter path to your dataset (.csv, .xlsx, .json): ").strip()
            try:
                df = m1.GetDataSet(path)
                print(f"Success! Loaded dataset with shape: {df.shape}")
            except Exception as e:
                print(f"Error loading dataset: {e}")

        # ==================== 2. INSPECT DATA ====================
        elif choice == "2":
            if df is None:
                print(" Please load a dataset first!")
                continue

            datainfo, highlight, col_list, dup_count = m1.PrintingInformation(df)
            
            print("\n--- COLUMN SUMMARY ---")
            for col, info in datainfo.items():
                print(f"\n[{col}]")
                for k, v in info.items():
                    print(f"  - {k}: {v}")
            
            print(f"\nTotal Duplicate Rows: {dup_count}")

            save_report = input("\nGenerate HTML report and missing values plot? (y/n): ").strip().lower()
            if save_report == 'y':
                html_path, plot_path = m1.SaveGraphAndTable(highlight, df)
                print(f" Saved HTML report to: {html_path}")
                print(f" Saved missing values plot to: {plot_path}")

        # ==================== 3. DATA CLEANING ====================
        elif choice == "3":
            if df is None:
                print(" Please load a dataset first!")
                continue

            print("\n--- CLEANING MENU ---")
            print("a. Fill Missing Values (NaN)")
            print("b. Drop Duplicate Rows")
            print("c. Rename Column")
            print("d. Swap Column Order")
            print("e. Encode Categorical Feature")
            
            clean_choice = input("Select cleaning action (a-e): ").strip().lower()

            if clean_choice == "a":
                col = input(f"Enter column name {list(df.columns)}: ").strip()
                method = input("Choose method (mean / median / mode / constant / ai): ").strip().lower()
                custom_val = "Missing"
                if method == "constant":
                    custom_val = input("Enter fill value: ").strip()
                
                df = m2.FillingNaN(df, column=col, method=method, custom_fill_value=custom_val)
                print(f" Applied '{method}' imputation on column '{col}'. Remaining nulls: {df[col].isnull().sum()}")

            elif clean_choice == "b":
                df, removed_count = m2.DeleteDuplicate(df)
                print(f" Removed {removed_count} duplicate row(s).")

            elif clean_choice == "c":
                old_name = input("Current column name: ").strip()
                new_name = input("New column name: ").strip()
                df = m2.ColumnRearrangeRenamer(df, action="rename", old_col=old_name, new_col=new_name)
                print(f" Renamed '{old_name}' to '{new_name}'.")

            elif clean_choice == "d":
                c1 = input("First column to swap: ").strip()
                c2 = input("Second column to swap: ").strip()
                df = m2.ColumnRearrangeRenamer(df, action="rearrange", col1=c1, col2=c2)
                print(f" Swapped columns '{c1}' and '{c2}'.")

            elif clean_choice == "e":
                col = input(f"Select categorical column {list(df.select_dtypes(include=['object', 'category']).columns)}: ").strip()
                method = input("Choose encoder (one-hot / ordinal / target / native): ").strip().lower()
                target_c = None
                if method == "target":
                    target_c = input("Enter target column (y): ").strip()
                
                df = m2.EnCoder(df, column=col, method=method, target_col=target_c)
                print(f" Applied {method} encoding to '{col}'.")

        # ==================== 4. VISUALIZATION ====================
        elif choice == "4":
            if df is None:
                print(" Please load a dataset first!")
                continue

            print("\n--- CHART MENU ---")
            print("a. Histogram")
            print("b. Boxplot")
            print("c. Scatter Plot")
            print("d. Correlation Heatmap")
            print("e. Line Chart")

            chart_choice = input("Select chart type (a-e): ").strip().lower()
            fig = None

            if chart_choice == "a":
                x = input("Enter X-axis column: ").strip()
                hue = input("Enter Hue/Group column (optional, press Enter to skip): ").strip() or None
                fig = m3.generate_histogram(df, x_col=x, hue_col=hue)

            elif chart_choice == "b":
                y = input("Enter Y-axis (numeric) column: ").strip()
                x = input("Enter X-axis (categorical) column (optional, press Enter to skip): ").strip() or None
                fig = m3.generate_boxplot(df, y_col=y, x_col=x)

            elif chart_choice == "c":
                x = input("Enter X-axis column: ").strip()
                y = input("Enter Y-axis column: ").strip()
                hue = input("Enter Hue column (optional, press Enter to skip): ").strip() or None
                fig = m3.generate_scatterplot(df, x_col=x, y_col=y, hue_col=hue)

            elif chart_choice == "d":
                fig = m3.generate_heatmap(df)

            elif chart_choice == "e":
                x = input("Enter X-axis column: ").strip()
                y = input("Enter Y-axis column: ").strip()
                hue = input("Enter Hue column (optional, press Enter to skip): ").strip() or None
                fig = m3.generate_linechart(df, x_col=x, y_col=y, hue_col=hue)

            if fig:
                plt.show() # Display chart interactively in window

        # ==================== 5. DATASET SPLITTING ====================
        elif choice == "5":
            if df is None:
                print(" Please load a dataset first!")
                continue

            test_s = float(input("Enter Test Set ratio (e.g. 0.2 for 20%): ") or 0.2)
            val_s = float(input("Enter Validation Set ratio (e.g. 0.1 for 10%): ") or 0.1)

            train, test, val = m4.DatasetSplitter(df, test_size=test_s, validation_size=val_s)
            
            print(f"\n Data Split Complete:")
            print(f"  - Training Set:   {train.shape[0]} rows ({train.shape[0]/len(df)*100:.1f}%)")
            print(f"  - Test Set:       {test.shape[0]} rows ({test.shape[0]/len(df)*100:.1f}%)")
            print(f"  - Validation Set: {val.shape[0]} rows ({val.shape[0]/len(df)*100:.1f}%)")

            save_splits = input("\nSave split datasets as CSV files? (y/n): ").strip().lower()
            if save_splits == 'y':
                train.to_csv("train.csv", index=False)
                test.to_csv("test.csv", index=False)
                val.to_csv("val.csv", index=False)
                print(" Saved 'train.csv', 'test.csv', and 'val.csv' to current folder.")

        # ==================== 6. EXPORT CLEANED DATA ====================
        elif choice == "6":
            if df is None:
                print(" Please load a dataset first!")
                continue
            
            output_filename = input("Enter filename to save (e.g., cleaned_data.csv): ").strip() or "cleaned_data.csv"
            df.to_csv(output_filename, index=False)
            print(f" Dataset successfully saved as '{output_filename}'!")

        # ==================== 7. EXIT ====================
        elif choice == "7":
            print("Back to the main menu.")
            break


# ==========================================================================================
# IMAGE DATA  (Modules 5-8)
# ==========================================================================================
def _clean_path(text):
    """A folder path typed or dragged into the terminal: remove quotes and spaces, expand ~."""
    return os.path.expanduser(text.strip().strip('"').strip("'").strip())


def _ask_folder(prompt, default=""):
    """Ask for a folder. Pressing Enter keeps the default (if there is one)."""
    shown = f" [{default}]" if default else ""
    return _clean_path(input(f"{prompt}{shown}: ")) or default


def image_main():
    try:
        import Module_five as mf        # open_images, get_information, SaveGraphAndTable
        import Module_six as m6         # clean and process
        import Module_seven as m7       # label
        import Module_eight as m8       # split
    except ImportError as e:
        print(f"Could not load the image modules: {e}")
        print("Keep Module_five.py ... Module_eight.py in the same folder as Main.py "
              "(and run: pip install pillow numpy matplotlib).")
        return

    images, info = [], None          # the working set of images and the report made when it was loaded
    source, labeled = "", ""         # folder that was loaded / folder made by the labeler

    print("\n=== IMAGE DATA (Modules 5-8) ===")
    while True:
        print("\n--- IMAGE MENU ---")
        if images:
            edited = sum(1 for i in images if i.get("changed"))
            print(f"[ {len(images)} images in the working set, loaded from '{source}' "
                  f"({edited} edited in memory) ]")
        else:
            print("[ no image folder loaded yet ]")
        print("1. Load image folder & check its health (Module 5)")
        print("2. Show health report / save graph and table (Module 5)")
        print("3. Clean & process images, save to a NEW folder (Module 6)")
        print("4. Label images (Module 7)")
        print("5. Split labeled dataset into Train/Valid/Test (Module 8)")
        print("6. Back to main menu")

        choice = input("\nSelect an option (1-6): ").strip()

        # ==================== 1. LOAD + HEALTH CHECK ====================
        if choice == "1":
            folder = _ask_folder("Enter path to your image folder")
            if not folder:
                continue
            if not os.path.isdir(folder):
                print(f" Folder not found: {folder}")
                continue
            print("Reading images (this can take a while for big folders)...")
            loaded = mf.open_images(folder)
            if not loaded:
                print(" No images found in that folder.")
                continue
            images, source = loaded, folder
            info = mf.get_information(images)
            mf.print_report(info)
            gb = sum(i["image"].nbytes for i in images if i["image"] is not None) / 1024 ** 3
            print(f"\nLoaded {len(images)} files. All pixels are kept in memory ({gb:.2f} GB).")

        # ==================== 2. REPORT / GRAPH + TABLE ====================
        elif choice == "2":
            if not images:
                print(" Please load an image folder first!")
                continue
            mf.print_report(info)
            if any(i.get("changed") for i in images):
                print("\n(This report describes the folder as it was loaded, before your edits. "
                      "To check the cleaned result, load the cleaned folder with option 1.)")
            if input("\nSave the health graph and the per-image table? (y/n): ").strip().lower() == "y":
                out = _ask_folder("Folder to save them in", "output")
                png, table = mf.SaveGraphAndTable(info, out)
                print(f" Saved graph: {png}")
                print(f" Saved table: {table}")

        # ==================== 3. CLEAN & PROCESS ====================
        elif choice == "3":
            if not images:
                print(" Please load an image folder first!")
                continue
            out = _ask_folder("NEW folder for the cleaned images", "cleaned_dataset")
            images = m6.clean_and_process(info, images, out)

        # ==================== 4. LABEL ====================
        elif choice == "4":
            if not images:
                print(" Please load an image folder first!")
                continue
            print("\n--- LABEL MENU ---")
            print("1. One label per image            (Cat / Dog ...)")
            print("2. Boxes inside images            (object detection, YOLO)")
            print("0. Cancel")
            kind = m6._ask_choice("Choose: ", ["1", "2", "0"])
            if kind == "0":
                continue
            default = "labeled_dataset" if kind == "1" else "yolo_detection_dataset"
            out = _ask_folder("NEW folder for the labeled dataset", default)
            labeler = m7.indicual_labber if kind == "1" else m7.labes_inside_images
            try:
                done = labeler(images, out)
            except Exception as e:      # most often: no tkinter / no screen for the labeling window
                print(f" Labeling stopped: {type(e).__name__}: {e}")
                print(" (The labeling window needs tkinter and a screen. On Linux: sudo apt install python3-tk)")
                done = ""
            if done:
                labeled = done

        # ==================== 5. SPLIT ====================
        elif choice == "5":
            folder = _ask_folder("Labeled dataset folder (made by option 4)", labeled)
            if not folder or not os.path.isdir(folder):
                print(f" Folder not found: {folder or '(none given)'}")
                continue
            kind = m8.detect_structure(folder)
            print({1: "Detected: folder-based dataset (one sub-folder per label)",
                   2: "Detected: YOLO classification dataset (images + label_mapping.py)",
                   3: "Detected: YOLO object detection dataset (images + labels)"}[kind])
            out = _ask_folder("NEW folder for the split dataset", os.path.normpath(folder) + "_split")
            run = {1: m8.split_condition_1, 2: m8.split_condition_2, 3: m8.split_condition_3}[kind]
            run(folder, out, None, 42)      # None = ask for the train / valid / test percentages

        # ==================== 6. BACK ====================
        elif choice == "6":
            print("Back to the main menu.")
            break

        else:
            print(" Please choose a number from 1 to 6.")


# ==========================================================================================
# MAIN MENU
# ==========================================================================================
def main():
    print("==================================================")
    print("      Welcome to DataForge CLI Studio             ")
    print("==================================================")

    while True:
        print("\n--- MAIN MENU ---")
        print("1. Tabular data  (CSV / Excel / JSON)   - Modules 1-4")
        print("2. Image data    (clean, label, split)  - Modules 5-8")
        print("3. Exit")

        choice = input("\nSelect an option (1-3): ").strip()

        if choice == "1":
            tabular_main()
        elif choice == "2":
            image_main()
        elif choice == "3":
            print("Exiting DataForge CLI Studio. Goodbye!")
            break
        else:
            print(" Please choose 1, 2 or 3.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nExiting DataForge CLI Studio. Goodbye!")