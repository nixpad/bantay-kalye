// Photos are shrunk on the phone before upload: lighter on mobile data, and
// re-encoding through a canvas drops the camera's GPS metadata.

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const dims = (img) => [img.naturalWidth || img.width, img.naturalHeight || img.height];

function toBlob(canvas, q) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', q));
}

async function resized(img, max, q) {
  const [w, h] = dims(img);
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return toBlob(c, q);
}

async function squared(img, size, q) {
  const [w, h] = dims(img);
  const m = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(img, (w - m) / 2, (h - m) / 2, m, m, 0, 0, size, size);
  return toBlob(c, q);
}

/** Returns {full, thumb} JPEG blobs, full under ~250 KB. */
export async function preparePhoto(file) {
  const img = await loadImage(file);
  let q = 0.78;
  let full = await resized(img, 1280, q);
  while (full.size > 250_000 && q > 0.4) {
    q -= 0.1;
    full = await resized(img, 1080, q);
  }
  const thumb = await squared(img, 320, 0.72);
  return { full, thumb };
}
