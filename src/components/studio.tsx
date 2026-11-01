"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { pagesToDocx, pagesToTxt } from "@/lib/docx";
import {
  cancelConvert,
  convertPdf,
  type ConvertSettings,
  type PageResult,
} from "@/lib/ocr/convert";

const LANGS = [
  { value: "chi_tra+eng", label: "繁體中文 + English" },
  { value: "chi_sim+eng", label: "簡體中文 + English" },
  { value: "eng", label: "只限 English" },
  { value: "chi_tra+chi_sim+eng", label: "繁體 + 簡體 + English" },
];

const MODES = [
  { value: "auto", label: "自動：沒有文字層才辨識" },
  { value: "always", label: "一律重新辨識" },
  { value: "never", label: "只用 PDF 文字層" },
];

type Queued = { id: string; file: File };
type Done = { id: string; name: string; pages: PageResult[]; error?: string };

const DEFAULTS: ConvertSettings = {
  lang: "chi_tra+eng",
  quality: "best",
  mode: "auto",
  deskew: true,
  binarize: "auto",
  autoRotate: true,
  dpi: 300,
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function baseName(name: string) {
  return name.replace(/\.pdf$/i, "") || "ocr";
}

export function Studio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [settings, setSettings] = useState<ConvertSettings>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [ratio, setRatio] = useState(0);
  const [results, setResults] = useState<Done[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const langLabel = LANGS.find((item) => item.value === settings.lang)?.label ?? settings.lang;
  const modeLabel = MODES.find((item) => item.value === settings.mode)?.label ?? settings.mode;

  const summary = useMemo(() => {
    if (!queue.length) return "尚未加入 PDF";
    return `${queue.length} 個 PDF，共 ${formatSize(queue.reduce((n, item) => n + item.file.size, 0))}`;
  }, [queue]);

  function addFiles(list: FileList | File[]) {
    const incoming = [...list];
    setQueue((current) => {
      const next = [...current];
      for (const file of incoming) {
        if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") continue;
        if (next.some((item) => item.file.name === file.name && item.file.size === file.size)) continue;
        next.push({ id: `${file.name}-${file.size}-${file.lastModified}`, file });
      }
      return next;
    });
  }

  async function loadSample(path: string, name: string) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("範例檔載入失敗");
    const blob = await res.blob();
    addFiles([new File([blob], name, { type: "application/pdf" })]);
  }

  function patch<K extends keyof ConvertSettings>(key: K, value: ConvertSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updatePage(docId: string, index: number, text: string) {
    setResults((current) =>
      current.map((doc) =>
        doc.id !== docId
          ? doc
          : {
              ...doc,
              pages: doc.pages.map((page) => (page.index === index ? { ...page, text } : page)),
            },
      ),
    );
  }

  async function start() {
    if (!queue.length || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setResults([]);
    setRatio(0);
    try {
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        setStatus(item.file.name);
        try {
          const pages = await convertPdf(
            item.file,
            settings,
            (progress) => {
              const overall = (i + progress.ratio) / queue.length;
              setRatio(Math.round(overall * 100));
              setStatus(`${item.file.name} · ${progress.message}`);
            },
            controller.signal,
          );
          setResults((current) => [...current, { id: item.id, name: item.file.name, pages }]);
        } catch (error) {
          const message = error instanceof Error ? error.message : "辨識失敗";
          if (message === "已取消") break;
          setResults((current) => [...current, { id: item.id, name: item.file.name, pages: [], error: message }]);
        }
      }
      setRatio(100);
      setStatus("完成。可以先改字，再下載。");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function stop() {
    abortRef.current?.abort();
    await cancelConvert();
    setBusy(false);
    setStatus("已取消");
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-heading text-sm tracking-[0.18em] text-primary">PDF STUDIO</p>
          <h1 className="font-heading mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            掃描頁，先整理再辨識
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            網上版原本把頁面放大兩倍就送進 Tesseract，大約只有 144 DPI，也不處理歪斜和灰底。
            這裡改成約 300 DPI，並先拉直、拉對比，再辨識繁體中文與英文。檔案不會上傳。
          </p>
        </div>
        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary font-heading text-xl text-primary-foreground">
          辨
        </div>
      </header>

      <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <section className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>PDF</CardTitle>
              <CardDescription>{summary}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
                }}
                className={`rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
                  dragOver ? "border-primary bg-accent" : "border-border bg-background hover:bg-muted"
                }`}
              >
                <FileText className="mx-auto mb-2 size-5 text-primary" />
                <span className="block text-sm font-medium">拖進 PDF，或按這裡選檔</span>
                <span className="mt-1 block text-xs text-muted-foreground">可一次多個。加密檔需要先解除密碼。</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadSample("/samples/invoice.pdf", "invoice-scan.pdf").catch((error: Error) => setStatus(error.message))}
                >
                  載入歪斜掃描範例
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    loadSample("/samples/digital.pdf", "invoice-digital.pdf").catch((error: Error) => setStatus(error.message))
                  }
                >
                  載入數位文字範例
                </Button>
              </div>
              {queue.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {queue.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-sm">
                      <span className="truncate">{item.file.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatSize(item.file.size)}</span>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setQueue((current) => current.filter((row) => row.id !== item.id))}
                        disabled={busy}
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>辨識</CardTitle>
              <CardDescription>預設用較準的模型，第一次會下載約 24 MB。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field label="語言">
                <Select value={settings.lang} onValueChange={(value) => typeof value === "string" && patch("lang", value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{langLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LANGS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="何時辨識">
                <Select
                  value={settings.mode}
                  onValueChange={(value) =>
                    (value === "auto" || value === "always" || value === "never") && patch("mode", value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{modeLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="模型">
                <Select
                  value={settings.quality}
                  onValueChange={(value) => (value === "best" || value === "fast") && patch("quality", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{settings.quality === "best" ? "高準確（建議）" : "快速、檔案較小"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="best">高準確（建議）</SelectItem>
                    <SelectItem value="fast">快速、檔案較小</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <details className="rounded-lg border border-border px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">影像前處理</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <Toggle
                    label="拉直歪斜的頁面"
                    checked={settings.deskew}
                    onCheckedChange={(checked) => patch("deskew", checked)}
                  />
                  <Toggle
                    label="橫放或上下顛倒時自動轉正"
                    checked={settings.autoRotate}
                    onCheckedChange={(checked) => patch("autoRotate", checked)}
                  />
                  <Field label="灰底與污點">
                    <Select
                      value={settings.binarize}
                      onValueChange={(value) =>
                        (value === "auto" || value === "on" || value === "off") && patch("binarize", value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {settings.binarize === "auto" ? "自動" : settings.binarize === "on" ? "一律二值化" : "只拉對比"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自動</SelectItem>
                        <SelectItem value="on">一律二值化</SelectItem>
                        <SelectItem value="off">只拉對比</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="解析度">
                    <Select
                      value={String(settings.dpi)}
                      onValueChange={(value) => typeof value === "string" && patch("dpi", Number(value))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>{settings.dpi} DPI</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="220">220 DPI，較快</SelectItem>
                        <SelectItem value="300">300 DPI，建議</SelectItem>
                        <SelectItem value="400">400 DPI，小字</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </details>

              <div className="flex gap-2">
                <Button type="button" className="h-10 flex-1" disabled={!queue.length || busy} onClick={start}>
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  {busy ? "辨識中" : "開始辨識"}
                </Button>
                {busy ? (
                  <Button type="button" variant="outline" className="h-10" onClick={stop}>
                    取消
                  </Button>
                ) : null}
              </div>
              {(busy || status) && (
                <div className="flex flex-col gap-2">
                  <Progress value={busy ? ratio : ratio || 0} />
                  <p className="text-xs leading-5 text-muted-foreground">{status}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          {!results.length && !busy && (
            <Card className="flex-1">
              <CardHeader>
                <CardTitle>辨識結果會出現在這裡</CardTitle>
                <CardDescription>每一頁都可以直接改，再存成 Word 或純文字。</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
                  <li>掃描頁以約 300 DPI 送進辨識，長邊最高 2800 像素，並告訴引擎實際 DPI。</li>
                  <li>歪斜的頁面會先轉正。清楚的黑字保留灰階；對比太低或陰影很重時才做局部二值化。</li>
                  <li>信心太低的雜點會丟掉，中文之間被硬插進去的空格會收掉。雙欄會先讀左欄。</li>
                  <li>數位 PDF 若已有文字層，自動模式會直接用原文，不再重認一次。</li>
                </ul>
              </CardContent>
            </Card>
          )}

          {results.map((doc) => (
            <Card key={doc.id}>
              <CardHeader>
                <CardTitle className="truncate">{doc.name}</CardTitle>
                <CardDescription>
                  {doc.error
                    ? doc.error
                    : `${doc.pages.length} 頁 · OCR ${doc.pages.filter((page) => page.source === "ocr").length} 頁`}
                </CardDescription>
              </CardHeader>
              {!doc.error && (
                <CardContent className="flex flex-col gap-5">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={async () => {
                        const blob = await pagesToDocx(baseName(doc.name), doc.pages.map((page) => page.text));
                        download(blob, `${baseName(doc.name)}.docx`);
                      }}
                    >
                      下載 Word
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const text = pagesToTxt(doc.pages.map((page) => page.text));
                        download(new Blob([text], { type: "text/plain;charset=utf-8" }), `${baseName(doc.name)}.txt`);
                      }}
                    >
                      下載純文字
                    </Button>
                  </div>
                  {doc.pages.map((page) => (
                    <article key={page.index} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[148px_1fr]">
                      <div>
                        {page.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={page.previewUrl}
                            alt={`第 ${page.index} 頁預覽`}
                            className="w-full rounded-lg border border-border bg-white"
                          />
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge variant="outline">第 {page.index} 頁</Badge>
                          {page.source === "text" ? (
                            <Badge variant="secondary">文字層</Badge>
                          ) : (
                            <Badge variant={page.confidence !== null && page.confidence < 55 ? "destructive" : "secondary"}>
                              信心 {page.confidence ?? 0}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-col gap-2">
                        <Textarea
                          value={page.text}
                          onChange={(event) => updatePage(doc.id, page.index, event.target.value)}
                          className="min-h-40 text-base leading-7"
                          aria-label={`第 ${page.index} 頁文字`}
                        />
                        {page.doubtful.length > 0 && (
                          <p className="text-xs leading-5 text-muted-foreground">
                            請對一下：{page.doubtful.join("、")}
                          </p>
                        )}
                        {page.notes.length > 0 && (
                          <p className="text-xs leading-5 text-muted-foreground">{page.notes.join(" · ")}</p>
                        )}
                      </div>
                    </article>
                  ))}
                </CardContent>
              )}
            </Card>
          ))}
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
