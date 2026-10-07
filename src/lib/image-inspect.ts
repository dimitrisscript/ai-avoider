// Educational inspector only. Not a forensic verifier.
// - Binary marker scan finds embedded provenance hints (EXIF/XMP/C2PA/PNG text).
// - Noise heuristic explains sensor-noise intuition, without claiming camera ID.
// Real PRNU matching needs N reference photos from the same body + calibrated
// pipeline. We deliberately do NOT implement that.

export interface MarkerFinding {
  id: string;
  label: string;
  found: boolean;
  detail: string;
}

export interface NoiseStats {
  neighborVariation: number; // mean abs diff vs right/bottom neighbor, 0-~40
  cleanliness: "very-clean" | "normal" | "grainy";
  note: string;
}

export interface Inspection {
  fileName: string;
  fileSize: number;
  mimeGuess: string;
  width: number;
  height: number;
  markers: MarkerFinding[];
  noise?: NoiseStats;
}

function sniffMime(bytes: Uint8Array): string {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return "unknown";
}

function has(hay: string, needle: string): boolean {
  return hay.includes(needle);
}

export async function inspectImage(
  input: File | Blob,
  fileName: string
): Promise<Inspection> {
  const buf = await input.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Decode as latin1 so every byte maps, then lowercase once for search.
  let text = "";
  const sliceLen = Math.min(bytes.length, 8_000_000);
  // Chunked to avoid stack issues.
  const chunk = 65536;
  let parts: string[] = [];
  for (let i = 0; i < sliceLen; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, sliceLen));
    let s = "";
    for (let j = 0; j < sub.length; j++) s += String.fromCharCode(sub[j]);
    parts.push(s);
  }
  text = parts.join("").toLowerCase();
  parts = [];

  const exifFound = has(text, "exif\u0000\u0000") || has(text, "exif");
  // Narrow to real XMP header to avoid false positives on "exif" substring? Keep simple.
  const xmpFound =
    has(text, "http://ns.adobe.com/xap/1.0/") || has(text, "<x:xmpmeta");
  const iptcFound =
    has(text, "photoshop 3.0") || has(text, "8bim") || has(text, "iptc");
  const c2paFound =
    has(text, "c2pa") ||
    has(text, "jumb") ||
    has(text, "content credentials") ||
    has(text, "c2pa_manifest");
  const pngTextFound =
    has(text, "stable diffusion") ||
    has(text, "midjourney") ||
    has(text, "comfyui") ||
    has(text, "automatic1111") ||
    has(text, "parameters") ||
    (has(text, "prompt") && has(text, "itex")) ||
    has(text, "workflow");
  const generatorFound =
    has(text, "software") ||
    has(text, "generator") ||
    has(text, "ai-generated") ||
    has(text, "dall-e") ||
    has(text, "firefly");

  const markers: MarkerFinding[] = [
    {
      id: "exif",
      label: "EXIF",
      found: exifFound,
      detail: exifFound ? "EXIF segment found" : "No EXIF segment",
    },
    {
      id: "xmp",
      label: "XMP",
      found: xmpFound,
      detail: xmpFound ? "XMP packet found" : "No XMP packet",
    },
    {
      id: "iptc",
      label: "IPTC / Photoshop",
      found: iptcFound,
      detail: iptcFound ? "IPTC/Photoshop header found" : "Not found",
    },
    {
      id: "c2pa",
      label: "C2PA / JUMBF",
      found: c2paFound,
      detail: c2paFound
        ? "C2PA/JUMBF marker found"
        : "No C2PA manifest marker",
    },
    {
      id: "pngtext",
      label: "PNG generator chunks",
      found: pngTextFound,
      detail: pngTextFound
        ? "Prompt/workflow-like text found"
        : "No prompt-like text",
    },
    {
      id: "generator",
      label: "Software tag",
      found: generatorFound,
      detail: generatorFound
        ? "Software/Generator string found"
        : "No software string",
    },
  ];

  // Dimensions via Image element (client-only).
  let width = 0;
  let height = 0;
  try {
    const url = URL.createObjectURL(input);
    const dims = await new Promise<{ w: number; h: number }>((res) => {
      const img = new Image();
      img.onload = () => {
        res({ w: img.naturalWidth, h: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        res({ w: 0, h: 0 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
    width = dims.w;
    height = dims.h;
  } catch {
    // ignore
  }

  const noise = await estimateNoise(input).catch(() => undefined);

  return {
    fileName,
    fileSize: (input as Blob).size,
    mimeGuess: sniffMime(bytes),
    width,
    height,
    markers,
    noise,
  };
}

async function estimateNoise(input: Blob): Promise<NoiseStats | undefined> {
  const bitmap = await createImageBitmap(input).catch(() => null);
  if (!bitmap) return undefined;
  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  // Center crop scaled down - fast heuristic.
  const sw = bitmap.width;
  const sh = bitmap.height;
  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2;
  const sy = (sh - side) / 2;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, S, S);
  bitmap.close();
  const data = ctx.getImageData(0, 0, S, S).data;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < S - 1; y++) {
    for (let x = 0; x < S - 1; x++) {
      const i = (y * S + x) * 4;
      const ir = (y * S + x + 1) * 4;
      const ib = ((y + 1) * S + x) * 4;
      const lum =
        (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      const lumR =
        (data[ir] * 0.299 + data[ir + 1] * 0.587 + data[ir + 2] * 0.114) / 255;
      const lumB =
        (data[ib] * 0.299 + data[ib + 1] * 0.587 + data[ib + 2] * 0.114) / 255;
      sum += Math.abs(lum - lumR) + Math.abs(lum - lumB);
      n += 2;
    }
  }
  const neighborVariation = (sum / Math.max(1, n)) * 100;
  let cleanliness: NoiseStats["cleanliness"] = "normal";
  if (neighborVariation < 1.2) cleanliness = "very-clean";
  else if (neighborVariation > 3.5) cleanliness = "grainy";

  return {
    neighborVariation: Math.round(neighborVariation * 100) / 100,
    cleanliness,
    note:
      cleanliness === "very-clean"
        ? "Unusually smooth. Common in synthetic / heavily denoised images, but not proof."
        : cleanliness === "grainy"
          ? "Visible grain/noise. Typical of high-ISO photos or added grain."
          : "Mid-range texture. Both photos and AI images land here.",
  };
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}
