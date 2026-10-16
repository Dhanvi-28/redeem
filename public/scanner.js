// Own camera tracks and object URLs for exactly one mounted scan page.
function mountScanner({ configured, api, notice, escape, bindForm }) {
  const find = selector => document.querySelector(selector);
  const upload = find('#image'), preview = find('#preview'), video = find('#camera-video');
  const camera = find('#capture'), snap = find('#take-photo'), stop = find('#stop-camera');
  const status = find('#camera-status'), resultBox = find('#scan-result'), submit = find('#classify');
  let selected = null, previewUrl = null, stream = null, disposed = false, request = 0, selecting = 0;
  function closeCamera() {
    request++;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null; video.srcObject = null; video.hidden = true; snap.hidden = stop.hidden = true;
    camera.disabled = false; camera.textContent = 'Use camera';
  }
  function select(file) {
    if (disposed || !file) return;
    selecting++; resultBox.innerHTML = ''; selected = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; preview.hidden = true; preview.removeAttribute('src');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 12 || file.size > 5 * 1024 * 1024) {
      upload.value = ''; submit.disabled = true; notice('Choose a JPEG, PNG or WebP image up to 5 MB.'); return;
    }
    selected = file; previewUrl = URL.createObjectURL(file); preview.src = previewUrl; preview.hidden = false; submit.disabled = !configured;
  }
  preview.onerror = () => {
    if (disposed) return;
    selected = null; selecting++; preview.hidden = true; submit.disabled = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; preview.removeAttribute('src'); upload.value = '';
    notice('This image cannot be decoded. Choose a valid JPEG, PNG or WebP.');
  };
  upload.onchange = e => { closeCamera(); status.textContent = ''; select(e.target.files[0]); };
  camera.onclick = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Live camera requires a supported browser on HTTPS or localhost. You can upload an image instead.'; return;
    }
    closeCamera(); const current = request;
    camera.disabled = true; status.textContent = 'Waiting for camera permission…';
    try {
      const incoming = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (disposed || current !== request) { incoming.getTracks().forEach(track => track.stop()); return; }
      stream = incoming; video.srcObject = stream; video.hidden = false; stop.hidden = false;
      await video.play();
      if (disposed || current !== request) return;
      snap.hidden = false; status.textContent = 'Position the item in the preview, then choose Take photo.';
    } catch (e) {
      if (disposed || current !== request) return;
      closeCamera();
      status.textContent = e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings or upload an image.' : e.name === 'NotFoundError' ? 'No camera was found. Connect a camera or upload an image.' : 'Camera could not start. It may be in use by another app. Try again or upload an image.';
    }
  };
  stop.onclick = () => { closeCamera(); status.textContent = 'Camera stopped.'; };
  snap.onclick = () => {
    if (!stream || !video.videoWidth || !video.videoHeight) { status.textContent = 'Camera is not ready yet. Wait for the preview.'; return; }
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const current = request;
    canvas.toBlob(blob => {
      if (disposed || current !== request) return;
      if (!blob) { status.textContent = 'Unable to capture this frame. Try again.'; return; }
      closeCamera(); upload.value = ''; select(blob); status.textContent = 'Photo captured. Review it below or use the camera again.';
    }, 'image/jpeg', .9);
  };
  submit.disabled = true;
  bindForm('#scan-form', async () => {
    if (!configured) throw new Error('AI classification is not configured.');
    if (!selected) throw new Error('Choose or capture a supported image first.');
    const file = selected, revision = selecting;
    closeCamera();
    upload.disabled = camera.disabled = true; resultBox.innerHTML = '<p role="status">Classifying image…</p>';
    try {
      const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Unable to read this image. Try selecting it again.')); reader.readAsDataURL(file); });
      const result = await api('/scan', { method: 'POST', body: { image, mimeType: file.type } });
      if (disposed || revision !== selecting) return;
      resultBox.innerHTML = `<div class="info"><h2>${escape(result.category)}</h2>${result.confidence !== undefined ? `<p>Confidence: ${(result.confidence * 100).toFixed(1)}%</p>` : ''}<p>Model: ${escape(result.modelVersion)}</p>${(result.guidance || []).map(g => `<p>${escape(g)}</p>`).join('')}<p>No points awarded.</p></div>`;
    } catch (e) { if (!disposed) { resultBox.innerHTML = ''; throw e; } }
    finally { if (!disposed) { upload.disabled = false; camera.disabled = Boolean(stream); } }
  });
  return () => { disposed = true; closeCamera(); if (previewUrl) URL.revokeObjectURL(previewUrl); };
}
