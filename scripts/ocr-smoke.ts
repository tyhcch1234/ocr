/** Small recognition check so a broken WASM build fails in seconds, not after a full page. */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { createWorker } from "tesseract.js";
import { encodeGrayPng, rgbaToGray } from "../src/lib/ocr/image.ts";
import { ocrGray } from "../src/lib/ocr/recognize.ts";

const decoded = PNG.sync.read(fs.readFileSync(path.join(process.cwd(), "public/samples/invoice-skew.png")));
const full = rgbaToGray(decoded.data, decoded.width, decoded.height);
const crop = {
  w: full.w,
  h: 1500,
  d: new Uint8Array(full.w * 1500),
};
for (let y = 0; y < crop.h; y++) {
  crop.d.set(full.d.subarray(y * full.w, y * full.w + full.w), y * full.w);
}

async function main() {
const worker = await createWorker("chi_tra+eng", 1, {
  langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
  cachePath: path.join(process.cwd(), ".tess-cache"),
  gzip: true,
  logger: (m) => {
    if (m.status !== "recognizing text") console.log(m.status);
  },
});
const result = await ocrGray(worker, crop, 300, { deskew: true, binarize: "auto", autoRotate: false });
console.log(result.text);
console.log("confidence", result.confidence, "binarized", result.binarized, "angle", result.angle);
console.log(result.notes.join(" | "));
await worker.terminate();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
