import os
import shutil
from pathlib import Path
import kagglehub

def setup_dataset():
    print("Downloading dataset using kagglehub...")
    download_path = kagglehub.dataset_download("techsash/waste-classification-data")
    print(f"Dataset downloaded to: {download_path}")

    root_path = Path(download_path)
    dest_base = Path("./dataset")
    
    # Destination directories
    splits = {
        "train": dest_base / "train",
        "val": dest_base / "val"
    }

    for split_dir in splits.values():
        (split_dir / "dry").mkdir(parents=True, exist_ok=True)
        (split_dir / "wet").mkdir(parents=True, exist_ok=True)

    # Let's inspect the directory structure of the downloaded dataset
    print("Inspecting downloaded files structure...")
    all_files = list(root_path.rglob("*"))
    print(f"Total entries found: {len(all_files)}")

    # Look for TRAIN and TEST folders
    # Typically: DATASET/TRAIN/O, DATASET/TRAIN/R, DATASET/TEST/O, DATASET/TEST/R
    # Mapping: 'R' (Recyclable) -> 'dry', 'O' (Organic) -> 'wet'
    # Test set will map to 'val'
    train_sources = [p for p in root_path.rglob("*") if p.is_dir() and p.name.upper() == "TRAIN"]
    test_sources = [p for p in root_path.rglob("*") if p.is_dir() and p.name.upper() in ["TEST", "VAL"]]

    if train_sources and test_sources:
        train_dir = train_sources[0]
        test_dir = test_sources[0]
    else:
        # Fallback to direct search if no TRAIN/TEST directory level
        train_dir = root_path
        test_dir = root_path

    print(f"Using train directory source: {train_dir}")
    print(f"Using val/test directory source: {test_dir}")

    # Transfer function (symlink or copy)
    def transfer_category(src_folder, target_dir, category_label):
        if not src_folder.exists():
            print(f"Warning: {src_folder} does not exist.")
            return 0
        count = 0
        for img_path in src_folder.iterdir():
            if img_path.is_file() and img_path.suffix.lower() in [".jpg", ".jpeg", ".png", ".bmp", ".webp"]:
                dest_file = target_dir / img_path.name
                if not dest_file.exists():
                    try:
                        os.symlink(img_path.resolve(), dest_file)
                    except Exception:
                        shutil.copy2(img_path, dest_file)
                count += 1
        print(f"Linked/copied {count} files for '{category_label}' into {target_dir}")
        return count

    # Search for R and O folders
    for src_split_dir, dest_split_name in [(train_dir, "train"), (test_dir, "val")]:
        r_folder = None
        o_folder = None
        for sub in src_split_dir.iterdir():
            if sub.is_dir():
                if sub.name.upper() == "R":
                    r_folder = sub
                elif sub.name.upper() == "O":
                    o_folder = sub
                elif "RECYCL" in sub.name.upper() or "DRY" in sub.name.upper():
                    r_folder = sub
                elif "ORGANIC" in sub.name.upper() or "WET" in sub.name.upper():
                    o_folder = sub

        if r_folder:
            transfer_category(r_folder, splits[dest_split_name] / "dry", f"{dest_split_name}_dry")
        if o_folder:
            transfer_category(o_folder, splits[dest_split_name] / "wet", f"{dest_split_name}_wet")

    train_dry_count = len(list((dest_base / "train" / "dry").glob("*")))
    train_wet_count = len(list((dest_base / "train" / "wet").glob("*")))
    val_dry_count = len(list((dest_base / "val" / "dry").glob("*")))
    val_wet_count = len(list((dest_base / "val" / "wet").glob("*")))

    print("\nDataset preparation completed successfully:")
    print(f"  Train -> Dry: {train_dry_count}, Wet: {train_wet_count}")
    print(f"  Val   -> Dry: {val_dry_count}, Wet: {val_wet_count}")

if __name__ == "__main__":
    setup_dataset()
