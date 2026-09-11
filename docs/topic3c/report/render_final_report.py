from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = ROOT / "output" / "pdf" / "topic3c-adaptive-memory-final-report-cn.pdf"
BASE_PATH = Path(__file__).with_name("render_report.py")

spec = importlib.util.spec_from_file_location("topic3c_report_base", BASE_PATH)
base = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(base)

NAVY = base.NAVY
BLUE = base.BLUE
TEAL = base.TEAL
GREEN = base.GREEN
AMBER = base.AMBER
RED = base.RED
INK = base.INK
MUTED = base.MUTED
LINE_COLOR = base.LINE_COLOR
PALE_BLUE = base.PALE_BLUE
PALE_GREEN = base.PALE_GREEN
PALE_AMBER = base.PALE_AMBER
PALE_RED = base.PALE_RED
PAPER = base.PAPER


def final_styles():
    st = base.styles()
    st["title"] = ParagraphStyle(
        "final-title", parent=st["title"], fontSize=24, leading=33, spaceAfter=8
    )
    st["table"] = ParagraphStyle(
        "final-table", parent=st["table"], fontSize=7.4, leading=10.5
    )
    st["table_bold"] = ParagraphStyle(
        "final-table-bold", parent=st["table_bold"], fontSize=7.4, leading=10.5
    )
    st["metric_small"] = ParagraphStyle(
        "metric-small", fontName="CN-Bold", fontSize=12, leading=16,
        alignment=TA_CENTER, textColor=NAVY
    )
    return st


def p(text, style):
    return Paragraph(text, style)


def tbl(rows, widths, st, row_colors=None):
    converted = []
    for row_index, row in enumerate(rows):
        style = st["table_bold"] if row_index == 0 else st["table"]
        converted.append([cell if isinstance(cell, Paragraph) else p(str(cell), style) for cell in row])
    table = Table(converted, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), "CN"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE_COLOR),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ]
    for index, color in enumerate(row_colors or [], start=1):
        commands.append(("BACKGROUND", (0, index), (-1, index), color))
    table.setStyle(TableStyle(commands))
    return table


def metric_cards(st):
    values = [
        ("923", "历史回放 query", PALE_BLUE),
        ("296", "冻结验证 query", PALE_AMBER),
        ("17 + 14", "TS + Python 测试", PALE_GREEN),
        ("1 / 5", "SWE resolved", PALE_RED),
    ]
    cells = []
    for value, label, _ in values:
        cells.append(Table(
            [[p(value, st["metric_small"])], [p(label, st["metric_label"])]],
            colWidths=[43.5 * mm],
            style=TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]),
        ))
    table = Table([cells], colWidths=[43.5 * mm] * 4)
    commands = [
        ("BOX", (0, 0), (-1, -1), 0.5, LINE_COLOR),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.white),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]
    for index, (_, _, color) in enumerate(values):
        commands.append(("BACKGROUND", (index, 0), (index, 0), color))
    table.setStyle(TableStyle(commands))
    return table


def architecture_diagram():
    d = Drawing(492, 208)
    boxes = [
        (8, 145, 98, 42, "Top-10\n安全锚点", NAVY),
        (132, 145, 98, 42, "四种有界动作\nK = 10/8/5 + L0", BLUE),
        (256, 145, 98, 42, "linked evidence\n当前源码核验", TEAL),
        (380, 145, 104, 42, "Agent 执行\n编译与测试", GREEN),
        (55, 50, 155, 50, "同任务配对延迟反馈\nquality / recall / token", AMBER),
        (282, 50, 155, 50, "项目级 PromotionGate\nonboarding / shadow / fallback", RED),
    ]
    for x, y, w, h, label, color in boxes:
        d.add(Rect(x, y, w, h, rx=4, ry=4, fillColor=color, strokeColor=color))
        for index, line in enumerate(label.split("\n")):
            d.add(String(x + w / 2, y + h / 2 + 4 - 13 * index, line,
                         fontName="CN-Bold" if index == 0 else "CN",
                         fontSize=8 if index == 0 else 6.8,
                         fillColor=colors.white, textAnchor="middle"))
    for x1, y1, x2, y2 in [
        (106, 166, 132, 166), (230, 166, 256, 166), (354, 166, 380, 166),
        (432, 145, 360, 100), (282, 75, 210, 75), (125, 100, 57, 145),
    ]:
        d.add(Line(x1, y1, x2, y2, strokeColor=MUTED, strokeWidth=1.2))
    d.add(String(246, 15, "warmup、状态损坏、L0 失败或硬回归时回退 Top-10",
                 fontName="CN", fontSize=8, fillColor=MUTED, textAnchor="middle"))
    return d


def evidence_chart():
    d = Drawing(492, 178)
    rows = [
        ("历史回放 F1", 0.02781, BLUE),
        ("历史回放 recall", 0.03952, TEAL),
        ("冻结验证 F1", -0.00520, AMBER),
        ("冻结验证 recall", -0.03027, RED),
    ]
    center = 250
    scale = 3900
    d.add(Line(center, 20, center, 160, strokeColor=MUTED, strokeWidth=0.8))
    for index, (label, value, color) in enumerate(rows):
        y = 137 - index * 34
        d.add(String(8, y + 4, label, fontName="CN", fontSize=8, fillColor=INK))
        width = abs(value) * scale
        x = center if value >= 0 else center - width
        d.add(Rect(x, y, width, 14, fillColor=color, strokeColor=None))
        text_x = center + width + 7 if value >= 0 else center - width - 7
        anchor = "start" if value >= 0 else "end"
        d.add(String(text_x, y + 3, f"{value:+.5f}", fontName="CN-Bold",
                     fontSize=8, fillColor=color, textAnchor=anchor))
    d.add(String(center, 4, "0 = Top-10；右侧为提升，左侧为下降",
                 fontName="CN", fontSize=7, fillColor=MUTED, textAnchor="middle"))
    return d


def page_decorator(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    canvas.setStrokeColor(LINE_COLOR)
    canvas.line(18 * mm, 16 * mm, 192 * mm, 16 * mm)
    canvas.setFont("CN", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10.5 * mm, "TencentDB Agent Memory | 题目三 C | 最终实验报告")
    canvas.drawRightString(192 * mm, 10.5 * mm, str(doc.page))
    canvas.restoreState()


def build_story(st):
    story = [
        Spacer(1, 9 * mm),
        p("自适应记忆在编程任务中的优化", st["title"]),
        p("最终实验报告 | 题目三 C | 2026-09-11", st["subtitle"]),
        base.callout(
            "最终结论：方案已经形成可运行、可回放、可回退的编程记忆优化闭环；历史长对话回放出现质量与成本正收益，但冻结切分未守住 evidence recall，因此候选策略不晋升，Top-10 继续作为默认安全策略。编程侧尚无稳定 SWE-bench pass@1 提升证据。",
            st, PALE_AMBER, AMBER,
        ),
        Spacer(1, 6 * mm),
        metric_cards(st),
        Spacer(1, 7 * mm),
        p("交付判断", st["h1"]),
        tbl([
            ["问题", "结论", "交付状态"],
            ["记忆能否在长对话中带来收益", "历史回放为正；冻结验证出现 recall 下降", "保留候选，不默认启用"],
            ["编程反馈能否驱动策略", "compile、tests、regression、pass@1 和 token 已进入配对反馈", "机制与单测完成"],
            ["是否已证明提高编程成功率", "5 题 SWE 对照未增加 resolved", "不作成功率提升主张"],
            ["能否安全交付", "默认关闭、shadow 学习、硬失败降级、干净包复现通过", "可提交"],
        ], [42*mm, 92*mm, 40*mm], st, [colors.white, PALE_BLUE, PALE_AMBER, PALE_GREEN]),
        Spacer(1, 5 * mm),
        p("代码基线：TencentDB Agent Memory v2.0.0-beta.1。交付分支：topic3c-adaptive-memory。", st["small"]),
        PageBreak(),

        p("1. 研究问题与范围", st["h1"]),
        p("固定 Top-10 召回稳定但成本较高，固定缩小 K 又可能丢失关键证据。编程任务还要求补丁可应用、可编译、通过目标测试且不引入回归，仅用文本相似度或答案 F1 作为反馈并不充分。", st["body"]),
        p("研究问题", st["h2"]),
        base.callout("在不改写底层 FTS5、向量检索与 RRF 的前提下，能否利用任务结束后的可执行反馈，自适应选择记忆组织动作，并在证据不足或风险出现时可靠回退？", st),
        Spacer(1, 5 * mm),
        p("职责边界", st["h2"]),
        tbl([
            ["范围内", "范围外"],
            ["调整 Top-K 与轻量 L0 补证", "重写 MemoryCore 的 FTS5、embedding 或 RRF"],
            ["按 team / agent / project 隔离学习状态", "使用 evaluator-only gold patch 或 hidden tests 生成补丁"],
            ["用延迟配对反馈决定候选是否可晋升", "把 token 节省直接等同于任务成功"],
            ["用 linked 线索引导模型回到当前源码核验", "把未绑定版本的函数摘要直接当作事实答案"],
        ], [87*mm, 87*mm], st, [colors.white, PALE_BLUE, colors.white, PALE_AMBER]),
        Spacer(1, 6 * mm),
        p("方案闭环", st["h2"]),
        architecture_diagram(),
        PageBreak(),

        p("2. 最终方案", st["h1"]),
        p("最终工程候选由四部分组成：Top-10 安全锚点、有界动作选择、同任务配对延迟反馈、按项目作用域的晋升与回退。学习器可使用经验均值或不新增 LLM 调用的 LinUCB。", st["body"]),
        tbl([
            ["组件", "作用", "安全约束"],
            ["AdaptiveRecallPolicy", "在 top10、top8、top5、top5-l0 中决策并持久化作用域状态", "warmup 与 shadow 强制 Top-10；状态损坏或过期回退"],
            ["CodingFeedback", "将 pass@1、patch、compile、tests、regression 与 token 归一化", "必须与同任务 Top-10 成对记录；质量和成本分开"],
            ["PromotionGate", "检查样本量、编程反馈覆盖率、质量/成本下界与硬失败", "未达标不晋升；hard regression 立即降级"],
            ["AutoRecall 接入", "只覆盖 maxResults，top5-l0 复用已有 L0 FTS5", "默认关闭；L0 查询失败时保留 L1"],
            ["SWE 实验求解器", "linked 定位、asserted reproduction、编辑、窄回归与回滚", "与生产路径隔离，不替换原生 prompt"],
        ], [38*mm, 77*mm, 59*mm], st, [PALE_BLUE, colors.white, PALE_BLUE, colors.white, PALE_BLUE]),
        Spacer(1, 6 * mm),
        p("函数信息如何进入记忆", st["h2"]),
        p("函数用途、参数和相关符号既可由 LLM 抽取，也可由 AST 或索引器确定性生成。当前方案没有把自由文本函数卡片直接作为答案，而是把符号、定义位置和源码路径用作 linked retrieval 线索。这样模型可以更快定位，同时仍需在当前提交源码中核验签名和行为，降低陈旧摘要造成的误导。", st["body"]),
        base.callout("后续可实现结构化函数卡片，但应先加入 commit/version 绑定、AST 签名校验、引用位置和陈旧检测，再做独立消融。", st, PALE_BLUE, BLUE),
        PageBreak(),

        p("3. 方案演化与筛选", st["h1"]),
        tbl([
            ["阶段", "观察", "最终处理"],
            ["固定 Top-5 / Top-8", "节省 token，但不同 query 的质量变化不一致", "保留为有限动作，不全局替换"],
            ["L1 + L0 邻居", "可补原始上下文，成本仍可控", "形成 top5-l0；失败不影响 L1"],
            ["KNN / 分桶", "历史回放为正，小样本和分布漂移下不稳定", "KNN24 保留为研究主线，不作默认"],
            ["LinUCB", "无需额外 selector 调用，可表达 query 差异", "与 mean 并列实现，受门限保护"],
            ["函数卡片", "可缩短定位，但脱离当前源码可能陈旧", "改为 linked 线索，保留版本化卡片方向"],
            ["即时记忆", "容易固化偶然错误或错误修复", "改为编译/测试后的延迟反馈"],
            ["Reproduction + repair", "多消耗 33,626 token，5 题 resolved 仍为 1", "保留验证纪律，不将更多轮次视为收益"],
            ["置信下界 KNN", "开发集仍选 KNN24；冻结验证 recall 下降", "不晋升，停止在已观察数据上继续调参"],
            ["MLP / 离线 Q", "30 题样本中 MLP 过拟合，Q 的 F1 点增益伴随 recall 损失", "小样本下不增加模型复杂度"],
        ], [34*mm, 73*mm, 67*mm], st, [colors.white, PALE_BLUE, colors.white, PALE_BLUE, colors.white, PALE_BLUE, colors.white, PALE_BLUE, PALE_AMBER]),
        Spacer(1, 6 * mm),
        base.callout("筛选标准不是单次最高分，而是同时满足可归因、可回退、质量下界、证据召回下界、成本预算和实现复杂度约束。", st, PALE_GREEN, GREEN),
        PageBreak(),

        p("4. 长对话实验结果", st["h1"]),
        p("历史回放覆盖 5 个 LoCoMo 对话，每个对话前 24 条用于 onboarding，之后共 923 条 query。结果相对同输入 Top-10 为正，但这些对话在方法开发期间已被观察，因此只能作为机制证据，不能称为新独立 holdout。", st["body"]),
        tbl([
            ["历史回放指标", "Adaptive", "相对 Top-10", "解释"],
            ["Token F1", "0.21458", "+0.02781", "query 与 dialog-cluster bootstrap 区间均不跨 0"],
            ["Evidence recall", "0.36380", "+0.03952", "query 与 dialog-cluster bootstrap 区间均不跨 0"],
            ["平均输入 token", "209.50", "-63.57", "节省率 23.28%"],
        ], [43*mm, 30*mm, 36*mm, 65*mm], st, [PALE_GREEN, PALE_GREEN, PALE_GREEN]),
        Spacer(1, 6 * mm),
        p("冻结切分", st["h2"]),
        p("最终一轮固定 locomo-8/9/0 为开发集、locomo-1/7 为验证集，不新增 LLM 调用。开发集选择置信系数 0，即原 KNN24；296 条验证 query 上三个置信版本都未同时守住 F1 与 recall。", st["body"]),
        evidence_chart(),
        tbl([
            ["置信系数", "F1 差值", "Recall 差值", "Token 差值/题", "晋升"],
            ["0（冻结选择）", "-0.00520", "-0.03027", "-50.59", "否"],
            ["0.5", "+0.00429", "-0.02293", "-43.23", "否"],
            ["1.0", "-0.00481", "-0.02349", "-33.30", "否"],
        ], [42*mm, 31*mm, 35*mm, 39*mm, 27*mm], st, [PALE_RED, PALE_AMBER, PALE_RED]),
        PageBreak(),

        p("5. 跨数据集与编程实验", st["h1"]),
        p("LongMemEval", st["h2"]),
        p("在 30 条缓存答案上，ridge-gated-0.01 仅对 4 条 query 使用 Top-5，F1 和 recall 差值均为 0，每题节省 22.9 token，token bootstrap 95% CI 为 [-46.37,-3.53]。样本小且存在跨数据集特征漂移，因此不把该参数迁移到 LoCoMo。", st["body"]),
        p("SWE 编程场景", st["h2"]),
        tbl([
            ["实验", "Public validation", "Official resolved", "API token", "结论"],
            ["5 题 public reproduction", "5 / 5 有效", "1 / 5", "114,384", "基础反馈链路"],
            ["reproduction + repair", "5 / 5 有效", "1 / 5", "148,010", "增加成本，未增加解决数"],
            ["Matplotlib 13989", "通过公开复现与窄回归", "未单列", "-", "linked 定位恢复有效候选补丁"],
            ["Astropy 14096 adaptive", "记忆延迟注入成功", "无有效补丁", "-", "触发机制有效，任务收益未证实"],
        ], [42*mm, 42*mm, 31*mm, 27*mm, 32*mm], st, [colors.white, PALE_AMBER, PALE_RED, PALE_RED]),
        Spacer(1, 6 * mm),
        p("编程反馈与门控验证", st["h2"]),
        tbl([
            ["阶段", "输入状态", "行为"],
            ["任务 1-23", "样本不足", "onboarding / Top-10"],
            ["任务 24", "质量、成本与编程覆盖率通过", "promoted"],
            ["随后硬失败", "regression + stale evidence", "立即 demoted / Top-10"],
        ], [40*mm, 78*mm, 56*mm], st, [colors.white, PALE_GREEN, PALE_RED]),
        Spacer(1, 5 * mm),
        base.callout("Promotion smoke 证明状态机和硬回退机制，不是效果数据。当前真实编程反馈仅 2 行，低于 24 行晋升要求。", st, PALE_AMBER, AMBER),
        PageBreak(),

        p("6. 证据、结论与局限", st["h1"]),
        tbl([
            ["证据层级", "可以支持", "不能支持"],
            ["单元测试与 smoke", "动作、持久化、反馈、晋升和回退按设计工作", "真实任务成功率提升"],
            ["923 条历史回放", "已观察对话上存在质量/成本正收益", "新独立数据上的泛化"],
            ["296 条冻结验证", "候选没有通过双质量门，拒绝晋升是正确行为", "继续调参即可稳定转正"],
            ["30 条 LongMemEval", "低风险节省 token 的局部候选", "跨数据集参数迁移"],
            ["5 题 SWE + 个案", "linked 定位、复现和回退具有过程价值", "记忆稳定提高 pass@1"],
        ], [38*mm, 72*mm, 64*mm], st, [PALE_GREEN, PALE_BLUE, PALE_AMBER, colors.white, PALE_RED]),
        Spacer(1, 6 * mm),
        p("最终判断", st["h2"]),
        base.callout("目前最合理的编程场景优化方案，是保留 Top-10 默认路径，将 KNN24 / LinUCB 作为 shadow 候选，用 linked evidence 降低定位成本，用 compile、tests、regression 和 pass@1 做延迟配对反馈，并只在跨项目证据通过双质量门后晋升。", st, PALE_GREEN, GREEN),
        Spacer(1, 6 * mm),
        p("主要局限", st["h2"]),
        p("LoCoMo 对话已参与方法开发；LongMemEval 只有 30 条；SWE 任务数量少且模型能力构成明显上限；真实编程反馈覆盖不足；PromotionGate 目前位于实验适配/回放层，尚未默认串入 AutoRecall 的线上决策路径。", st["body"]),
        p("因此本报告将贡献表述为“可控的记忆优化与验证闭环”，而不是“已证明提高编程成功率”。", st["body"]),
        PageBreak(),

        p("7. 可复现性与提交内容", st["h1"]),
        p("精简仓库从上游 v2.0.0-beta.1 重建，仅保留题目三 C 的实现、结果、复现脚本与报告。离线冻结回放不调用 LLM，紧凑动作表不包含对话正文、答案文本、模型请求或凭据。", st["body"]),
        tbl([
            ["检查", "结果"],
            ["Topic 3C TypeScript", "3 个测试文件，17 / 17 通过"],
            ["Python SWE solver", "14 / 14 通过，语法编译通过"],
            ["Promotion smoke", "第 24 条晋升，hard regression 后降级"],
            ["冻结回放", "选择系数 0；F1 -0.00519565，recall -0.03026730，token -50.5912/题"],
            ["MemoryCore build", "通过"],
            ["ZIP 干净复现", "重新安装依赖后，测试、smoke、回放和构建全部通过"],
        ], [55*mm, 119*mm], st, [PALE_GREEN, PALE_GREEN, PALE_GREEN, PALE_AMBER, PALE_GREEN, PALE_GREEN]),
        Spacer(1, 5 * mm),
        p("最小复现命令", st["h2"]),
        tbl([
            ["目录", "命令"],
            ["MemoryCore", "npm install"],
            ["MemoryCore", "npm run test:topic3c"],
            ["MemoryCore", "npm run smoke:topic3c"],
            ["MemoryCore", "npm run eval:topic3c"],
            ["MemoryCore", "npm run build"],
            ["MemoryCore", "python -m pytest -q scripts/topic3-c/test_swe_agent_v2.py"],
        ], [45*mm, 129*mm], st, [colors.white, PALE_GREEN, PALE_GREEN, PALE_GREEN, PALE_GREEN, colors.white]),
        Spacer(1, 5 * mm),
        p("安全边界", st["h2"]),
        p("提交不包含 API key、模型请求缓存、Docker 镜像、完整 benchmark bundle、gold patch、hidden tests、FAIL_TO_PASS、PASS_TO_PASS 或 evaluator-only 数据。", st["body"]),
        PageBreak(),

        p("8. 后续实验优先级", st["h1"]),
        tbl([
            ["优先级", "实验", "通过标准"],
            ["P0", "冻结模型、预算与基线，在更多独立仓库任务比较 no-memory、Top-10、候选策略", "跨项目重复出现 resolved 或公开验证收益，且回归不增加"],
            ["P0", "积累真实编程配对反馈，保持候选处于 shadow", "达到 24 条覆盖门槛后再评估晋升"],
            ["P1", "按 query 类型学习 K 与 L0 配额，不新增 selector LLM", "F1 与 evidence recall 下界不降，token 满足预算"],
            ["P1", "版本化函数卡片：AST 签名、commit 绑定、引用位置、陈旧检测", "在独立消融中减少定位步数，不降低 patch validity"],
            ["P2", "真正按需的增量 L2/L3", "只在基线证据不足时读取，并证明额外成本有回报"],
        ], [25*mm, 89*mm, 60*mm], st, [PALE_GREEN, PALE_GREEN, PALE_BLUE, PALE_BLUE, colors.white]),
        Spacer(1, 7 * mm),
        base.callout("提交主线：我们没有用负结果否定记忆系统，而是用负结果校准启用条件。当前价值在于让记忆何时被调用、如何被验证、何时回退都成为可学习且可审计的过程。", st, PALE_BLUE, BLUE),
        Spacer(1, 7 * mm),
        p("参考材料", st["h2"]),
        p("1. TencentDB Agent Memory v2.0.0-beta.1。<br/>2. ReProAgent: 分阶段的定位、根因、测试规划与测试生成。<br/>3. Self-Evolving Coding Agents: 可执行反馈、轨迹记忆、可逆性及成本/泛化门禁。<br/>4. 仓库内 IMPLEMENTATION.md、EXPERIMENT_HISTORY.md、RESULTS.md 与 CLEANROOM.md。", st["body"]),
        Spacer(1, 7 * mm),
        p("报告数据冻结日期：2026-09-11。", st["small"]),
    ]
    return story


def main():
    parser = argparse.ArgumentParser(description="Render the final Topic 3C Chinese report.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--font", type=Path, default=Path("C:/Windows/Fonts/msyh.ttc"))
    parser.add_argument("--bold-font", type=Path, default=Path("C:/Windows/Fonts/msyhbd.ttc"))
    args = parser.parse_args()

    base.register_fonts(args.font, args.bold_font)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(args.output), pagesize=A4,
        rightMargin=18 * mm, leftMargin=18 * mm,
        topMargin=17 * mm, bottomMargin=21 * mm,
        title="自适应记忆在编程任务中的优化：最终实验报告",
        author="Topic 3C",
        subject="TencentDB Agent Memory adaptive recall and coding evaluation",
    )
    doc.build(build_story(final_styles()), onFirstPage=page_decorator, onLaterPages=page_decorator)
    print(args.output)


if __name__ == "__main__":
    main()
