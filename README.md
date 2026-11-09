# PDF 文字辨識

把掃描 PDF 轉成可以修改的文字。這是針對 [PDF Studio 網頁版](https://tyhcch1234.github.io/pdf-studio/index.html) 瀏覽器 OCR 的改進：檔案只在你的瀏覽器裡處理，不會上傳。

網上版把頁面放大兩倍（大約 144 DPI）就送進 Tesseract，也不處理歪斜、灰底或實際解析度。這個版本會：

- 以約 **300 DPI** 算繪（長邊最高 2800 像素），並把真實 DPI 告訴辨識引擎
- 先**拉直**歪斜的頁面。清楚的黑字拉對比並輕微銳化；字很淡或整頁偏暗時才做局部二值化
- 橫放的頁面會轉正；辨識結果很差時才再試上下翻轉或另一種前處理
- 丟掉低信心雜點，收掉中文之間多餘的空格，雙欄先讀左欄再讀右欄
- 預設使用較準的 `tessdata_best` 繁體中文與英文模型（第一次約 24 MB，之後留在瀏覽器）
- 表格和橫線會重組成表格；圖表和算式保留原頁上的圖像，嵌在同一份版面，並寫進 Word
- 數位 PDF 若已有文字層，自動模式直接採用原文
- 辨完可以改字，再下載 Word 或純文字

## 本機執行

```bash
npm install
npm run dev
```

開啟 [http://127.0.0.1:43123](http://127.0.0.1:43123)。

辨識模型第一次從網上下載（約 24 MB），之後留在瀏覽器。引擎本體用頁面自帶的 LSTM 核心：部分瀏覽器會回報支援 SIMD，載入 SIMD 核心後卻在 `DotProductSSE` 直接中止。沒有網路時，模型選「快速」也一樣需要那一次下載。

## 發佈到 GitHub Pages

靜態網站位址是 [https://tyhcch1234.github.io/ocr](https://tyhcch1234.github.io/ocr)，對應儲存庫 `tyhcch1234/ocr`。推上 `main` 之後，GitHub Actions 會用 `/ocr` 當路徑建置並發佈。

[大澳旅遊指南](https://tyhcch1234.github.io/ocr/tai-o/)（路徑 `/tai-o`）。

在已登入 `tyhcch1234` 的機器上：

```bash
gh auth login
gh repo create tyhcch1234/ocr --public --source=. --remote=github --push
```

若儲存庫已經存在：

```bash
git remote add github https://github.com/tyhcch1234/ocr.git
git push -u github main
```

到儲存庫 Settings → Pages，Source 選 GitHub Actions。免費帳號的 Pages 需要公開儲存庫。

## 檢查

```bash
python3 scripts/make_fixture.py   # 重做 public/samples 裡的範例
npm test                          # 前處理與排版
npm run bench                     # 用歪斜發票比較舊的低解析度流程與新流程
```

`bench` 會下載高準確模型到 `.tess-cache/`（已加入 gitignore）。在這台範例發票上，整理過的頁面讀出「香港特別行政區」、「陳大文」、發票編號 `INV-2026-1188`、金額 `1,280.50` 和「請勿外傳」。同一套模型若不拉直、只用約一半解析度，末句「請勿外傳」會認成別的字。
