import base64
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen

from fastapi.testclient import TestClient
from PIL import Image

from classifier.service import create_app


class Result:
    names = {0: "O", 1: "R"}
    class probs:
        top1 = 1
        top1conf = 0.93


class Model:
    task = "classify"
    names = Result.names
    def predict(self, *args, **kwargs):
        return [Result()]


def image_payload(format="PNG"):
    stream = io.BytesIO()
    Image.new("RGB", (20, 30)).save(stream, format=format)
    return {"image": base64.b64encode(stream.getvalue()).decode(),
            "mimeType": "image/png" if format == "PNG" else "image/jpeg"}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        temporary_root = Path(__file__).resolve().parents[1] / ".local" / "tests"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=temporary_root)
        self.path = Path(self.directory.name) / "best.pt"
        self.path.write_bytes(b"isolated fake weights, never used for actual inference")

    def tearDown(self):
        self.directory.cleanup()

    def client(self, loader=lambda _: Model(), key=""):
        return TestClient(create_app(self.path, loader, key))

    def test_prediction_contract_and_label_mapping(self):
        with self.client() as client:
            self.assertTrue(client.get("/health").json()["ready"])
            response = client.post("/predict", json=image_payload())
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(result["category"], "dry")
            self.assertEqual(result["confidence"], 0.93)
            self.assertTrue(result["modelVersion"].startswith("ecosort-yolo-"))
            self.assertTrue(result["guidance"])
            self.assertNotIn("pointsAwarded", result)

    def test_auth_and_invalid_images(self):
        with self.client(key="test-key") as client:
            self.assertEqual(client.post("/predict", json=image_payload()).status_code, 401)
            headers = {"Authorization": "Bearer test-key"}
            self.assertEqual(client.post("/predict", headers=headers, json=image_payload()).status_code, 200)
            for payload in [{"image": "!" * 30, "mimeType": "image/png"},
                            {**image_payload(), "mimeType": "image/jpeg"},
                            {**image_payload(), "mimeType": "text/html"},
                            {**image_payload(), "unexpected": True}]:
                self.assertEqual(client.post("/predict", headers=headers, json=payload).status_code, 422)
            with patch("classifier.service.Image.MAX_IMAGE_PIXELS", 100):
                self.assertEqual(client.post("/predict", headers=headers, json=image_payload()).status_code, 422)

    def test_missing_and_generic_weights_disable_predictions(self):
        generic = Model()
        generic.names = {0: "cat", 1: "dog"}
        for path, loader in [(self.path.parent / "missing.pt", lambda _: Model()),
                             (self.path, lambda _: generic)]:
            with TestClient(create_app(path, loader, "")) as client:
                self.assertEqual(client.get("/health").status_code, 503)
                self.assertEqual(client.post("/predict", json=image_payload()).status_code, 503)

    def test_inference_failure_does_not_fabricate_a_result(self):
        model = Model()
        with self.client(loader=lambda _: model) as client:
            with patch.object(model, "predict", side_effect=RuntimeError("fixture failure")):
                response = client.post("/predict", json=image_payload())
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("category", response.json())

    @unittest.skipUnless(os.getenv("ECOSYNC_REAL_CLASSIFIER_URL"), "Real service URL not configured")
    def test_bundled_images_against_real_model(self):
        root = Path(__file__).resolve().parents[1]
        images = sorted((root / "sample_images").glob("*/*.jpg"))
        self.assertEqual(len(images), 4)
        for image in images:
            request = Request(os.environ["ECOSYNC_REAL_CLASSIFIER_URL"] + "/predict",
                              data=json.dumps({"image": base64.b64encode(image.read_bytes()).decode(), "mimeType": "image/jpeg"}).encode(),
                              headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.getenv("AI_MODEL_KEY", "")})
            with urlopen(request, timeout=20) as response:
                result = json.load(response)
            self.assertIn(result["category"], ["dry", "wet"])
            self.assertTrue(0 <= result["confidence"] <= 1)
            self.assertTrue(result["modelVersion"].startswith("ecosort-yolo-"))


if __name__ == "__main__":
    unittest.main()
