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
}

export const DEFAULT_SETTINGS: CleanerSettings = {
  format: "jpeg",
  quality: 0.88,
  maxDimension: 0,
  microNoise: 1.5,
  safeResize: true,
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
    // Imperceptible, but changes perceptual hashes / pixel grid.
    scale = 0.992;
  }

  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D not available");

  // White base for JPEG (no alpha).
  if (settings.format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  // Imperceptible micro-noise: +- strength per channel.
  const s = settings.microNoise;
  if (s > 0) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const d = imageData.data;
    const range = Math.max(1, Math.round(s * 2));
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const n =
          Math.floor(Math.random() * (range * 2 + 1)) - range;
        // Scale down so 1.5 => mostly +-1, sometimes +-2.
        const v = Math.round(n * (s / 2));
        const idx = i + c;
        let nv = d[idx] + v;
        if (nv < 0) nv = 0;
        else if (nv > 255) nv = 255;
        d[idx] = nv;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  const mime = mimeFor(settings.format);
  const blob = await canvasToBlob(canvas, mime, settings.quality);
  return { blob, width, height };
}
