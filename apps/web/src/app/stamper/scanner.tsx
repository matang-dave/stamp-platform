'use client';

// Camera QR scanner, isolated so the stamper page stays testable in jsdom:
// the page renders any component implementing ScannerProps, and tests inject
// a fake. Uses the native BarcodeDetector where available, otherwise falls
// back to @zxing/browser (loaded lazily so this module is safe to import in
// non-browser environments).
import { useEffect, useRef, useState } from 'react';

export interface ScannerProps {
  /** Called with the raw QR payload every time a code is detected. */
  onScan: (qrPayload: string) => void;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const DETECT_INTERVAL_MS = 300;

export function Scanner({ onScan }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string | null>(null);
  const [manualPayload, setManualPayload] = useState('');

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera not available on this device.');
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let zxingControls: { stop(): void } | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) return;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor })
          .BarcodeDetector;
        if (Detector) {
          const detector = new Detector({ formats: ['qr_code'] });
          pollTimer = setInterval(async () => {
            try {
              const codes = await detector.detect(video);
              if (codes.length > 0 && codes[0].rawValue) {
                onScanRef.current(codes[0].rawValue);
              }
            } catch {
              // Frame not ready yet — keep polling.
            }
          }, DETECT_INTERVAL_MS);
        } else {
          const { BrowserQRCodeReader } = await import('@zxing/browser');
          const reader = new BrowserQRCodeReader();
          zxingControls = await reader.decodeFromStream(stream, video, (result) => {
            if (result) onScanRef.current(result.getText());
          });
        }
      } catch {
        if (!cancelled) setError('Could not start the camera. Check camera permissions.');
      }
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      zxingControls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={videoRef}
        playsInline
        muted
        aria-label="QR scanner camera preview"
        className="aspect-square w-full rounded-xl bg-black object-cover"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const payload = manualPayload.trim();
          if (payload) onScanRef.current(payload);
        }}
      >
        <label className="flex-1">
          <span className="sr-only">QR payload (manual fallback)</span>
          <input
            value={manualPayload}
            onChange={(event) => setManualPayload(event.target.value)}
            placeholder="Or paste QR payload…"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        >
          Use
        </button>
      </form>
    </div>
  );
}
