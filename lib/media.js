// Browser-only helpers: read picked files, grab frames, and draw the contact sheet.
import { FPS } from './catalog.js';

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error('This video format is not supported by your browser.'));
    v.src = url;
  });
}

function seek(video, time) {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      // Give the decoder a frame to paint (needed on iOS Safari).
      requestAnimationFrame(() => resolve());
    };
    video.addEventListener('seeked', done);
    video.currentTime = Math.max(0, Math.min(time, video.duration - 0.05));
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image format is not supported by your browser.'));
    img.src = url;
  });
}

function drawCover(ctx, source, sw, sh, x, y, w, hgt) {
  const scale = Math.max(w / sw, hgt / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, hgt);
  ctx.clip();
  ctx.drawImage(source, x + (w - dw) / 2, y + (hgt - dh) / 2, dw, dh);
  ctx.restore();
}

function thumbnail(source, sw, sh, w = 180, hgt = 320) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  drawCover(c.getContext('2d'), source, sw, sh, 0, 0, w, hgt);
  return c.toDataURL('image/jpeg', 0.7);
}

const orientationOf = (w, h) => (Math.abs(w - h) < Math.min(w, h) * 0.1 ? 'square' : h > w ? 'portrait' : 'landscape');

export async function probeFile(file, id) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
    const v = await loadVideo(url);
    await seek(v, v.duration * 0.15);
    const asset = {
      id, kind: 'video', name: file.name, url,
      durationFrames: Math.floor(v.duration * FPS),
      width: v.videoWidth, height: v.videoHeight,
      orientation: orientationOf(v.videoWidth, v.videoHeight),
      thumb: thumbnail(v, v.videoWidth, v.videoHeight),
    };
    v.removeAttribute('src');
    v.load();
    return asset;
  }
  const img = await loadImage(url);
  return {
    id, kind: 'photo', name: file.name, url,
    width: img.naturalWidth, height: img.naturalHeight,
    orientation: orientationOf(img.naturalWidth, img.naturalHeight),
    thumb: thumbnail(img, img.naturalWidth, img.naturalHeight),
  };
}

// One image showing every asset with its label, for the Claude app to look at.
export async function contactSheet(assets) {
  const tileW = 200;
  const tileH = 280;
  const pad = 16;
  const label = 44;
  const perRow = 6;
  const tiles = [];
  for (const a of assets) {
    if (a.kind === 'photo') {
      tiles.push({ asset: a, caption: `${a.id} photo`, draw: await loadImage(a.url) });
    } else {
      const v = await loadVideo(a.url);
      for (const pct of [0.1, 0.5, 0.9]) {
        await seek(v, v.duration * pct);
        const c = document.createElement('canvas');
        c.width = tileW;
        c.height = tileH;
        drawCover(c.getContext('2d'), v, v.videoWidth, v.videoHeight, 0, 0, tileW, tileH);
        tiles.push({ asset: a, caption: `${a.id} @${(v.duration * pct).toFixed(1)}s`, draw: c });
      }
      v.removeAttribute('src');
      v.load();
    }
  }
  const rows = Math.ceil(tiles.length / perRow);
  const canvas = document.createElement('canvas');
  canvas.width = perRow * (tileW + pad) + pad;
  canvas.height = rows * (tileH + label + pad) + pad;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 22px system-ui, sans-serif';
  tiles.forEach((t, i) => {
    const x = pad + (i % perRow) * (tileW + pad);
    const y = pad + Math.floor(i / perRow) * (tileH + label + pad);
    const sw = t.draw.naturalWidth || t.draw.width;
    const sh = t.draw.naturalHeight || t.draw.height;
    drawCover(ctx, t.draw, sw, sh, x, y, tileW, tileH);
    ctx.fillStyle = '#fff';
    ctx.fillText(t.caption, x + 4, y + tileH + 30);
  });
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
}
