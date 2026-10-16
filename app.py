import os
from pathlib import Path
from PIL import Image
import streamlit as st
import torch
from ultralytics import YOLO

# Page Configuration
st.set_page_config(
    page_title="EcoSort AI • Dry vs Wet Waste Classifier",
    page_icon="♻️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom Styling
st.markdown("""
<style>
    /* Main container styling */
    .main {
        background-color: #0d1117;
    }
    
    .stApp {
        background: radial-gradient(circle at top right, #13221c, #0e1626 50%, #0a0e17 100%);
        color: #e6edf3;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    /* Hero header */
    .hero-title {
        font-size: 2.4rem;
        font-weight: 800;
        background: linear-gradient(90deg, #10b981, #06b6d4, #3b82f6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.2rem;
    }
    .hero-subtitle {
        color: #94a3b8;
        font-size: 1.05rem;
        margin-bottom: 1.5rem;
    }

    /* Result Cards */
    .waste-card {
        padding: 1.5rem;
        border-radius: 16px;
        margin-top: 1rem;
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(8px);
        text-align: center;
        transition: transform 0.2s ease;
    }
    .dry-card {
        background: linear-gradient(135deg, rgba(14, 116, 144, 0.3) 0%, rgba(30, 58, 138, 0.4) 100%);
        border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .wet-card {
        background: linear-gradient(135deg, rgba(16, 149, 106, 0.3) 0%, rgba(6, 78, 59, 0.4) 100%);
        border: 1px solid rgba(52, 211, 153, 0.3);
    }

    .badge-icon {
        font-size: 3.5rem;
        margin-bottom: 0.5rem;
    }
    .badge-text {
        font-size: 2.2rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        margin-bottom: 0.25rem;
    }
    .badge-dry {
        color: #38bdf8;
    }
    .badge-wet {
        color: #34d399;
    }

    .bin-info {
        font-size: 1rem;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 20px;
        display: inline-block;
        margin: 0.5rem 0;
    }
    .dry-bin {
        background-color: rgba(56, 189, 248, 0.2);
        color: #7dd3fc;
        border: 1px solid rgba(56, 189, 248, 0.4);
    }
    .wet-bin {
        background-color: rgba(52, 211, 153, 0.2);
        color: #a7f3d0;
        border: 1px solid rgba(52, 211, 153, 0.4);
    }

    .prob-metric {
        font-size: 1.1rem;
        color: #cbd5e1;
        margin-top: 0.8rem;
    }

    /* Guide Box */
    .info-box {
        background: rgba(30, 41, 59, 0.5);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 12px;
        padding: 1rem 1.2rem;
        margin-top: 1rem;
    }
    .info-title {
        font-weight: 700;
        color: #f1f5f9;
        margin-bottom: 0.4rem;
        font-size: 0.95rem;
    }
</style>
""", unsafe_allow_html=True)

# Device Configuration: Use MPS on Apple Silicon, fallback to CPU for Cloud
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# Primary model path in root directory
PRIMARY_MODEL_PATH = Path("./best.pt")
FALLBACK_MODEL_PATH = Path("runs/classify/train/weights/best.pt")

if PRIMARY_MODEL_PATH.exists():
    ACTIVE_MODEL_PATH = str(PRIMARY_MODEL_PATH)
elif FALLBACK_MODEL_PATH.exists():
    ACTIVE_MODEL_PATH = str(FALLBACK_MODEL_PATH)
else:
    ACTIVE_MODEL_PATH = "yolo11n-cls.pt"

@st.cache_resource
def load_classifier(weights_path_str: str):
    return YOLO(weights_path_str)

# Sidebar
with st.sidebar:
    try:
        st.image("https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&w=400&q=80", use_container_width=True)
    except Exception:
        pass
    st.title("♻️ EcoSort AI")
    st.markdown("Automated waste classification powered by **Ultralytics YOLO11**.")
    
    st.markdown("---")
    st.subheader("⚙️ System Status")
    
    hw_label = "✅ Apple MPS (GPU Acceleration)" if DEVICE == "mps" else "💻 CPU Mode (Cloud Deployment)"
    st.markdown(f"**Hardware Device:** `{DEVICE.upper()}` ({hw_label})")
    
    if Path(ACTIVE_MODEL_PATH).exists():
        st.success(f"Model Loaded: `{Path(ACTIVE_MODEL_PATH).name}`")
    else:
        st.warning("Using base model weights.")

    st.markdown("---")
    st.subheader("🗑️ Segregation Guide")
    st.markdown("""
    - **🟦 DRY WASTE (Recyclable)**:
      Paper, plastics, glass bottles, metal cans, cardboard boxes, clean foil wrappers.
    - **🟩 WET WASTE (Organic/Bio)**:
      Fruit peels, leftover food scraps, vegetable waste, tea bags, floral waste, coffee grounds.
    """)

# Main Content
st.markdown('<div class="hero-title">♻️ Dry vs. Wet Waste Classifier</div>', unsafe_allow_html=True)
st.markdown('<div class="hero-subtitle">Classify household and industrial waste in real-time to facilitate proper recycling and composting.</div>', unsafe_allow_html=True)

# Tabs for input modes
tab_upload, tab_camera, tab_samples = st.tabs(["📁 Upload Image", "📸 Live Webcam", "✨ Sample Gallery"])

selected_image = None

with tab_upload:
    uploaded_file = st.file_uploader(
        "Upload a photo of the waste item (JPG, PNG, JPEG, WEBP)", 
        type=["jpg", "jpeg", "png", "webp"],
        help="Choose a clear picture of the item for best classification accuracy."
    )
    if uploaded_file is not None:
        try:
            selected_image = Image.open(uploaded_file).convert("RGB")
        except Exception as e:
            st.error(f"Error opening image: {e}")

with tab_camera:
    st.write("Position the waste object in front of your camera and snap a photo:")
    camera_photo = st.camera_input("Take a photo")
    if camera_photo is not None:
        try:
            selected_image = Image.open(camera_photo).convert("RGB")
        except Exception as e:
            st.error(f"Error opening camera image: {e}")

with tab_samples:
    st.write("Pick a sample to test immediately:")
    
    # Check bundled sample_images folder first, then dataset/val
    sample_images = []
    for check_dir in [Path("sample_images"), Path("dataset/val")]:
        if check_dir.exists():
            for category in ["dry", "wet"]:
                cat_dir = check_dir / category
                if cat_dir.exists():
                    images = sorted(list(cat_dir.glob("*.jpg")))[:4]
                    for p in images:
                        sample_images.append((category, p))
            if sample_images:
                break
                    
    if sample_images:
        cols = st.columns(len(sample_images))
        for idx, (cat, p) in enumerate(sample_images):
            with cols[idx]:
                st.image(str(p), caption=f"Sample: {cat.upper()}", use_container_width=True)
                if st.button(f"Test #{idx+1} ({cat})", key=f"sample_{idx}"):
                    selected_image = Image.open(p).convert("RGB")
    else:
        st.info("Upload an image or snap a photo above to test classification.")

# Processing and Prediction Section
if selected_image is not None:
    st.markdown("---")
    col1, col2 = st.columns([1, 1], gap="large")

    with col1:
        st.subheader("📷 Input Image")
        st.image(selected_image, use_container_width=True)

    with col2:
        st.subheader("🔍 Classification Result")
        with st.spinner("Analyzing waste material with YOLO11..."):
            try:
                model = load_classifier(ACTIVE_MODEL_PATH)
                results = model.predict(selected_image, imgsz=224, device=DEVICE, verbose=False)
                
                # Parse classification outputs
                result = results[0]
                names = result.names
                probs = result.probs.data.cpu().numpy()
                top_index = int(result.probs.top1)
                top_name = names[top_index].lower()
                top_conf = float(result.probs.top1conf) * 100.0

                # Determine dry vs wet probability
                dry_prob = 0.0
                wet_prob = 0.0
                
                for idx, name in names.items():
                    n = str(name).lower()
                    if "dry" in n or n == "r" or "recycl" in n:
                        dry_prob = float(probs[idx]) * 100.0
                    elif "wet" in n or n == "o" or "organ" in n:
                        wet_prob = float(probs[idx]) * 100.0

                # Determine verdict
                is_dry = ("dry" in top_name) or (top_name == "r") or (dry_prob >= wet_prob)

                if is_dry:
                    verdict = "DRY WASTE"
                    badge_class = "badge-dry"
                    card_class = "dry-card"
                    bin_class = "dry-bin"
                    bin_label = "🟦 Dispose in BLUE BIN (Recyclables)"
                    icon = "📦"
                    tips = "Ensure item is clean and dry before recycling."
                else:
                    verdict = "WET WASTE"
                    badge_class = "badge-wet"
                    card_class = "wet-card"
                    bin_class = "wet-bin"
                    bin_label = "🟩 Dispose in GREEN BIN (Compostable / Organic)"
                    icon = "🍎"
                    tips = "Ideal for composting or municipal organic biogas collection."

                # Render Card
                st.markdown(f"""
                <div class="waste-card {card_class}">
                    <div class="badge-icon">{icon}</div>
                    <div class="badge-text {badge_class}">{verdict}</div>
                    <div class="bin-info {bin_class}">{bin_label}</div>
                    <div class="prob-metric">Confidence: <strong>{top_conf:.1f}%</strong></div>
                </div>
                """, unsafe_allow_html=True)

                st.markdown("### 📊 Probability Breakdown")
                
                st.write(f"**🟦 Dry / Recyclable:** `{dry_prob:.1f}%`")
                st.progress(min(max(int(dry_prob), 0), 100))
                
                st.write(f"**🟩 Wet / Organic:** `{wet_prob:.1f}%`")
                st.progress(min(max(int(wet_prob), 0), 100))

                st.markdown(f"""
                <div class="info-box">
                    <div class="info-title">💡 Actionable Recommendation:</div>
                    <div style="color: #94a3b8; font-size: 0.9rem;">{tips}</div>
                </div>
                """, unsafe_allow_html=True)

            except Exception as ex:
                st.error(f"Inference error: {ex}")
else:
    st.info("👋 Upload an image, capture with your webcam, or select a sample above to get started!")
