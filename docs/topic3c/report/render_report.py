from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = ROOT / "output" / "pdf" / "topic3c-adaptive-memory-initial-report-cn.pdf"
REPOSITORY_URL = "https://github.com/acidmelon/TencentDB-Agent-Memory"
BRANCH_URL = f"{REPOSITORY_URL}/tree/topic3c-adaptive-memory"
COMMIT_URL = f"{REPOSITORY_URL}/commit/41d028064a199357c5efc94c4d976c1c9bc98b43"

NAVY = colors.HexColor("#17324D")
BLUE = colors.HexColor("#2E6F95")
TEAL = colors.HexColor("#2A7F79")
GREEN = colors.HexColor("#4D8B57")
AMBER = colors.HexColor("#D28A24")
RED = colors.HexColor("#B74D4D")
INK = colors.HexColor("#24313D")
MUTED = colors.HexColor("#63717E")
LINE_COLOR = colors.HexColor("#D8DEE4")
PALE_BLUE = colors.HexColor("#EAF2F8")
PALE_GREEN = colors.HexColor("#EAF4EC")
PALE_AMBER = colors.HexColor("#FBF1DF")
PALE_RED = colors.HexColor("#F8E9E8")
PAPER = colors.HexColor("#FBFCFD")


def register_fonts(regular: Path, bold: Path) -> None:
    pdfmetrics.registerFont(TTFont("CN", str(regular), subfontIndex=0))
    pdfmetrics.registerFont(TTFont("CN-Bold", str(bold), subfontIndex=0))


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", fontName="CN-Bold", fontSize=25, leading=34, textColor=NAVY, spaceAfter=8),
        "subtitle": ParagraphStyle("subtitle", fontName="CN", fontSize=11.5, leading=18, textColor=MUTED, spaceAfter=14),
        "h1": ParagraphStyle("h1", fontName="CN-Bold", fontSize=17, leading=24, textColor=NAVY, spaceAfter=9),
        "h2": ParagraphStyle("h2", fontName="CN-Bold", fontSize=11.5, leading=17, textColor=BLUE, spaceBefore=6, spaceAfter=5),
        "body": ParagraphStyle("body", fontName="CN", fontSize=9, leading=14.5, textColor=INK, spaceAfter=6),
        "small": ParagraphStyle("small", fontName="CN", fontSize=7.5, leading=11.5, textColor=MUTED),
        "table": ParagraphStyle("table", fontName="CN", fontSize=7.7, leading=11, textColor=INK),
        "table_bold": ParagraphStyle("table_bold", fontName="CN-Bold", fontSize=7.7, leading=11, textColor=INK),
        "callout": ParagraphStyle("callout", fontName="CN-Bold", fontSize=11, leading=18, textColor=NAVY),
        "metric": ParagraphStyle("metric", fontName="CN-Bold", fontSize=15, leading=19, alignment=TA_CENTER, textColor=NAVY),
        "metric_label": ParagraphStyle("metric_label", fontName="CN", fontSize=7.5, leading=10, alignment=TA_CENTER, textColor=MUTED),
        "link": ParagraphStyle("link", fontName="CN", fontSize=7.6, leading=12, textColor=BLUE),
        "center": ParagraphStyle("center", parent=base["BodyText"], fontName="CN", fontSize=8, leading=12, alignment=TA_CENTER, textColor=INK),
    }


def p(text: str, style) -> Paragraph:
    return Paragraph(text, style)


def table(data, widths, *, header=True, row_colors=None, font_size=7.7):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), "CN"),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("LEADING", (0, 0), (-1, -1), font_size + 3.2),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE_COLOR),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands += [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "CN-Bold"),
        ]
    for idx, color in enumerate(row_colors or [], start=1 if header else 0):
        commands.append(("BACKGROUND", (0, idx), (-1, idx), color))
    t.setStyle(TableStyle(commands))
    return t


def callout(text: str, st, background=PALE_BLUE, accent=BLUE):
    t = Table([[p(text, st["callout"]) ]], colWidths=[174 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("BOX", (0, 0), (-1, -1), 0.5, background),
        ("LINEBEFORE", (0, 0), (0, -1), 4, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return t


def metric_cards(st):
    values = [
        ("+0.02781", "Token F1 vs Top-10"),
        ("+0.03952", "Evidence recall vs Top-10"),
        ("23.28%", "输入 token 节省率"),
        ("1 / 5", "SWE official resolved"),
    ]
    cells = []
    for value, label in values:
        card = Table(
            [[p(value, st["metric"])], [p(label, st["metric_label"])]],
            colWidths=[43.5 * mm],
        )
        card.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
        cells.append(card)
    t = Table([cells], colWidths=[43.5 * mm] * 4)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (2, -1), PALE_GREEN),
        ("BACKGROUND", (3, 0), (3, -1), PALE_AMBER),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE_COLOR),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.white),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def architecture_diagram():
    d = Drawing(492, 210)
    boxes = [
        (8, 145, 105, 44, "Top-10 基线", NAVY),
        (132, 145, 105, 44, "有界动作", BLUE),
        (256, 145, 105, 44, "召回与 L0 补证", TEAL),
        (380, 145, 105, 44, "Agent 任务", GREEN),
        (70, 55, 130, 48, "配对延迟反馈\nquality / recall / token", AMBER),
        (292, 55, 130, 48, "promotion gate\nshadow / fallback", RED),
    ]
    for x, y, w, h, label, color in boxes:
        d.add(Rect(x, y, w, h, rx=5, ry=5, fillColor=color, strokeColor=color))
        lines = label.split("\n")
        for i, line in enumerate(lines):
            d.add(String(x + w / 2, y + h / 2 + 4 - i * 13, line, fontName="CN-Bold" if i == 0 else "CN", fontSize=8.5 if i == 0 else 7, fillColor=colors.white, textAnchor="middle"))
    for x1, y1, x2, y2 in [(113,167,132,167),(237,167,256,167),(361,167,380,167),(432,145,357,103),(292,79,200,79),(135,103,60,145)]:
        d.add(Line(x1, y1, x2, y2, strokeColor=MUTED, strokeWidth=1.2))
    d.add(String(246, 18, "任何 warmup、状态损坏、L0 失败或硬回归均回到 Top-10", fontName="CN", fontSize=8, fillColor=MUTED, textAnchor="middle"))
    return d


def long_result_chart():
    d = Drawing(492, 150)
    items = [
        ("Token F1", 0.02781, 0.05, BLUE),
        ("Evidence recall", 0.03952, 0.05, TEAL),
        ("Token savings", 0.2328, 0.25, GREEN),
    ]
    for i, (label, value, maximum, color) in enumerate(items):
        y = 112 - i * 42
        d.add(String(8, y + 7, label, fontName="CN", fontSize=8, fillColor=INK))
        d.add(Rect(105, y, 310, 18, fillColor=colors.HexColor("#EDF0F2"), strokeColor=None))
        d.add(Rect(105, y, 310 * value / maximum, 18, fillColor=color, strokeColor=None))
        shown = f"+{value:.5f}" if i < 2 else f"{value:.2%}"
        d.add(String(428, y + 5, shown, fontName="CN-Bold", fontSize=8.5, fillColor=color))
    d.add(String(8, 5, "说明：前三项量纲不同，条形仅展示各指标相对自身坐标上限，不用于指标间大小比较。", fontName="CN", fontSize=7, fillColor=MUTED))
    return d


def page_decorator(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    canvas.setStrokeColor(LINE_COLOR)
    canvas.line(18 * mm, 16 * mm, 192 * mm, 16 * mm)
    canvas.setFont("CN", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10.5 * mm, "TencentDB Agent Memory · 题目三 C · 自适应记忆编程优化")
    canvas.drawRightString(192 * mm, 10.5 * mm, str(doc.page))
    canvas.restoreState()


def build_story(st):
    story = []

    story += [
        Spacer(1, 10 * mm),
        p("自适应记忆在编程任务中的优化", st["title"]),
        p("实现代码与初步测试结果 · 题目三 C · 2026-09-08", st["subtitle"]),
        callout("核心结论：当前方案已在长对话留出集上同时改善质量、召回与 token 成本；编程侧已完成 linked retrieval、延迟反馈、影子学习、晋升/回退和可执行 SWE 验证链路，但尚未证明历史记忆能稳定提高 SWE-bench 最终解决率。", st),
        Spacer(1, 6 * mm),
        metric_cards(st),
        Spacer(1, 7 * mm),
        p("本次交付", st["h1"]),
        table([
            ["材料", "内容", "状态"],
            ["实现代码", "AdaptiveRecallPolicy、CodingFeedback、PromotionGate、AutoRecall 接入", "已实现并测试"],
            ["实验链路", "SWE search/read/test/edit、复现门、窄回归、失败分类与回滚", "可运行"],
            ["初步结果", "LoCoMo 独立对照、5 题 SWE 结果、promotion smoke", "已固化"],
            ["研究边界", "不把机制通过写成成功率提升，不包含 gold patch 或 hidden tests", "已声明"],
        ], [27*mm, 116*mm, 31*mm], row_colors=[colors.white, PALE_BLUE, colors.white, PALE_AMBER]),
        Spacer(1, 5 * mm),
        p(f'<b>开源仓库：</b><link href="{BRANCH_URL}">{BRANCH_URL}</link>', st["link"]),
        p(f'<b>固定实现提交：</b><link href="{COMMIT_URL}">41d028064a199357c5efc94c4d976c1c9bc98b43</link>', st["link"]),
        p("基线：TencentDB Agent Memory v2.0.0-beta.1（4144434）。仓库由 GitHub Fork 流程创建，可直接核对上游来源。", st["small"]),
        PageBreak(),
    ]

    story += [
        p("1. 问题与方案定位", st["h1"]),
        p("原系统以固定 Top-10 召回为主。固定缩小 K 可以节约上下文，却可能损失关键证据；直接增加搜索或反复修复又会显著增加 token。编程任务还存在更严格的问题：一次补丁失败可能来自定位错误、过时证据、编译错误或回归，不能仅用语言相似度作为学习信号。", st["body"]),
        p("研究问题", st["h2"]),
        callout("能否在不重写 FTS5、向量检索和 RRF 的前提下，根据已完成任务的延迟反馈，自适应选择更合适的记忆组织方式，并在风险出现时可靠回退？", st, PALE_AMBER, AMBER),
        Spacer(1, 5 * mm),
        p("运行闭环", st["h2"]),
        architecture_diagram(),
        p("设计不变量", st["h2"]),
        table([
            ["不变量", "实现方式"],
            ["Top-10 始终可用", "warmup / shadow / 失败路径强制使用基线"],
            ["动作空间有界", "只允许 top10、top8、top5、top5-l0"],
            ["收益可归因", "动作与同任务 Top-10 结果成对记录"],
            ["质量与成本分离", "quality、recall、token 分别建模"],
            ["项目状态隔离", "team / agent / project 组成学习作用域；缺省项目显式落到 default-project"],
        ], [48*mm,126*mm], row_colors=[colors.white, PALE_BLUE, colors.white, PALE_BLUE, colors.white]),
        PageBreak(),
    ]

    story += [
        p("2. 实现与代码质量", st["h1"]),
        table([
            ["模块", "职责", "关键安全属性"],
            ["adaptive-policy.ts", "经验均值 / LinUCB、持久化状态、有限动作", "原子 rename、每作用域更新锁、TTL、损坏回退"],
            ["coding-feedback.ts", "将 compile、tests、regression、pass@1 转为配对质量", "字段校验；不以 token 代替成功"],
            ["promotion-gate.ts", "质量/成本下界、覆盖率、晋升和硬降级", "学习与启用分离；当前在实验适配/回放层"],
            ["auto-recall.ts", "取得策略决策并覆盖 maxResults；可补 L0 证据", "L0 失败保留 L1；默认关闭"],
            ["swe-agent-v2.py", "linked 定位、复现、编辑、窄回归、回滚", "实验求解器；不读取 evaluator-only 信息"],
        ], [35*mm, 77*mm, 62*mm], row_colors=[colors.white, PALE_BLUE, colors.white, PALE_BLUE, colors.white]),
        Spacer(1, 5 * mm),
        p("提交前审查结论", st["h2"]),
        table([
            ["维度", "结论"],
            ["与上游风格一致性", "沿用 TypeScript ESM、typed interface、现有 hook 目录和日志方式；Python 实验代码与生产路径隔离。"],
            ["注释", "主要解释安全锚点、反馈语义与 fallback 原因；没有为显然语句堆叠注释。"],
            ["测试", "3 个 TypeScript 文件 17 项、Python 14 项、插件构建及 promotion smoke 均通过。"],
            ["已修问题", "AutoRecall 现会把调用方提供的 projectId 传入策略作用域；容忍阈值注释明确为 delta 下界。"],
            ["刻意不做的重构", "adaptive-policy.ts 约 458 行，后续可拆持久化/统计/学习器；中期提交前拆分会扩大回归面。"],
        ], [39*mm,135*mm], row_colors=[PALE_GREEN, colors.white, PALE_GREEN, colors.white, PALE_AMBER]),
        Spacer(1, 5 * mm),
        callout("质量判断：达到可审查、可运行的中期实现标准。当前最重要的改进不是增加注释数量，而是扩大独立任务验证，并让上层入口提供真实 projectId。", st, PALE_GREEN, GREEN),
        PageBreak(),
    ]

    evolution_rows = [
        ["阶段", "主要观察", "最终处理"],
        ["固定 Top-5 / 8", "节省 token，但查询间质量变化不一致", "保留为动作，不全局替换"],
        ["L1 + L0 邻居", "可补原始上下文，成本可控", "形成 top5-l0；失败保留 L1"],
        ["KNN / 分桶", "小样本容易受局部噪声影响", "保留稳定特征与收缩思想"],
        ["LinUCB", "无需额外 LLM selector，可表达上下文差异", "与 mean 并列；受 warmup 和门限保护"],
        ["函数卡片", "有助定位，但自由文本可能陈旧或误导", "改为可回到当前源码核验的 linked 线索"],
        ["即时记忆", "容易固化偶然错误", "改为编译/测试后的延迟配对反馈"],
        ["Reproduction + repair", "多 33,626 token，5 题解决数仍为 1", "保留验证纪律，不把更多轮次当收益"],
    ]
    story += [
        p("3. 探索实验与方案演化", st["h1"]),
        p("探索实验的作用是解释当前设计从何而来，而不是把所有临时产物放进交付仓库。下面只保留改变方案选择的结果。", st["body"]),
        table(evolution_rows, [35*mm, 72*mm, 67*mm], row_colors=[colors.white, PALE_BLUE, colors.white, PALE_BLUE, colors.white, PALE_BLUE, colors.white]),
        Spacer(1, 6 * mm),
        p("当前工程候选", st["h2"]),
        callout("Top-10 安全锚点 + 有界自适应动作 + 同任务配对延迟反馈 + 按项目作用域的晋升/回退；编程侧叠加 linked retrieval、test-first reproduction、窄回归和失败回滚。", st),
        Spacer(1, 5 * mm),
        p("为何暂不直接注入函数用途卡片", st["h2"]),
        p("函数名、用途和参数可由同一 LLM 抽取，也可以由 AST/索引器确定性生成。但如果卡片脱离当前提交，它可能把旧签名或错误解释直接放进上下文。现阶段更稳妥的做法是把函数信息作为检索线索，附带文件与符号位置，让模型回到当前源码核验；待建立版本绑定和陈旧检测后，再评估结构化函数卡片。", st["body"]),
        p("选择标准", st["h2"]),
        p("当前方案不是被宣称为 SWE 成功率的全局最优，而是在质量、成本、安全性、可归因性和实现复杂度之间最合理的候选。完整演化记录见 docs/topic3c/EXPERIMENT_HISTORY.md。", st["body"]),
        PageBreak(),
    ]

    story += [
        p("4. 长对话场景：已有正向独立对照", st["h1"]),
        p("冻结策略在 5 个未参与方法开发的 LoCoMo 对话上验证。每个对话前 24 条用于 onboarding，之后共评价 923 条 query；比较对象是同一输入下的 Top-10。", st["body"]),
        long_result_chart(),
        table([
            ["指标", "Adaptive", "相对 Top-10", "95% CI（query / dialog cluster）"],
            ["Token F1", "0.21458", "+0.02781", "[+0.01427,+0.04153] / [+0.01851,+0.03546]"],
            ["Evidence recall", "0.36380", "+0.03952", "[+0.02046,+0.05896] / [+0.00964,+0.05881]"],
            ["平均输入 token", "209.50", "-63.57", "[-67.28,-59.89] / [-73.14,-55.14]"],
            ["Token 节省率", "-", "23.28%", "由同一批配对输入计算"],
        ], [38*mm, 27*mm, 32*mm, 77*mm], row_colors=[PALE_GREEN, PALE_GREEN, PALE_GREEN, colors.white]),
        Spacer(1, 6 * mm),
        p("可支持的结论", st["h2"]),
        callout("在这 5 个独立对话、923 条评估 query 的固定协议下，自适应组织相对 Top-10 同时提高 F1 与 evidence recall，并减少输入 token；两类 bootstrap 区间均不跨 0。", st, PALE_GREEN, GREEN),
        Spacer(1, 5 * mm),
        p("边界", st["h2"]),
        p("独立单位只有 5 个对话，且 LoCoMo 是公开长对话代理任务，不是软件仓库任务。它证明自适应记忆机制可以产生质量/成本收益，但不能直接推导 SWE-bench 成功率提升。", st["body"]),
        PageBreak(),
    ]

    story += [
        p("5. 编程场景：机制成立，成功率收益待验证", st["h1"]),
        table([
            ["实验", "公开复现", "Official resolved", "API token", "结论"],
            ["5 题 public reproduction", "5 / 5", "1 / 5", "114,384", "基础求解链路"],
            ["reproduction + repair", "5 / 5", "1 / 5", "148,010", "多 33,626 token，未增加解决数"],
            ["Matplotlib 13989", "通过", "未单列", "-", "linked 定位 + 窄回归得到公开验证补丁"],
            ["Astropy 14096 adaptive", "记忆注入成功", "无有效补丁", "-", "触发成功不等于任务成功"],
        ], [43*mm, 30*mm, 30*mm, 25*mm, 46*mm], row_colors=[colors.white, PALE_AMBER, PALE_GREEN, PALE_RED]),
        Spacer(1, 6 * mm),
        p("Promotion smoke", st["h2"]),
        table([
            ["阶段", "观察", "系统行为"],
            ["任务 1-23", "样本不足", "onboarding / Top-10"],
            ["任务 24", "质量、成本与编程覆盖率通过", "promoted"],
            ["硬回归任务", "regression + stale evidence", "立即 demoted / Top-10"],
        ], [42*mm, 75*mm, 57*mm], row_colors=[colors.white, PALE_GREEN, PALE_RED]),
        Spacer(1, 5 * mm),
        callout("Smoke 只证明门控状态机和回退机制，不是效果数据。PromotionGate 当前由实验适配/回放层调用，尚未默认串入 AutoRecall 线上路径。", st, PALE_AMBER, AMBER),
        Spacer(1, 5 * mm),
        p("目前能确认", st["h2"]),
        p("候选源码组织可改善部分任务的目标定位；asserted reproduction、窄测试、失败分类和回滚可减少无效验收；编译、测试和回归反馈能进入自适应策略。", st["body"]),
        p("目前不能确认", st["h2"]),
        p("历史 issue 记忆能稳定提高 SWE-bench resolved；函数用途卡片优于 linked 源码；当前少量开发题能够代表跨项目泛化。", st["body"]),
        PageBreak(),
    ]

    story += [
        p("6. 复现、交付与下一阶段", st["h1"]),
        p("仓库结构", st["h2"]),
        table([
            ["路径", "用途"],
            ["MemoryCore/src/core/hooks/", "自适应策略、编程反馈、晋升门、AutoRecall 接入与单测"],
            ["MemoryCore/scripts/topic3-c/", "反馈更新、回放、SWE 适配器与实验求解器"],
            ["docs/topic3c/", "实现说明、结果、探索演化与报告生成器"],
            ["results/", "精炼后的机器可读初步结果和 promotion smoke"],
        ], [53*mm,121*mm], row_colors=[colors.white, PALE_BLUE, colors.white, PALE_BLUE]),
        Spacer(1, 4 * mm),
        p("最小复现", st["h2"]),
        table([
            ["环境", "命令", "已记录结果"],
            ["Node >=22.16", "cd MemoryCore && npm install", "依赖准备"],
            ["TypeScript", "npm run test:topic3c", "3 files / 17 passed"],
            ["Build", "npm run build:plugin", "passed"],
            ["Smoke", "npm run smoke:topic3c", "task 24 promoted; hard failure demoted"],
            ["Python", "python -m pytest -q scripts/topic3-c/test_swe_agent_v2.py", "14 passed"],
        ], [32*mm, 98*mm, 44*mm], row_colors=[colors.white, PALE_GREEN, PALE_GREEN, PALE_GREEN, PALE_GREEN]),
        Spacer(1, 4 * mm),
        p("下一阶段实验", st["h2"]),
        p("冻结模型、预算与基线，在更多独立仓库任务上比较 no-memory、Top-10 和候选策略；按项目报告 resolved、公开测试、回归、token 与失败类型。只有跨项目重复出现收益后，才把 promotion gate 接入默认 AutoRecall。函数卡片则应先补版本绑定、AST 校验和陈旧检测，再做独立消融。", st["body"]),
        callout("中期结论：已经交付可运行的核心机制和诚实的初步结果。长对话场景观察到正向质量/成本收益；编程场景的主要贡献目前是更可控、可验证、可回退的记忆优化闭环，而非已证实的成功率提升。", st, PALE_GREEN, GREEN),
        Spacer(1, 5 * mm),
        p(f'<b>仓库分支：</b><link href="{BRANCH_URL}">{BRANCH_URL}</link>', st["link"]),
        p(f'<b>固定实现：</b><link href="{COMMIT_URL}">41d028064a199357c5efc94c4d976c1c9bc98b43</link>', st["link"]),
        p("安全说明：公开仓库不包含 API key、模型缓存、Docker 镜像、完整 benchmark bundle、gold patch 或 hidden tests。", st["small"]),
    ]
    return story


def main() -> None:
    parser = argparse.ArgumentParser(description="Render the Topic 3C concise Chinese report.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--font", type=Path, default=Path("C:/Windows/Fonts/msyh.ttc"))
    parser.add_argument("--bold-font", type=Path, default=Path("C:/Windows/Fonts/msyhbd.ttc"))
    args = parser.parse_args()
    register_fonts(args.font, args.bold_font)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(args.output),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=17 * mm,
        bottomMargin=21 * mm,
        title="自适应记忆在编程任务中的优化：实现代码与初步测试结果",
        author="Topic 3C",
        subject="TencentDB Agent Memory adaptive recall and coding evaluation",
    )
    doc.build(build_story(styles()), onFirstPage=page_decorator, onLaterPages=page_decorator)
    print(args.output)


if __name__ == "__main__":
    main()
