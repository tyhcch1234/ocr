import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { PNG } from "pngjs";
import {
  contrastStretch,
  detectSkew,
  encodeGrayPng,
  horizontalLineEnergy,
  preparePage,
  rgbaToGray,
  rotate90,
  rotateGray,
  sauvola,
  type Gray,
} from "./image.ts";
import { groupLines, normalizeLine, readingOrder } from "./reconstruct.ts";

function blank(w: number, h: number, value = 255): Gray {
  const d = new Uint8Array(w * h);
  d.fill(value);
  return { w, h, d };
}

function fillRect(img: Gray, x: number, y: number, w: number, h: number, value: number) {
  for (let yy = y; yy < y + h && yy < img.h; yy++) {
    for (let xx = x; xx < x + w && xx < img.w; xx++) {
      if (xx >= 0 && yy >= 0) img.d[yy * img.w + xx] = value;
    }
  }
}

test("contrast stretch uses more of the 0–255 range", () => {
  const img = blank(64, 8, 0);
  for (let i = 0; i < img.d.length; i++) img.d[i] = 80 + ((i * 40) % 70);
  const out = contrastStretch(img, 0.02, 0.98);
  assert.ok(Math.min(...out.d) < Math.min(...img.d));
  assert.ok(Math.max(...out.d) > Math.max(...img.d));
});

test("sauvola keeps a dark mark and clears a gray page", () => {
  const img = blank(48, 48, 188);
  fillRect(img, 16, 16, 16, 12, 25);
  const out = sauvola(img, 8, 0.2);
  assert.equal(out.d[22 * 48 + 24], 0);
  assert.equal(out.d[2 * 48 + 2], 255);
});

test("deskew restores a tilted rule", () => {
  const img = blank(460, 280);
  fillRect(img, 30, 136, 400, 5, 0);
  const tilted = rotateGray(img, 3.4);
  const before = horizontalLineEnergy(tilted);
  const angle = detectSkew(tilted);
  const fixed = rotateGray(tilted, angle);
  const after = horizontalLineEnergy(fixed);
  assert.ok(Math.abs(angle) > 1.5 && Math.abs(angle) < 6, `angle ${angle}`);
  assert.ok(after > before, `energy ${before} -> ${after}`);
});

test("a sideways page is detected after a quarter turn", () => {
  const img = blank(220, 320);
  for (let y = 40; y < 280; y += 28) fillRect(img, 20, y, 180, 3, 0);
  const side = rotate90(img, 1);
  const uprightEnergy = horizontalLineEnergy(img);
  const sideEnergy = horizontalLineEnergy(side);
  assert.ok(uprightEnergy > sideEnergy * 1.25);
});

test("grayscale png round-trips", () => {
  const img = blank(5, 4, 200);
  img.d[0] = 0;
  img.d[7] = 255;
  const decoded = PNG.sync.read(Buffer.from(encodeGrayPng(img)));
  assert.equal(decoded.width, 5);
  assert.equal(decoded.height, 4);
  assert.equal(decoded.data[0], 0);
  assert.equal(decoded.data[1], 0);
  assert.equal(decoded.data[7 * 4], 255);
});

test("preparePage binarizes a gray scan when asked", () => {
  const img = blank(60, 40, 200);
  fillRect(img, 8, 12, 30, 4, 15);
  const out = preparePage(img, { deskew: false, binarize: "on" });
  assert.equal(out.binarized, true);
  assert.ok(out.gray.d.includes(0));
  assert.ok(out.gray.d.includes(255));
});

test("chinese spaces inserted by OCR are removed", () => {
  assert.equal(normalizeLine("香 港 特 別 行 政 區"), "香港特別行政區");
  assert.equal(normalizeLine("發票編號  INV-2026-1188"), "發票編號 INV-2026-1188");
  assert.equal(normalizeLine("合計 ， 金額"), "合計，金額");
  assert.equal(normalizeLine("INV-2026-11 88"), "INV-2026-1188");
});

test("auto mode keeps high-contrast gray paper as grayscale", () => {
  const img = blank(80, 60, 200);
  fillRect(img, 10, 20, 24, 6, 20);
  const out = preparePage(img, { deskew: false, binarize: "auto" });
  assert.equal(out.binarized, false);
});

test("the skewed invoice sample is straightened and kept as grayscale", () => {
  const decoded = PNG.sync.read(fs.readFileSync("public/samples/invoice-skew.png"));
  const full = rgbaToGray(decoded.data, decoded.width, decoded.height);
  const h = 1600;
  const d = new Uint8Array(full.w * h);
  for (let y = 0; y < h; y++) d.set(full.d.subarray(y * full.w, y * full.w + full.w), y * full.w);
  const out = preparePage({ w: full.w, h, d }, { deskew: true, binarize: "auto" });
  assert.equal(out.binarized, false);
  assert.ok(Math.abs(out.angle) > 1 && Math.abs(out.angle) < 5, `angle ${out.angle}`);
});

test("auto mode binarizes faint type", () => {
  const img = blank(80, 60, 188);
  fillRect(img, 8, 18, 30, 8, 150);
  const out = preparePage(img, { deskew: false, binarize: "auto" });
  assert.equal(out.binarized, true);
});

test("words on one baseline become a single line", () => {
  const lines = groupLines([
    { text: "香", conf: 90, x0: 10, y0: 10, x1: 40, y1: 48 },
    { text: "港", conf: 88, x0: 44, y0: 11, x1: 74, y1: 49 },
    { text: "INV-1", conf: 90, x0: 90, y0: 10, x1: 150, y1: 48 },
    { text: "合計", conf: 91, x0: 10, y0: 80, x1: 90, y1: 118 },
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "香港 INV-1");
  assert.equal(lines[1].text, "合計");
});

test("two columns are read left then right", () => {
  const line = (text: string, x: number, y: number) => ({
    text,
    bbox: [x, y, x + 40, y + 12] as [number, number, number, number],
  });
  const ordered = readingOrder([
    line("右一", 300, 10),
    line("左一", 10, 10),
    line("右二", 300, 40),
    line("左二", 10, 40),
  ]);
  assert.deepEqual(
    ordered.map((l) => l.text),
    ["左一", "左二", "右一", "右二"],
  );
});
