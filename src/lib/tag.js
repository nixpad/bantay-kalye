import qrcode from 'qrcode-generator';
import { siteUrl } from './supabase.js';
import { tagLabel, speciesWord } from './util.js';

export const tagUrl = (id) => `${siteUrl}/a/${String(id).toUpperCase()}`;

function makeQr(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

/** QR as an SVG string (crisp at any print size). */
export function qrSvg(id) {
  const qr = makeQr(tagUrl(id));
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-hidden="true"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#15302B"/></svg>`;
}

/** Draws the downloadable collar tag (600 × 880 px PNG). */
export function drawTag(canvas, a) {
  const W = 600, H = 880;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1E6B58';
  g.beginPath();
  if (g.roundRect) g.roundRect(0, 0, W, 190, [0, 0, 36, 36]); else g.rect(0, 0, W, 190);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(W / 2, 52, 22, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#cfd8d3';
  g.lineWidth = 3;
  g.stroke();

  g.textAlign = 'center';
  g.fillStyle = '#ffffff';
  g.font = "800 58px 'Bricolage Grotesque', 'Trebuchet MS', sans-serif";
  g.fillText((a.name || 'No name yet').slice(0, 16), W / 2, 140);
  g.font = '600 22px Figtree, system-ui, sans-serif';
  g.fillStyle = '#D7EBE4';
  g.fillText(`${speciesWord(a)} · ${a.city || 'Metro Manila'}`, W / 2, 176);

  const qr = makeQr(tagUrl(a.id));
  const n = qr.getModuleCount();
  const cell = Math.floor(440 / (n + 2));
  const qs = cell * (n + 2);
  const ox = (W - qs) / 2;
  const oy = 215;
  g.fillStyle = '#ffffff';
  g.fillRect(ox, oy, qs, qs);
  g.fillStyle = '#15302B';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) g.fillRect(ox + (c + 1) * cell, oy + (r + 1) * cell, cell, cell);
  }

  g.fillStyle = '#15302B';
  g.font = "700 40px 'JetBrains Mono', monospace";
  g.fillText(tagLabel(a.id), W / 2, oy + qs + 58);
  g.font = '600 24px Figtree, system-ui, sans-serif';
  g.fillStyle = '#3c4e48';
  g.fillText("Scan me · I'm cared for by volunteers", W / 2, oy + qs + 100);
  g.font = '500 20px Figtree, system-ui, sans-serif';
  g.fillStyle = '#5A6A64';
  g.fillText("Please don't remove my collar", W / 2, oy + qs + 132);
}

export function downloadTag(canvas, a) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${tagLabel(a.id)}-collar-tag.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}
