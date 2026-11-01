/// <reference lib="webworker" />
import { preparePage, type PrepareOptions } from "./image";

self.onmessage = (event: MessageEvent<{ w: number; h: number; gray: ArrayBuffer; opts: PrepareOptions }>) => {
  const { w, h, gray, opts } = event.data;
  const result = preparePage({ w, h, d: new Uint8Array(gray) }, opts);
  const pixels = result.gray.d;
  self.postMessage(
    {
      w: result.gray.w,
      h: result.gray.h,
      gray: pixels.buffer,
      angle: result.angle,
      binarized: result.binarized,
      notes: result.notes,
    },
    [pixels.buffer],
  );
};
