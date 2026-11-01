/**
 * Compare a low-resolution pass (what the GitHub Pages build does) with the
 * prepared 300 DPI pass, on the skewed Traditional Chinese invoice.
 *
 * Node's WASM SIMD build aborts on some CPUs, so this forces the plain LSTM
 * core. The browser app serves that same LSTM build from /tesseract.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { createWorker, PSM } from "tesseract.js";
import { downscale, encodeGrayPng, rgbaToGray, type Gray } from "../src/lib/ocr/image.ts";
import { ocrGray } from "../src/lib/ocr/recognize.ts";

function ensureNodeCore() {
  const target = path.join(process.cwd(), "node_modules/tesseract.js/src/worker-script/node/getCore.js");
  const src = fs.readFileSync(target, "utf8");
  if (src.includes("TESS_FORCE_LSTM")) return;
  const next = src.replace(
    "if (relaxedSimdSupport) {",
    "if (process.env.TESS_FORCE_LSTM === '1') {\n        TesseractCore = require('tesseract.js-core/tesseract-core-lstm');\n      } else if (relaxedSimdSupport) {",
  );
  if (next === src) throw new Error("could not patch tesseract.js node core selection");
  fs.writeFileSync(target, next);
}

const ROOT = process.cwd();
const PNG_PATH = path.join(ROOT, "public/samples/invoice-skew.png");

function loadPng(file: string) {
  const decoded = PNG.sync.read(fs.readFileSync(file));
  return rgbaToGray(decoded.data, decoded.width, decoded.height);
}

function compact(text: string) {
  return text.replace(/[\s,，]/g, "");
}

function hits(text: string) {
  const flat = compact(text);
  const checks: Array<[string, boolean]> = [
    ["香港", flat.includes("香港")],
    ["特別行政區", flat.includes("特別行政區")],
    ["INV-2026-1188", flat.includes("INV-2026-1188")],
    ["陳大文", flat.includes("陳大文")],
    ["1280.50", flat.includes("1280.50")],
    ["中環", flat.includes("中環")],
    ["三十", flat.includes("三十")],
    ["請勿外傳", flat.includes("請勿外傳")],
  ];
  return checks;
}

function topBand(img: Gray): Gray {
  const h = Math.min(img.h, 1600);
  const d = new Uint8Array(img.w * h);
  for (let y = 0; y < h; y++) d.set(img.d.subarray(y * img.w, y * img.w + img.w), y * img.w);
  return { w: img.w, h, d };
}

async function main() {
  ensureNodeCore();
  process.env.TESS_FORCE_LSTM = "1";
  if (!fs.existsSync(PNG_PATH)) {
    console.error("missing fixture, run python3 scripts/make_fixture.py");
    process.exit(1);
  }
  const full = topBand(loadPng(PNG_PATH));
  const low = downscale(full, Math.round(Math.max(full.w, full.h) / 2));
  console.log(`page band ${full.w}x${full.h}  low ${low.w}x${low.h}`);

  const worker = await createWorker("chi_tra+eng", 1, {
    langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
    cachePath: path.join(ROOT, ".tess-cache"),
    gzip: true,
    logger: (m) => {
      if (m.status === "recognizing text" && (m.progress === 0 || m.progress === 1)) {
        console.log(`  ${m.status} ${Math.round((m.progress || 0) * 100)}%`);
      } else if (m.status && m.status !== "recognizing text") {
        console.log(`  ${m.status}`);
      }
    },
  });

  console.log("baseline: half resolution, dpi 70, no preprocess");
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    user_defined_dpi: "70",
    preserve_interword_spaces: "1",
  });
  const baseline = await worker.recognize(Buffer.from(encodeGrayPng(low)), {}, { text: true, blocks: true });
  const baselineText = baseline.data.text || "";
  console.log("--- baseline ---");
  console.log(baselineText.trim());
  console.log("confidence", baseline.data.confidence);

  console.log("improved: deskew, contrast or sauvola, dpi 300");
  const improved = await ocrGray(worker, full, 300, {
    deskew: true,
    binarize: "auto",
    autoRotate: true,
  });
  console.log("--- improved ---");
  console.log(improved.text.trim());
  console.log("confidence", improved.confidence, "angle", improved.angle, "binarized", improved.binarized);
  console.log("notes", improved.notes.join(" | "));

  const baseHits = hits(baselineText);
  const nextHits = hits(improved.text);
  console.log("baseline hits", baseHits.filter(([, ok]) => ok).map(([name]) => name).join(", ") || "(none)");
  console.log("improved hits", nextHits.filter(([, ok]) => ok).map(([name]) => name).join(", ") || "(none)");

  await worker.terminate();

  const needed = ["香港", "特別行政區", "INV-2026-1188", "陳大文", "1280.50", "請勿外傳"];
  const missed = needed.filter((name) => !nextHits.find(([label, ok]) => label === name && ok));
  const improvedCount = nextHits.filter(([, ok]) => ok).length;
  const baselineCount = baseHits.filter(([, ok]) => ok).length;
  if (missed.length || improvedCount < baselineCount) {
    console.error("improved OCR missed", missed.join(", ") || "it was not more complete than the baseline");
    process.exit(1);
  }
  console.log(`ok ${improvedCount}/7 phrases, baseline ${baselineCount}/7`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
