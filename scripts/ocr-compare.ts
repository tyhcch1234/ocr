/** Compare the old low-resolution pass with grayscale and binarized passes. */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { createWorker, PSM } from "tesseract.js";
import { downscale, encodeGrayPng, rgbaToGray } from "../src/lib/ocr/image.ts";
import { ocrGray } from "../src/lib/ocr/recognize.ts";

function cropTop() {
  const decoded = PNG.sync.read(fs.readFileSync(path.join(process.cwd(), "public/samples/invoice-skew.png")));
  const full = rgbaToGray(decoded.data, decoded.width, decoded.height);
  const h = 1500;
  const d = new Uint8Array(full.w * h);
  for (let y = 0; y < h; y++) d.set(full.d.subarray(y * full.w, y * full.w + full.w), y * full.w);
  return { w: full.w, h, d };
}

async function main() {
  const crop = cropTop();
  const low = downscale(crop, Math.round(Math.max(crop.w, crop.h) / 2));
  const worker = await createWorker("chi_tra+eng", 1, {
    langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
    cachePath: path.join(process.cwd(), ".tess-cache"),
    gzip: true,
  });

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    user_defined_dpi: "70",
    preserve_interword_spaces: "1",
  });
  const baseline = await worker.recognize(Buffer.from(encodeGrayPng(low)), {}, { text: true });
  console.log("--- baseline half-res dpi 70 ---");
  console.log((baseline.data.text || "").trim());
  console.log("confidence", baseline.data.confidence);

  for (const mode of ["off", "on"] as const) {
    const result = await ocrGray(worker, crop, 300, {
      deskew: true,
      binarize: mode,
      autoRotate: false,
    });
    console.log(`--- prepared dpi 300 binarize ${mode} ---`);
    console.log(result.text.trim());
    console.log("confidence", result.confidence, "angle", result.angle);
  }
  await worker.terminate();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
