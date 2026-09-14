"""Render FINAL_REPORT.md as the single source of the submitted PDF."""
from __future__ import annotations

import argparse
import html
import importlib.util
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'docs/topic3c/FINAL_REPORT.md'
OUTPUT = ROOT / 'output/pdf/topic3c-adaptive-memory-final-report-cn.pdf'
spec = importlib.util.spec_from_file_location('report_base', Path(__file__).with_name('render_report.py'))
base = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(base)


def inline(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r'`([^`]+)`', r'<font color="#176078">\1</font>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)
    return re.sub(r'\[([^]]+)\]\(([^)]+)\)', r'\1 (\2)', text)


def build_story(source: Path):
    styles = base.styles()
    for style in styles.values():
        style.wordWrap = 'CJK'
    styles['h1'].keepWithNext = True
    styles['h2'].keepWithNext = True
    cell = ParagraphStyle('cell', parent=styles['body'], fontSize=7, leading=10, spaceAfter=0)
    header = ParagraphStyle('header', parent=cell, textColor=colors.white, fontName='CN-Bold')
    lines = source.read_text(encoding='utf-8').splitlines()
    story = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if not line:
            continue
        if line.startswith(('## 三、', '### 扩展算法', '## 七、')):
            story.append(PageBreak())
        if line.startswith('|'):
            rows = [line]
            while index < len(lines) and lines[index].strip().startswith('|'):
                rows.append(lines[index].strip())
                index += 1
            cells = []
            for row in rows:
                parts = [part.strip() for part in row.strip('|').split('|')]
                if all(re.fullmatch(r':?-+:?', part) for part in parts):
                    continue
                style = header if not cells else cell
                cells.append([Paragraph(inline(part), style) for part in parts])
            table = Table(cells, colWidths=[174 * mm / len(cells[0])] * len(cells[0]), repeatRows=1)
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), base.NAVY),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, base.PALE_BLUE]),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('GRID', (0, 0), (-1, -1), 0.3, base.LINE_COLOR),
                ('LEFTPADDING', (0, 0), (-1, -1), 5),
                ('RIGHTPADDING', (0, 0), (-1, -1), 5),
                ('TOPPADDING', (0, 0), (-1, -1), 5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ]))
            story.extend([table, Spacer(1, 9)])
        elif line.startswith('### '):
            story.append(Paragraph(inline(line[4:]), styles['h2']))
        elif line.startswith('## '):
            story.extend([Spacer(1, 9), Paragraph(inline(line[3:]), styles['h1'])])
        elif line.startswith('# '):
            story.append(Paragraph(inline(line[2:]), styles['title']))
        else:
            story.append(Paragraph(inline(line.removeprefix('> ')), styles['body']))
    return story


def page_decorator(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(base.LINE_COLOR)
    canvas.line(18 * mm, 15 * mm, 192 * mm, 15 * mm)
    canvas.setFont('CN', 8)
    canvas.setFillColor(base.MUTED)
    canvas.drawString(18 * mm, 10 * mm, 'TencentDB-Agent-Memory | 题目三方向 C | 2026-09-14')
    canvas.drawRightString(192 * mm, 10 * mm, str(doc.page))
    canvas.restoreState()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--font', type=Path, default=Path('C:/Windows/Fonts/msyh.ttc'))
    parser.add_argument('--bold-font', type=Path, default=Path('C:/Windows/Fonts/msyhbd.ttc'))
    args = parser.parse_args()
    base.register_fonts(args.font, args.bold_font)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(args.output), pagesize=A4, rightMargin=18 * mm,
                            leftMargin=18 * mm, topMargin=17 * mm, bottomMargin=28 * mm,
                            title='记忆检索自优化：方案介绍与测试结论', author='Topic 3C')
    doc.build(build_story(args.source), onFirstPage=page_decorator, onLaterPages=page_decorator)
    print(args.output)


if __name__ == '__main__':
    main()
