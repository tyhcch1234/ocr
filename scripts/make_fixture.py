"""Build the sample scan and a digital PDF used by the app and the OCR bench."""

from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "samples"
FONT = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
DIGITAL_FONT = "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"


def jpeg_pdf(jpeg: bytes, img_w: int, img_h: int, page_w: float, page_h: float) -> bytes:
    content = f"q {page_w:.2f} 0 0 {page_h:.2f} 0 0 cm /Im Do Q\n".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_w:.2f} {page_h:.2f}] "
            f"/Contents 4 0 R /Resources << /XObject << /Im 5 0 R >> >> >>"
        ).encode(),
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"endstream",
        (
            f"<< /Type /XObject /Subtype /Image /Width {img_w} /Height {img_h} "
            f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpeg)} >>\nstream\n"
        ).encode()
        + jpeg
        + b"\nendstream",
    ]
    parts = [b"%PDF-1.4\n"]
    offsets = [0]
    for i, body in enumerate(objects, start=1):
        offsets.append(sum(len(p) for p in parts))
        parts.append(f"{i} 0 obj\n".encode() + body + b"\nendobj\n")
    xref_at = sum(len(p) for p in parts)
    xref = [f"xref\n0 {len(objects) + 1}\n".encode(), b"0000000000 65535 f \n"]
    for off in offsets[1:]:
        xref.append(f"{off:010d} 00000 n \n".encode())
    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    )
    return b"".join(parts + xref + [trailer])


def build_scan() -> Image.Image:
    font_lg = ImageFont.truetype(FONT, 54)
    font_md = ImageFont.truetype(FONT, 36)
    font_sm = ImageFont.truetype(FONT, 28)
    w, h = 2480, 3508
    img = Image.new("RGB", (w, h), (214, 210, 202))
    px = img.load()
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            shade = int(18 * (x / w) + 22 * (y / h))
            col = (214 - shade, 210 - shade, 202 - shade)
            for dy in range(4):
                if y + dy >= h:
                    continue
                for dx in range(4):
                    if x + dx >= w:
                        continue
                    px[x + dx, y + dy] = col
    draw = ImageDraw.Draw(img)
    lines = [
        (font_lg, 280, "香港特別行政區  發票"),
        (font_md, 420, "發票編號  INV-2026-1188"),
        (font_md, 520, "客戶名稱  陳大文"),
        (font_md, 620, "項目        專業服務費"),
        (font_md, 720, "合計金額  HKD 1,280.50"),
        (font_sm, 860, "此文件僅供內部使用，請勿外傳。"),
        (font_md, 1020, "備註：請於三十日內付款。"),
        (font_sm, 1160, "地址：香港中環皇后大道中 100 號"),
    ]
    for font, y, text in lines:
        draw.text((220, y), text, font=font, fill=(28, 26, 24))
    rnd = random.Random(7)
    for _ in range(4000):
        x, y = rnd.randrange(w), rnd.randrange(h)
        v = rnd.randrange(80, 180)
        px[x, y] = (v, v, v)
    img = img.rotate(2.6, resample=Image.BICUBIC, expand=False, fillcolor=(196, 192, 184))
    return img.filter(ImageFilter.GaussianBlur(radius=0.6))


def build_digital(path: Path) -> None:
    from fpdf import FPDF

    pdf = FPDF(unit="pt", format="A4")
    pdf.add_page()
    pdf.add_font("cjk", "", DIGITAL_FONT)
    rows = [
        ("cjk", "香港特別行政區 發票"),
        ("lat", "INV-2026-1188"),
        ("cjk", "客戶名稱 陳大文"),
        ("lat", "HKD 1,280.50"),
    ]
    pdf.set_xy(64, 88)
    for kind, text in rows:
        pdf.set_x(64)
        if kind == "cjk":
            pdf.set_font("cjk", size=18)
        else:
            pdf.set_font("Helvetica", size=16)
        pdf.cell(0, 32, text)
        pdf.ln(36)
    pdf.output(path)


def build_layout(path: Path) -> None:
    from fpdf import FPDF

    pdf = FPDF(unit="pt", format="A4")
    pdf.add_page()
    pdf.add_font("cjk", "", DIGITAL_FONT)
    pdf.set_font("cjk", size=20)
    pdf.set_xy(56, 46)
    pdf.cell(0, 28, "季度報告")
    pdf.set_draw_color(20, 20, 20)
    pdf.set_line_width(1.4)
    pdf.line(56, 82, 540, 82)
    data = [
        ["項目", "數量", "金額"],
        ["專業服務", "2", "800"],
        ["印刷", "10", "480"],
    ]
    x0, y0, cw, rh = 56, 108, 150, 28
    for r, row in enumerate(data):
        for c, val in enumerate(row):
            pdf.rect(x0 + c * cw, y0 + r * rh, cw, rh)
            pdf.set_font("Helvetica" if val.isascii() else "cjk", size=12)
            pdf.set_xy(x0 + c * cw + 8, y0 + r * rh + 6)
            pdf.cell(cw - 12, 16, val)
    pdf.set_font("Helvetica", size=16)
    pdf.set_xy(56, 220)
    pdf.cell(0, 22, "E = mc^2")
    pdf.set_fill_color(25, 25, 25)
    base = 430
    for i, height in enumerate((70, 120, 50)):
        pdf.rect(80 + i * 78, base - height, 42, height, style="F")
    pdf.set_line_width(1.2)
    pdf.line(64, base, 320, base)
    pdf.set_font("cjk", size=12)
    pdf.set_xy(56, 446)
    pdf.cell(0, 18, "銷售圖")
    pdf.output(path)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    scan = build_scan()
    scan.save(OUT / "invoice-skew.png")
    from io import BytesIO

    buf = BytesIO()
    scan.save(buf, format="JPEG", quality=82)
    (OUT / "invoice.pdf").write_bytes(jpeg_pdf(buf.getvalue(), scan.width, scan.height, 595.28, 841.89))
    build_digital(OUT / "digital.pdf")
    build_layout(OUT / "layout.pdf")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
