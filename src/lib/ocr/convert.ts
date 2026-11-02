import type { PDFPageProxy } from "pdfjs-dist";
import { downscale, encodeGrayPng, rgbaToGray, type Gray } from "./image";
import { composeLayout, layoutNotes, presentLayout, type PageLayoutBlock } from "./layout";
import { assemblePdfText, glyphsToLines, type PdfGlyph } from "./pdf-text";
import { ocrGray, type OcrTune } from "./recognize";
import { prepareOffThread } from "./prepare-client";
import { publicPath } from "../public-path";
import { getOcrWorker, releaseOcrWorker, setOcrStatus, type ModelQuality } from "./worker";

export type OcrMode = "auto" | "always" | "never";

export type ConvertSettings = OcrTune & {
  lang: string;
  quality: ModelQuality;
  mode: OcrMode;
  dpi: number;
};

export type PageResult = {
  index: number;
  text: string;
  confidence: number | null;
  source: "ocr" | "text";
  notes: string[];
  doubtful: string[];
  previewUrl: string | null;
  layout: PageLayoutBlock[];
};

export type ConvertProgress = {
  page: number;
  pages: number;
  ratio: number;
  message: string;
};

const TEXT_ENOUGH = 25;

export function renderPlan(widthPt: number, heightPt: number, dpi: number) {
  const maxEdge = 2800;
  let scale = dpi / 72;
  const longEdge = Math.max(widthPt, heightPt) * scale;
  if (longEdge > maxEdge) scale *= maxEdge / longEdge;
  return { scale, dpi: scale * 72 };
}

function grayUrl(img: Gray): string {
  const png = encodeGrayPng(downscale(img, 640));
  const copy = new ArrayBuffer(png.byteLength);
  new Uint8Array(copy).set(png);
  return URL.createObjectURL(new Blob([copy], { type: "image/png" }));
}

async function renderGray(page: PDFPageProxy, scale: number): Promise<Gray> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("瀏覽器不支援 canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return rgbaToGray(pixels, canvas.width, canvas.height);
}

export async function convertPdf(
  file: File,
  settings: ConvertSettings,
  onProgress: (p: ConvertProgress) => void,
  signal?: AbortSignal,
): Promise<PageResult[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = publicPath("/pdf.worker.min.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    pdf = await pdfjs.getDocument({ data }).promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") throw new Error("這份 PDF 有密碼，請先解除再開。");
    throw new Error("讀不到這份 PDF。檔案可能已損壞。");
  }

  const pages: PageResult[] = [];
  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error("已取消");
  };

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      throwIfAborted();
      onProgress({
        page: i,
        pages: pdf.numPages,
        ratio: (i - 1) / pdf.numPages,
        message: `第 ${i} / ${pdf.numPages} 頁`,
      });
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const glyphs: PdfGlyph[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const m = pdfjs.Util.transform(viewport.transform, item.transform);
        const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || 10;
        glyphs.push({
          str: item.str,
          x: m[4],
          y: m[5],
          w: item.width || size * item.str.length * 0.5,
          size,
        });
      }
      const extracted = assemblePdfText(glyphs);
      const useOcr =
        settings.mode === "always" ||
        (settings.mode === "auto" && extracted.chars < TEXT_ENOUGH);

      if (!useOcr) {
        const plan = renderPlan(viewport.width, viewport.height, 140);
        const gray = await renderGray(page, plan.scale);
        const lines = glyphsToLines(glyphs, plan.scale);
        const pieces = composeLayout(lines, gray);
        const layout = presentLayout(pieces, gray.w);
        const note = layoutNotes(layout);
        pages.push({
          index: i,
          text: extracted.text,
          confidence: null,
          source: "text",
          notes: [
            settings.mode === "never" ? "依設定略過 OCR，只用 PDF 內的文字層" : "這一頁已有文字層，直接採用，不再辨識",
            ...(note ? [note] : []),
          ],
          doubtful: [],
          previewUrl: grayUrl(gray),
          layout,
        });
        page.cleanup();
        continue;
      }

      const plan = renderPlan(viewport.width, viewport.height, settings.dpi);
      onProgress({
        page: i,
        pages: pdf.numPages,
        ratio: (i - 1) / pdf.numPages,
        message: `第 ${i} / ${pdf.numPages} 頁：整理影像`,
      });
      const gray = await renderGray(page, plan.scale);
      setOcrStatus((status, progress) => {
        onProgress({
          page: i,
          pages: pdf.numPages,
          ratio: (i - 1 + Math.min(0.95, progress)) / pdf.numPages,
          message: `第 ${i} / ${pdf.numPages} 頁：${status}`,
        });
      });
      const worker = await getOcrWorker(settings.lang, settings.quality);
      throwIfAborted();
      const recognized = await ocrGray(worker, gray, plan.dpi, settings, prepareOffThread);
      const layoutPieces = composeLayout(recognized.lines, recognized.image);
      const layout = presentLayout(layoutPieces, recognized.image.w);
      const notes = [...recognized.notes];
      const layoutNote = layoutNotes(layout);
      if (layoutNote) notes.push(layoutNote);
      if (!recognized.text.trim()) notes.push("這一頁沒有辨識出文字");
      pages.push({
        index: i,
        text: recognized.text,
        confidence: recognized.confidence,
        source: "ocr",
        notes,
        doubtful: recognized.doubtful,
        previewUrl: grayUrl(recognized.preview),
        layout,
      });
      page.cleanup();
    }
  } finally {
    await pdf.cleanup();
  }

  onProgress({
    page: pdf.numPages,
    pages: pdf.numPages,
    ratio: 1,
    message: "完成",
  });
  return pages;
}

export async function cancelConvert() {
  await releaseOcrWorker();
}
