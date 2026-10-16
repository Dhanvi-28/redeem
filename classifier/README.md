# EcoSort classifier integration

EcoSync's existing Scan & Reimagine page sends uploads and camera photos to its authenticated `/api/scan` route. Express calls this Python service, which loads the same root `best.pt` used by `app.py`. The hosted Streamlit page is a separate UI, not a prediction API. No Streamlit scraping, remote photo uploads, or iframe is needed.

## Local setup

Python 3.10–3.12 is recommended. From the repository root:

```powershell
npm run setup
npm run classifier:setup
npm run classifier
```

Keep the classifier running. In another terminal, start MongoDB with `npm run db:local` if needed, then run `npm start` in another terminal. Sign in and open **Scan & Reimagine**. Upload a JPEG, PNG or WebP up to 5 MB / 16 megapixels, or use the camera on localhost / HTTPS. Scans return dry/wet, confidence, the model's hash identifier and general disposal guidance. Photos never credit the wallet.

Setup installs dependencies in `.local/classifier-venv` and fills empty or absent `AI_MODEL_ENDPOINT` / `AI_HEALTH_ENDPOINT` entries in an existing `.env`. It preserves configured endpoints and credentials. Manually configure these when connecting a different service:

```dotenv
AI_MODEL_ENDPOINT=http://127.0.0.1:8001/predict
AI_HEALTH_ENDPOINT=http://127.0.0.1:8001/health
CLASSIFIER_MODEL_PATH=best.pt
CLASSIFIER_PORT=8001
CLASSIFIER_DEVICE=cpu
```

Relative model paths resolve against the repository root. `CLASSIFIER_PYTHON` overrides the virtual environment executable. `CLASSIFIER_HOST` defaults to `127.0.0.1`. If `AI_MODEL_KEY` is set, Express sends it as a Bearer token and the classifier requires it on `/predict`. `/health` is read-only and reveals readiness and categories, not credentials or model paths.

The service validates image decoding, type, size and dimensions; serializes inference for the shared model; and keeps images in memory without saving them. Missing, incompatible or non-dry/wet weights make health return 503 and disable classification in EcoSync. There is no automatic download of substitute model weights. Restart the service after replacing weights or changing its environment. The first startup warms up the model before reporting ready.

## Deployment

Run the Python service separately from the Node web service; the existing Node-only Render blueprint does not install Python/PyTorch. On a Python host, install `classifier/requirements.txt`, include `best.pt`, and launch `python -m uvicorn classifier.service:app --host 0.0.0.0 --port 8001 --limit-concurrency 8` from the root. Configure matching API keys, HTTPS or a private network, ingress request-body limits (8 MB), and service-side rate limits for any externally reachable deployment. Set EcoSync's AI endpoint URLs to that service and restart Node. Allow CPU/model memory and startup time; sleeping services may exceed the scanner's 20-second timeout. Do not point EcoSync at the Streamlit webpage URL.

The model predicts two broad categories only. It does not establish recycling eligibility, identify eight material types, measure weight, confirm sorting, or validate physical deposits. Four bundled sample photos are smoke tests, not an independent accuracy evaluation.

## Verification

```powershell
.local/classifier-venv/Scripts/python.exe -m unittest discover -s classifier -p "test_*.py"
npm run check
npm test
```

On macOS/Linux use `.local/classifier-venv/bin/python`. API tests use isolated fake models to check failure handling and input boundaries. Set `ECOSYNC_REAL_CLASSIFIER_URL=http://127.0.0.1:8001` when running the Python tests to also check all four bundled images against a running real service. Include `AI_MODEL_KEY` in the environment if configured. The real-service test asserts valid model predictions, not sample-label accuracy.
