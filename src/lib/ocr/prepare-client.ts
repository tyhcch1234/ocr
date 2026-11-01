import { preparePage, type Gray, type PrepareOptions, type PrepareResult } from "./image";

/** Deskew and threshold off the UI thread, and fall back to the main thread if the worker cannot start. */
export function prepareOffThread(img: Gray, opts: PrepareOptions): Promise<PrepareResult> {
  if (typeof Worker === "undefined") return Promise.resolve(preparePage(img, opts));
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./prep.worker.ts", import.meta.url));
    } catch {
      resolve(preparePage(img, opts));
      return;
    }
    let settled = false;
    const finish = (result: PrepareResult) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = (
      event: MessageEvent<{
        w: number;
        h: number;
        gray: ArrayBuffer;
        angle: number;
        binarized: boolean;
        notes: string[];
      }>,
    ) => {
      const data = event.data;
      finish({
        gray: { w: data.w, h: data.h, d: new Uint8Array(data.gray) },
        angle: data.angle,
        binarized: data.binarized,
        notes: data.notes,
      });
    };
    worker.onerror = () => finish(preparePage(img, opts));
    const pixels = img.d.slice();
    worker.postMessage({ w: img.w, h: img.h, gray: pixels.buffer, opts });
  });
}
