import os
from pathlib import Path
import torch
from ultralytics import YOLO

def train():
    print(f"PyTorch version: {torch.__version__}")
    print(f"MPS available: {torch.backends.mps.is_available()}")
    print(f"MPS built: {torch.backends.mps.is_built()}")

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"Using device: {device}")

    dataset_path = Path("./dataset").resolve()
    print(f"Using dataset path: {dataset_path}")

    # Load YOLO11 Nano Classification model
    model = YOLO("yolo11n-cls.pt")

    # Train model
    results = model.train(
        data=str(dataset_path),
        epochs=5,
        imgsz=224,
        batch=32,
        workers=2,
        device=device,
        project="runs/classify",
        name="train",
        exist_ok=True
    )

    print("Training complete!")
    weights_path = Path("runs/classify/train/weights/best.pt")
    if weights_path.exists():
        print(f"Best model saved successfully at: {weights_path.resolve()}")
    else:
        print("Warning: best.pt was not found at standard path.")

if __name__ == "__main__":
    train()
