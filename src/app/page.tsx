"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cleanImage,
  DEFAULT_SETTINGS,
  extFor,
  type CleanerSettings,
  type OutputFormat,
} from "@/lib/image-cleaner";
import {
  formatBytes,
  inspectImage,
  type Inspection,
} from "@/lib/image-inspect";

export default function Home() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string>("");
  const [originalReport, setOriginalReport] = useState<Inspection | null>(null);
  const [settings, setSettings] = useState<CleanerSettings>(DEFAULT_SETTINGS);
  const [cleanedBlob, setCleanedBlob] = useState<Blob | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string>("");
  const [cleanedReport, setCleanedReport] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    };
  }, [originalUrl, cleanedUrl]);

  const onFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    setError("");
    setCleanedBlob(null);
    setCleanedReport(null);
    if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    setCleanedUrl("");
    setOriginalFile(f);
    const url = URL.createObjectURL(f);
    setOriginalUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    try {
      const rep = await inspectImage(f, f.name);
      setOriginalReport(rep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inspect failed");
    }
  }, [cleanedUrl]);

  const onClean = useCallback(async () => {
    if (!originalFile) {
      setError("Upload an image first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { blob } = await cleanImage(originalFile, settings);
      setCleanedBlob(blob);
      const url = URL.createObjectURL(blob);
      setCleanedUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      const base = originalFile.name.replace(/\.[a-z0-9]+$/i, "") || "image";
      const rep = await inspectImage(
        blob,
        `${base}.cleaned.${extFor(settings.format)}`
      );
      setCleanedReport(rep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cleaning failed");
    } finally {
      setBusy(false);
    }
  }, [originalFile, settings]);

  const removedCount = useMemo(() => {
    if (!originalReport || !cleanedReport) return 0;
    return originalReport.markers.filter(
      (m, i) => m.found && !cleanedReport.markers[i]?.found
    ).length;
  }, [originalReport, cleanedReport]);

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-100">
      <main className="mx-auto w-full max-w-6xl px-5 py-8">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Image Privacy Cleaner
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            100% client-side. Pixels are re-drawn on a canvas and re-encoded,
            which strips EXIF / IPTC / XMP / C2PA markers and PNG prompt
            chunks. No upload, no server storage.
          </p>
        </header>

        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <strong>Ethics boundary:</strong> for privacy and sharing hygiene
          only. Do not use to misrepresent AI output as a real photograph in
          journalism, legal evidence, contests, or marketplaces. Stripping is
          removal — we do not forge PRNU sensor fingerprints or C2PA
          provenance, and this tool cannot make detectors report
          &ldquo;100% real&rdquo;.
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                dragOver
                  ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void onFile(f);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <p className="text-sm font-medium">
                {originalFile ? originalFile.name : "Drop image here or click to upload"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                JPEG / PNG / WebP. Stays in your browser.
              </p>
            </div>

            {error && (
              <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Preview
                title="Original"
                url={originalUrl}
                report={originalReport}
              />
              <Preview
                title="Cleaned"
                url={cleanedUrl}
                report={cleanedReport}
              />
            </div>

            {originalReport && cleanedReport && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                Markers removed: <strong>{removedCount}</strong> · Size{" "}
                {formatBytes(originalReport.fileSize)} →{" "}
                {formatBytes(cleanedReport.fileSize)}
              </p>
            )}
          </section>

          <aside className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Cleaning controls
            </h2>

            <label className="text-sm">
              Output format
              <select
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
                value={settings.format}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    format: e.target.value as OutputFormat,
                  }))
                }
              >
                <option value="jpeg">JPEG (best for stripping)</option>
                <option value="png">PNG (re-rasterized, no text chunks)</option>
                <option value="webp">WebP</option>
              </select>
            </label>

            <label className="text-sm">
              Quality: {Math.round(settings.quality * 100)}
              <input
                type="range"
                min={70}
                max={95}
                value={Math.round(settings.quality * 100)}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    quality: Number(e.target.value) / 100,
                  }))
                }
                className="mt-1 w-full"
                disabled={settings.format === "png"}
              />
            </label>

            <label className="text-sm">
              Max dimension
              <select
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
                value={settings.maxDimension}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    maxDimension: Number(e.target.value),
                  }))
                }
              >
                <option value={0}>Keep original</option>
                <option value={2048}>2048px</option>
                <option value={1600}>1600px</option>
                <option value={1024}>1024px</option>
              </select>
            </label>

            <label className="text-sm">
              Micro-noise: ±{settings.microNoise.toFixed(1)}
              <input
                type="range"
                min={0}
                max={3}
                step={0.5}
                value={settings.microNoise}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    microNoise: Number(e.target.value),
                  }))
                }
                className="mt-1 w-full"
              />
              <span className="text-xs text-zinc-500">
                1–2 is invisible, changes hashes.
              </span>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.safeResize}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    safeResize: e.target.checked,
                  }))
                }
              />
              0.8% safe resize (breaks exact grid)
            </label>

            <button
              onClick={() => void onClean()}
              disabled={busy || !originalFile}
              className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy ? "Cleaning…" : "Clean image"}
            </button>

            {cleanedBlob && cleanedUrl && (
              <a
                href={cleanedUrl}
                download={cleanedReport?.fileName ?? `cleaned.${extFor(settings.format)}`}
                className="rounded-full border border-zinc-300 px-5 py-2.5 text-center text-sm font-medium dark:border-zinc-700"
              >
                Download ({formatBytes(cleanedBlob.size)})
              </a>
            )}

            <div className="rounded-lg bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              Canvas export drops metadata by construction. Micro-noise and
              re-encode change low-level hashes. This lowers casual flagging
              but does not guarantee any detector result and does not create
              real provenance.
            </div>
          </aside>
        </div>

        <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <ReportCard title="Original markers" report={originalReport} />
          <ReportCard title="Cleaned markers" report={cleanedReport} />
        </section>

        <footer className="mt-6 max-w-4xl text-xs leading-5 text-zinc-500 dark:text-zinc-500">
          <p>
            <strong>PRNU note (educational):</strong> real cameras leave a
            per-sensor noise fingerprint (PRNU) that needs reference photos
            from the same body to verify. We only show generic smoothness /
            grain as context, never a camera ID. We do not synthesize or copy
            PRNU.
          </p>
          <p className="mt-1">
            <strong>C2PA note:</strong> we detect the presence of a C2PA/JUMBF
            marker and remove it by re-encoding. We do not create, copy, or
            forge Content Credentials.
          </p>
        </footer>
      </main>
    </div>
  );
}

function Preview({
  title,
  url,
  report,
}: {
  title: string;
  url: string;
  report: Inspection | null;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${title} preview`} className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs text-zinc-400">No image</span>
        )}
      </div>
      {report && (
        <p className="mt-1 text-xs text-zinc-500">
          {report.width}×{report.height} · {formatBytes(report.fileSize)} ·{" "}
          {report.mimeGuess}
          {report.noise && ` · texture: ${report.noise.cleanliness}`}
        </p>
      )}
    </div>
  );
}

function ReportCard({
  title,
  report,
}: {
  title: string;
  report: Inspection | null;
}) {
  if (!report)
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-zinc-500">No data yet.</p>
      </div>
    );
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 break-all text-xs text-zinc-500">{report.fileName}</p>
      <ul className="mt-3 space-y-1.5">
        {report.markers.map((m) => (
          <li key={m.id} className="flex items-center justify-between text-sm">
            <span>{m.label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                m.found
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200"
                  : "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-200"
              }`}
            >
              {m.found ? "found" : "absent"}
            </span>
          </li>
        ))}
      </ul>
      {report.noise && (
        <p className="mt-3 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          Texture variation {report.noise.neighborVariation} —{" "}
          {report.noise.note}
        </p>
      )}
    </div>
  );
}
