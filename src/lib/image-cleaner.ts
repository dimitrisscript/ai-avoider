// Client-only image cleaner.
// Canvas re-rasterization inherently drops EXIF / IPTC / XMP / C2PA JUMBF
// and PNG tEXt/iTXt/zTXt chunks, because we only copy pixels.

export type OutputFormat = "jpeg" | "png" | "webp";

export interface CleanerSettings {
  format: OutputFormat;
  quality: number; // 0.7 - 0.95, used for jpeg/webp
  maxDimension: number; // 0 = keep original, else e.g. 1024 / 2048
  microNoise: number; // 0 - 3, +- per channel, invisible range is 1-2
  safeResize: boolean; // apply ~0.8% shrink when no other resize applies, to break exact hashes
  chromaShift: number; // 0 - 2, sub-pixel channel offset (chromatic aberration)
  lensDistort: number; // 0 - 1, barrel distortion strength
}

export const DEFAULT_SETTINGS: CleanerSettings = {
  format: "jpeg",
  quality: 0.85,
  maxDimension: 0,
  microNoise: 1.5,
  safeResize: true,
  chromaShift: 0.8,
  lensDistort: 0.3,
};

export function mimeFor(format: OutputFormat): string {
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return "image/jpeg";
}

export function extFor(format: OutputFormat): string {
  if (format === "png") return "png";
  if (format === "webp") return "webp";
  return "jpg";
}

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image. Try JPEG/PNG/WebP."));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
      mime,
      quality
    );
  });
}

export interface CleanResult {
  blob: Blob;
  width: number;
  height: number;
}

function generateCorrelatedNoise(
  width: number,
  height: number,
  strength: number
): Float32Array {
  const scale = 4;
  const lw = Math.max(1, Math.ceil(width / scale));
  const lh = Math.max(1, Math.ceil(height / scale));
  const lowRes = new Float32Array(lw * lh);

  for (let i = 0; i < lowRes.length; i++) {
    lowRes[i] = (Math.random() * 2 - 1) * strength;
  }

  const noise = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const ly = y / scale;
    const y0 = Math.floor(ly);
    const y1 = Math.min(lh - 1, y0 + 1);
    const fy = ly - y0;
    for (let x = 0; x < width; x++) {
      const lx = x / scale;
      const x0 = Math.floor(lx);
      const x1 = Math.min(lw - 1, x0 + 1);
      const fx = lx - x0;
      const v00 = lowRes[y0 * lw + x0];
      const v10 = lowRes[y0 * lw + x1];
      const v01 = lowRes[y1 * lw + x0];
      const v11 = lowRes[y1 * lw + x1];
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      noise[y * width + x] = top + (bot - top) * fy;
    }
  }
  return noise;
}

function applyBayerWeightedNoise(
  data: Uint8ClampedArray,
  noise: Float32Array,
  width: number,
  height: number
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const n = noise[y * width + x];
      const isGreen = (x + y) % 2 === 0;
      const weight = isGreen ? 1.0 : 0.6;
      const v = Math.round(n * weight);
      for (let c = 0; c < 3; c++) {
        let nv = data[i + c] + v;
        if (nv < 0) nv = 0;
        else if (nv > 255) nv = 255;
        data[i + c] = nv;
      }
    }
  }
}

function applyChromaticAberration(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shift: number
): void {
  if (shift <= 0) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;
  const output = new Uint8ClampedArray(d);

  const dx = shift * 0.5;
  const dy = shift * 0.3;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      const rx = x + dx;
      const ry = y + dy;
      const r0 = Math.floor(rx);
      const r1 = Math.min(width - 1, r0 + 1);
      const fx = rx - r0;
      const r0i = Math.floor(ry);
      const r1i = Math.min(height - 1, r0i + 1);
      const fy = ry - r0i;
      const rTop = d[(r0i * width + r0) * 4] * (1 - fx) + d[(r0i * width + r1) * 4] * fx;
      const rBot = d[(r1i * width + r0) * 4] * (1 - fx) + d[(r1i * width + r1) * 4] * fx;
      output[i] = Math.round(rTop + (rBot - rTop) * fy);

      const bx = x - dx;
      const by = y - dy;
      const b0 = Math.max(0, Math.floor(bx));
      const b1 = Math.min(width - 1, b0 + 1);
      const bfx = bx - b0;
      const b0i = Math.max(0, Math.floor(by));
      const b1i = Math.min(height - 1, b0i + 1);
      const bfy = by - b0i;
      const bTop = d[(b0i * width + b0) * 4 + 2] * (1 - bfx) + d[(b0i * width + b1) * 4 + 2] * bfx;
      const bBot = d[(b1i * width + b0) * 4 + 2] * (1 - bfx) + d[(b1i * width + b1) * 4 + 2] * bfx;
      output[i + 2] = Math.round(bTop + (bBot - bTop) * bfy);
    }
  }

  const outputData = new ImageData(output, width, height);
  ctx.putImageData(outputData, 0, 0);
}

function applyLensDistortion(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number
): void {
  if (strength <= 0) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;
  const output = new Uint8ClampedArray(d);

  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  const k = strength * 0.15;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const rNorm = r / maxR;
      const factor = 1 + k * rNorm * rNorm;

      const sx = Math.round(cx + dx * factor);
      const sy = Math.round(cy + dy * factor);

      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const si = (sy * width + sx) * 4;
        const di = (y * width + x) * 4;
        output[di] = d[si];
        output[di + 1] = d[si + 1];
        output[di + 2] = d[si + 2];
      }
    }
  }

  const outputData = new ImageData(output, width, height);
  ctx.putImageData(outputData, 0, 0);
}

export async function cleanImage(
  input: File | Blob,
  settings: CleanerSettings
): Promise<CleanResult> {
  const img = await loadImage(input);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error("Empty image");

  let scale = 1;
  const longest = Math.max(srcW, srcH);
  if (settings.maxDimension > 0 && longest > settings.maxDimension) {
    scale = settings.maxDimension / longest;
  } else if (settings.safeResize) {
    scale = 0.992;
  }

  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D not available");

  if (settings.format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  const s = settings.microNoise;
  if (s > 0) {
    const noise = generateCorrelatedNoise(width, height, s);
    const imageData = ctx.getImageData(0, 0, width, height);
    applyBayerWeightedNoise(imageData.data, noise, width, height);
    ctx.putImageData(imageData, 0, 0);
  }

  applyChromaticAberration(ctx, width, height, settings.chromaShift);
  applyLensDistortion(ctx, width, height, settings.lensDistort);

  const mime = mimeFor(settings.format);
  const blob = await canvasToBlob(canvas, mime, settings.quality);
  return { blob, width, height };
}
