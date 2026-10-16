"""Private dry/wet prediction service for EcoSync's existing scanner contract."""
import base64
import binascii
import hashlib
import io
import logging
import math
import os
import secrets
import threading
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 5 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16_000_000
LABELS = {"dry": "dry", "r": "dry", "recyclable": "dry", "recyclable waste": "dry",
          "wet": "wet", "o": "wet", "organic": "wet", "organic waste": "wet"}
GUIDANCE = {
    "dry": ["Dry waste predicted. Check local recycling rules; this model cannot identify individual materials.",
            "Keep accepted recyclables clean and dry."],
    "wet": ["Wet / organic waste predicted. Check local composting or organic collection rules.",
            "Keep organic waste separate from dry recyclables."],
}


class ScanInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    image: str = Field(min_length=16, max_length=7_000_000)
    mimeType: str


def decode_image(data: ScanInput):
    formats = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
    if data.mimeType not in formats:
        raise HTTPException(422, "Use a JPEG, PNG or WebP image.")
    try:
        raw = base64.b64decode(data.image, validate=True)
        if not 12 <= len(raw) <= MAX_BYTES:
            raise ValueError("Image size")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format != formats[data.mimeType]:
                    raise ValueError("Image type mismatch")
                if source.width * source.height > Image.MAX_IMAGE_PIXELS:
                    raise ValueError("Image dimensions")
                source.load()
                return ImageOps.exif_transpose(source).convert("RGB")
    except (ValueError, binascii.Error, OSError, UnidentifiedImageError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "Invalid image, mismatched type, or image exceeds 5 MB / 16 megapixels.") from None


def create_app(model_path=None, model_loader=None, api_key=None):
    path = Path(model_path or os.getenv("CLASSIFIER_MODEL_PATH") or ROOT / "best.pt")
    if not path.is_absolute():
        path = ROOT / path
    key = os.getenv("AI_MODEL_KEY", "") if api_key is None else api_key
    model = None
    version = None
    message = "Classifier model is unavailable."
    lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        nonlocal model, version, message
        try:
            if not path.is_file():
                raise ValueError("Trained model file is missing. Set CLASSIFIER_MODEL_PATH to best.pt.")
            if model_loader is None:
                from ultralytics import YOLO
                loaded = YOLO(str(path))
            else:
                loaded = model_loader(str(path))
            names = loaded.names.values() if isinstance(loaded.names, dict) else loaded.names
            categories = [LABELS.get(str(name).strip().lower()) for name in names]
            if loaded.task != "classify" or len(categories) != 2 or set(categories) != {"dry", "wet"}:
                raise ValueError("Model must be a two-class dry/wet classifier; generic weights are unsupported.")
            version = "ecosort-yolo-" + hashlib.sha256(path.read_bytes()).hexdigest()[:16]
            # Warm up before reporting ready; no downloads or generic-model fallback.
            loaded.predict(Image.new("RGB", (224, 224)), imgsz=224,
                           device=os.getenv("CLASSIFIER_DEVICE", "cpu"), verbose=False)
            model = loaded
            message = "Dry/wet classifier ready. Photo scans do not award points."
        except Exception:
            logging.exception("Classifier startup failed")
            message = "Classifier could not load trained dry/wet weights. Check the service logs and CLASSIFIER_MODEL_PATH."
        yield
        model = None

    app = FastAPI(title="EcoSync classifier", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.get("/health")
    def health():
        return JSONResponse(status_code=200 if model is not None else 503,
                            content={"ready": model is not None, "message": message,
                                     "categories": ["dry", "wet"], "modelVersion": version})

    @app.post("/predict")
    def predict(data: ScanInput, authorization: str = Header(default="")):
        if key and not secrets.compare_digest(authorization, "Bearer " + key):
            raise HTTPException(401, "Classifier authorization required.")
        if model is None:
            raise HTTPException(503, message)
        image = decode_image(data)
        try:
            with lock:
                result = model.predict(image, imgsz=224, device=os.getenv("CLASSIFIER_DEVICE", "cpu"), verbose=False)[0]
                category = LABELS[str(result.names[int(result.probs.top1)]).strip().lower()]
                confidence = float(result.probs.top1conf)
            if not math.isfinite(confidence) or not 0 <= confidence <= 1:
                raise ValueError("Invalid confidence")
            return {"category": category, "confidence": confidence, "modelVersion": version,
                    "guidance": GUIDANCE[category]}
        except Exception:
            logging.exception("Classifier inference failed")
            raise HTTPException(503, "Classifier inference failed. Try again later.") from None
        finally:
            image.close()

    return app


app = create_app()
