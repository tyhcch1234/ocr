type StatusFn = (status: string, progress: number) => void;

type TessWorker = {
  recognize: (
    image: Buffer | Blob,
    options?: object,
    output?: { text?: boolean; blocks?: boolean },
  ) => Promise<{
    data: { text: string | null; confidence: number | null; blocks: unknown };
  }>;
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  reinitialize: (langs: string) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TessWorker> | null = null;
let currentKey = "";
let onStatus: StatusFn = () => {};

export function setOcrStatus(fn: StatusFn) {
  onStatus = fn;
}

const LANG_PATH = {
  best: "https://tessdata.projectnaptha.com/4.0.0_best",
  fast: "https://tessdata.projectnaptha.com/4.0.0",
} as const;

export type ModelQuality = keyof typeof LANG_PATH;

function describe(status: string): string {
  if (/traineddata|language|download/i.test(status)) return "正在下載辨識模型（只會一次）";
  if (/initial/i.test(status)) return "正在準備辨識引擎";
  if (/load/i.test(status)) return "正在載入模型";
  return "正在辨識文字";
}

/** Absolute URL so the blob worker can importScripts it. Undefined during SSR. */
function sameOrigin(path: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URL(path, window.location.href).href;
}

async function spawn(lang: string, quality: ModelQuality): Promise<TessWorker> {
  const { createWorker } = await import("tesseract.js");
  // Browsers that advertise SIMD still abort the SIMD build on DotProductSSE
  // (SwiftShader and some headless Chromes). The plain LSTM core is slower
  // and actually finishes.
  const workerPath = sameOrigin("/tesseract/worker.min.js");
  const corePath = sameOrigin("/tesseract/tesseract-core-lstm.wasm.js");
  return (await createWorker(lang, 1, {
    langPath: LANG_PATH[quality],
    gzip: true,
    ...(workerPath ? { workerPath } : {}),
    ...(corePath ? { corePath } : {}),
    logger: (m) => {
      onStatus(describe(m.status || ""), m.progress || 0);
    },
    errorHandler: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error ?? "");
      if (/Aborted|DotProductSSE|RuntimeError/i.test(message)) {
        onStatus("辨識引擎無法在這個瀏覽器啟動", 0);
      }
    },
  })) as unknown as TessWorker;
}

export async function getOcrWorker(lang: string, quality: ModelQuality): Promise<TessWorker> {
  const key = `${quality}:${lang}`;
  if (workerPromise && currentKey === key) return workerPromise;
  await releaseOcrWorker();
  currentKey = key;
  const pending = (async () => {
    try {
      return await spawn(lang, quality);
    } catch (error) {
      if (quality === "best") {
        onStatus("高準確模型下載失敗，改用較小的快速模型", 0);
        return spawn(lang, "fast");
      }
      throw error;
    }
  })();
  workerPromise = pending;
  try {
    return await pending;
  } catch (error) {
    workerPromise = null;
    currentKey = "";
    throw error;
  }
}

export async function releaseOcrWorker() {
  const pending = workerPromise;
  workerPromise = null;
  currentKey = "";
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    /* already failed */
  }
}
