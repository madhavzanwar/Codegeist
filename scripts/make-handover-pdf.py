#!/usr/bin/env python3
"""Render docs/HANDOVER.md to docs/HANDOVER.pdf — black and white only (no colours, no fills).

Supports the Markdown subset used in the handover: headings, paragraphs, bullet/numbered/checkbox lists
(one nesting level), fenced code blocks, pipe tables, **bold**, `code` and URLs.
Usage: python3 scripts/make-handover-pdf.py
"""
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (KeepTogether, ListFlowable, ListItem, PageBreak, Paragraph, Preformatted,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "HANDOVER.md"
OUT = ROOT / "docs" / "HANDOVER.pdf"
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")

pdfmetrics.registerFont(TTFont("Sans", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Sans-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Mono", str(FONT_DIR / "DejaVuSansMono.ttf")))
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-Bold", italic="Sans", boldItalic="Sans-Bold")

BLACK = colors.black
base = ParagraphStyle("base", fontName="Sans", fontSize=9.5, leading=13.5, textColor=BLACK, alignment=TA_LEFT, spaceAfter=4)
styles = {
    "title": ParagraphStyle("title", parent=base, fontName="Sans-Bold", fontSize=20, leading=25, spaceAfter=6),
    "subtitle": ParagraphStyle("subtitle", parent=base, fontSize=10.5, leading=15, spaceAfter=2),
    "h2": ParagraphStyle("h2", parent=base, fontName="Sans-Bold", fontSize=13.5, leading=18, spaceBefore=12, spaceAfter=6),
    "h3": ParagraphStyle("h3", parent=base, fontName="Sans-Bold", fontSize=11, leading=15, spaceBefore=8, spaceAfter=4),
    "p": base,
    "cell": ParagraphStyle("cell", parent=base, fontSize=8.5, leading=11.5, spaceAfter=0),
    "cellh": ParagraphStyle("cellh", parent=base, fontName="Sans-Bold", fontSize=8.5, leading=11.5, spaceAfter=0),
    "code": ParagraphStyle("code", parent=base, fontName="Mono", fontSize=8.3, leading=11),
    "toc": ParagraphStyle("toc", parent=base, fontSize=10, leading=15, spaceAfter=0),
}


def inline(text: str) -> str:
    """Escape XML and convert **bold**, `code` and URLs."""
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for part in parts:
        if part.startswith("`") and part.endswith("`") and len(part) > 1:
            code = part[1:-1].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            out.append(f'<font name="Mono" size="8.5">{code}</font>')
            continue
        s = part.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
        s = re.sub(r"(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])", r"\1", s)
        s = re.sub(r"(https?://[^\s)|,]+[^\s)|,.:;])", r"<u>\1</u>", s)
        out.append(s)
    return "".join(out)


def checkbox(text: str) -> str:
    return re.sub(r"^\[ \]\s*", "☐  ", re.sub(r"^\[x\]\s*", "☑  ", text))


def wrap_code(lines, width=92, shell=True):
    """Wrap long lines at spaces; shell lines get a trailing backslash so they stay copy-pasteable."""
    out = []
    for line in lines:
        while len(line) > width:
            cut = line.rfind(" ", 0, width - 2)
            if cut <= 0:
                cut = width - 2
            out.append(line[:cut] + (" \\" if shell else ""))
            line = "  " + line[cut:].lstrip()
        out.append(line)
    return out


def code_block(lines, lang=""):
    pre = Preformatted("\n".join(wrap_code(lines, shell=lang in ("bash", "sh", ""))), styles["code"])
    t = Table([[pre]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, BLACK),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return [t, Spacer(1, 5)]


def table_block(rows):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    header, body = cells[0], [r for r in cells[2:]]
    ncol = len(header)
    data = [[Paragraph(inline(c), styles["cellh"]) for c in header]]
    data += [[Paragraph(inline(checkbox(c)), styles["cell"]) for c in (r + [""] * ncol)[:ncol]] for r in body]
    total = 170 * mm
    lengths = [max(len(r[i]) if i < len(r) else 0 for r in cells) for i in range(ncol)]
    weights = [min(max(l, 8), 70) for l in lengths]
    widths = [total * w / sum(weights) for w in weights]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, BLACK),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, BLACK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return [t, Spacer(1, 6)]


def list_block(items, ordered, start=1):
    flow = []
    for text, subs in items:
        content = [Paragraph(inline(checkbox(text)), styles["p"])]
        if subs:
            content.append(ListFlowable([ListItem(Paragraph(inline(s), styles["p"]), leftIndent=12) for s in subs],
                                        bulletType="bullet", start="–", leftIndent=12, bulletFontName="Sans"))
        flow.append(ListItem(content, leftIndent=16))
    if ordered:
        return [ListFlowable(flow, bulletType="1", start=start, bulletFormat="%s.", leftIndent=18, bulletFontName="Sans",
                             bulletFontSize=9.5), Spacer(1, 3)]
    is_check = all(t.startswith("[") for t, _ in items)
    return [ListFlowable(flow, bulletType="bullet", start="" if is_check else "•", leftIndent=16 if not is_check else 4,
                         bulletFontName="Sans"), Spacer(1, 3)]


def parse(md: str):
    lines = md.splitlines()
    story, toc = [], []
    i = 0
    para: list[str] = []

    def flush():
        if para:
            story.append(Paragraph(inline(" ".join(para)), styles["p"]))
            para.clear()

    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            flush()
            lang = line[3:].strip()
            j = i + 1
            block = []
            while j < len(lines) and not lines[j].startswith("```"):
                block.append(lines[j])
                j += 1
            story += code_block(block, lang)
            i = j + 1
            continue
        if line.startswith("# "):
            flush()
            story.append(Paragraph(inline(line[2:]), styles["title"]))
            i += 1
            continue
        if line.startswith("## "):
            flush()
            title = line[3:]
            toc.append(title)
            story.append(Paragraph(f'<a name="s{len(toc)}"/>{inline(title)}', styles["h2"]))
            i += 1
            continue
        if line.startswith("**") and line.endswith(":**") or re.match(r"^\*\*\d+\.\d+ ", line):
            flush()
            story.append(Paragraph(inline(line), styles["h3"]))
            i += 1
            continue
        if line.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(lines[i])
                i += 1
            story += table_block(rows)
            continue
        m = re.match(r"^(\d+)\.\s+(.*)$", line) or re.match(r"^-\s+(.*)$", line)
        if m:
            flush()
            ordered = bool(re.match(r"^\d+\.", line))
            start = int(re.match(r"^(\d+)", line).group(1)) if ordered else 1
            items = []
            while i < len(lines):
                cur = lines[i]
                mm_ = re.match(r"^\d+\.\s+(.*)$", cur) if ordered else re.match(r"^-\s+(.*)$", cur)
                if mm_:
                    items.append([mm_.group(1), []])
                    i += 1
                    continue
                sub = re.match(r"^\s{2,}[-*]\s+(.*)$", cur)
                if sub and items:
                    items[-1][1].append(sub.group(1))
                    i += 1
                    continue
                break
            story += list_block(items, ordered, start)
            continue
        if not line.strip():
            flush()
            i += 1
            continue
        para.append(line.strip())
        i += 1
    flush()
    return story, toc


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Sans", 8)
    canvas.setFillColor(BLACK)
    canvas.drawString(20 * mm, 12 * mm, "Sprint Sentinel — Codegeist 2026 handover")
    canvas.drawRightString(190 * mm, 12 * mm, f"Page {doc.page}")
    canvas.setLineWidth(0.4)
    canvas.line(20 * mm, 16 * mm, 190 * mm, 16 * mm)
    canvas.restoreState()


def main():
    story, toc = parse(SRC.read_text(encoding="utf-8"))
    # Insert a table of contents after the intro paragraphs (before section 0).
    first_h2 = next(n for n, f in enumerate(story) if isinstance(f, Paragraph) and f.style.name == "h2")
    toc_flow = [Spacer(1, 4), Paragraph("Contents", styles["h2"])]
    toc_flow += [Paragraph(f'<a href="#s{n + 1}">{inline(t)}</a>', styles["toc"]) for n, t in enumerate(toc)]
    toc_flow.append(PageBreak())
    story = story[:first_h2] + toc_flow + story[first_h2:]
    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm,
                            bottomMargin=22 * mm, title="Sprint Sentinel — Handover", author="Sprint Sentinel team",
                            subject="Codegeist 2026 completion and submission guide")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
