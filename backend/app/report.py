"""Downloadable skin report generated from real scan and plan data."""

from __future__ import annotations

import base64
import io
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

NAVY = colors.HexColor("#243B63")
GREY = colors.HexColor("#F3F5F8")
LINE = colors.HexColor("#D9E1EC")
MUTED = colors.HexColor("#55627A")


def _styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="AcneTitle", parent=styles["Title"], textColor=NAVY, fontSize=22, leading=26, spaceAfter=2))
    styles.add(ParagraphStyle(name="AcneH2", parent=styles["Heading2"], textColor=NAVY, fontSize=12, leading=15, spaceBefore=10, spaceAfter=4))
    styles.add(ParagraphStyle(name="AcneBody", parent=styles["BodyText"], fontSize=9, leading=12))
    styles.add(ParagraphStyle(name="AcneSmall", parent=styles["BodyText"], fontSize=8, leading=10, textColor=MUTED))
    return styles


def _table(rows: list[list[Any]], widths: list[float]) -> Table:
    table = Table(rows, colWidths=widths, hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, GREY]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def _safe(value: Any, fallback: str = "Not available for this scan") -> str:
    if value is None:
        return fallback
    if isinstance(value, str):
        text = value.strip()
        return text or fallback
    if isinstance(value, (list, dict)) and not value:
        return fallback
    return str(value)


def _has_data(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, dict):
        return any(v not in (None, "", [], {}, "unknown") for v in value.values())
    if isinstance(value, list):
        return len(value) > 0
    return bool(str(value).strip())


def _image_from_data_url(data_url: Any, max_width: float, max_height: float) -> Image | None:
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        return None
    try:
        _, encoded = data_url.split(",", 1)
        raw = base64.b64decode(encoded)
        reader = ImageReader(io.BytesIO(raw))
        iw, ih = reader.getSize()
        if not iw or not ih:
            return None
        scale = min(max_width / iw, max_height / ih, 1.0)
        img = Image(io.BytesIO(raw), width=iw * scale, height=ih * scale)
        img.hAlign = "LEFT"
        return img
    except Exception:
        return None


def build_report(payload: dict[str, Any]) -> bytes:
    styles = _styles()
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title="AcneLyze Skin Report",
        author="AcneLyze",
    )
    story: list[Any] = []
    scan = payload.get("scan") or {}
    detection = payload.get("detection") or {}
    analysis = payload.get("analysis") or {}
    condition = payload.get("condition") or {}
    enhancement = payload.get("enhancement") or {}
    inputs = payload.get("input") or {}
    profile = payload.get("profile") or {}

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(16 * mm, 10 * mm, "AcneLyze - Educational report, not a medical diagnosis")
        canvas.drawRightString(A4[0] - 16 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    story.append(Paragraph("AcneLyze - Skin Report", styles["AcneTitle"]))
    story.append(
        Paragraph(
            f"Generated: {datetime.now():%Y-%m-%d %H:%M} &nbsp;|&nbsp; "
            f"Scan date: {_safe(scan.get('created_at'), 'Not supplied')}",
            styles["AcneSmall"],
        )
    )
    story.append(Spacer(1, 4))

    story.append(Paragraph("1. User and scan information", styles["AcneH2"]))
    ref_rows = [["Field", "Value"]]
    ref_rows.append(["Name", _safe(profile.get("full_name"))])
    ref_rows.append(["Skin type", _safe(profile.get("skin_type"))])
    ref_rows.append(["Image", _safe(inputs.get("name"))])
    dims = "Not available for this scan"
    if inputs.get("width") and inputs.get("height"):
        dims = f"{inputs.get('width')} x {inputs.get('height')}"
    ref_rows.append(["Dimensions", dims])
    ref_rows.append(["Format", _safe(inputs.get("format"))])
    story.append(_table(ref_rows, [52 * mm, 126 * mm]))

    story.append(Paragraph("2. Analysis results", styles["AcneH2"]))
    if _has_data(analysis):
        score = analysis.get("overall_score", "N/A")
        severity = _safe(analysis.get("severity"), "N/A")
        story.append(Paragraph(f"Overall visual score: {score}/100 ({severity}). Educational visual estimate only.", styles["AcneBody"]))
        concerns = analysis.get("concerns") or []
        focus = analysis.get("focus_regions") or []
        story.append(Paragraph(f"<b>Concerns:</b> {', '.join(str(c) for c in concerns) if concerns else 'Not available for this scan'}", styles["AcneSmall"]))
        story.append(Paragraph(f"<b>Focus regions:</b> {', '.join(str(r).replace('_',' ') for r in focus) if focus else 'Not available for this scan'}", styles["AcneSmall"]))
    else:
        story.append(Paragraph("Not available for this scan.", styles["AcneBody"]))

    story.append(Paragraph("3. Predicted skin condition", styles["AcneH2"]))
    if _has_data(condition):
        primary = condition.get("primary_condition") or {}
        label = _safe(primary.get("label"))
        score = primary.get("score")
        score_text = f" ({round(float(score) * 100)}%)" if isinstance(score, (int, float)) else ""
        story.append(Paragraph(f"Primary: {label}{score_text} &nbsp;|&nbsp; Status: {_safe(condition.get('status'))}", styles["AcneBody"]))
        story.append(Paragraph(_safe(condition.get("summary"), "No condition summary available."), styles["AcneSmall"]))
        preds = condition.get("predictions") or []
        if preds:
            rows = [["Condition", "Score", "Threshold", "Selected"]]
            for p in preds:
                if not isinstance(p, dict):
                    continue
                rows.append([
                    _safe(p.get("label")),
                    f"{round(float(p.get('score', 0)) * 100)}%" if isinstance(p.get("score"), (int, float)) else "N/A",
                    f"{round(float(p.get('threshold', 0)) * 100)}%" if isinstance(p.get("threshold"), (int, float)) else "N/A",
                    "Yes" if p.get("selected") else "No",
                ])
            if len(rows) > 1:
                story.append(_table(rows, [74 * mm, 24 * mm, 28 * mm, 20 * mm]))
    else:
        story.append(Paragraph("Not available for this scan.", styles["AcneBody"]))

    story.append(Paragraph("4. Acne lesion detection", styles["AcneH2"]))
    if _has_data(detection):
        story.append(Paragraph(_safe(detection.get("summary"), "Detection summary not available."), styles["AcneBody"]))
        story.append(Paragraph(f"Method: {_safe(detection.get('method'))} &nbsp;|&nbsp; Total lesions: {_safe(detection.get('total_detections'), '0')}", styles["AcneSmall"]))
        det_rows = [["Class", "Count"]]
        explanations = detection.get("class_explanations") or {}
        for label, count in (detection.get("lesion_counts") or {}).items():
            det_rows.append([Paragraph(f"{label}<br/><font size=7 color='#55627A'>{_safe(explanations.get(label), '')}</font>", styles["AcneBody"]), str(count)])
        if len(det_rows) > 1:
            story.append(_table(det_rows, [138 * mm, 40 * mm]))
        region_counts = detection.get("region_counts") or {}
        if region_counts:
            rr = [["Region", "Lesions"]]
            for r, c in region_counts.items():
                rr.append([str(r).replace("_", " ").title(), str(c)])
            story.append(Spacer(1, 2))
            story.append(_table(rr, [138 * mm, 40 * mm]))
    else:
        story.append(Paragraph("Not available for this scan.", styles["AcneBody"]))

    story.append(Paragraph("5. Enhancement summary", styles["AcneH2"]))
    if _has_data(enhancement):
        enh_rows = [["Field", "Value"]]
        enh_rows.append(["Method", _safe(enhancement.get("mode_label") or enhancement.get("method"))])
        enh_rows.append(["Strength", f"{enhancement.get('strength', 'N/A')}%"])
        enh_rows.append(["Face detected", "Yes" if enhancement.get("face_detected") else _safe(enhancement.get("face_detected"))])
        story.append(_table(enh_rows, [52 * mm, 126 * mm]))
        notes = enhancement.get("notes") or []
        if notes:
            story.append(Paragraph("<b>Notes / limitations:</b>", styles["AcneSmall"]))
            for note in notes[:6]:
                story.append(Paragraph(f"&bull; {str(note)}", styles["AcneSmall"]))
        if enhancement.get("disclaimer"):
            story.append(Paragraph(str(enhancement.get("disclaimer")), styles["AcneSmall"]))
        orig_img = _image_from_data_url(enhancement.get("original_image"), 82 * mm, 70 * mm)
        enh_img = _image_from_data_url(enhancement.get("enhanced_image") or enhancement.get("image"), 82 * mm, 70 * mm)
        if orig_img or enh_img:
            img_rows = [[Paragraph("<b>Original</b>", styles["AcneSmall"]), Paragraph("<b>Enhanced</b>", styles["AcneSmall"])]]
            img_rows.append([orig_img or Paragraph("Not available for this scan", styles["AcneSmall"]), enh_img or Paragraph("Not available for this scan", styles["AcneSmall"])])
            img_table = Table(img_rows, colWidths=[86 * mm, 86 * mm], hAlign="LEFT")
            img_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.4, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("PADDING", (0, 0), (-1, -1), 4), ("BACKGROUND", (0, 0), (-1, 0), GREY)]))
            story.append(Spacer(1, 3))
            story.append(img_table)
    else:
        story.append(Paragraph("Not available for this scan.", styles["AcneBody"]))

    def list_section(number: int, title: str, values: list[str]) -> None:
        story.append(Paragraph(f"{number}. {title}", styles["AcneH2"]))
        if not values:
            story.append(Paragraph("Not available for this scan.", styles["AcneBody"]))
            return
        for value in values[:10]:
            story.append(Paragraph(f"&bull; {value}", styles["AcneBody"]))

    products = payload.get("products") or []
    list_section(7, "Skincare product recommendations", [f"{_safe(i.get('brand'),'')} {_safe(i.get('name'),'')}".strip() + (f": {_safe(i.get('reason'),'')}" if i.get('reason') else "") for i in products if isinstance(i, dict)])
    fruits = payload.get("fruits") or []
    list_section(8, "Fruit recommendations", [_safe(i.get("name")) for i in fruits if isinstance(i, dict)])
    vegetables = payload.get("vegetables") or []
    list_section(9, "Vegetable recommendations", [_safe(i.get("name")) for i in vegetables if isinstance(i, dict)])

    story.append(Paragraph("10. Personalized diet plan", styles["AcneH2"]))
    diet = payload.get("diet") or {}
    if _has_data(diet):
        for meal in ("breakfast", "lunch", "snacks", "dinner"):
            values = diet.get(meal) or []
            if values:
                text = ", ".join(str(v.get("name", v)) if isinstance(v, dict) else str(v) for v in values[:8])
                story.append(Paragraph(f"<b>{meal.title()}:</b> {text}", styles["AcneBody"]))
        if not any(diet.get(m) for m in ("breakfast", "lunch", "snacks", "dinner")):
            story.append(Paragraph("Not available for this scan.", styles["AcneBody"]))
    else:
        story.append(Paragraph("Not available for this scan.", styles["AcneBody"]))

    story.append(Paragraph("11. Beauty tips", styles["AcneH2"]))
    tips = payload.get("tips") or {}
    if _has_data(tips):
        for phase in ("morning", "night"):
            for item in tips.get(phase, [])[:5]:
                if isinstance(item, dict):
                    title = _safe(item.get("title"), "Tip")
                    detail = _safe(item.get("detail"), "")
                    story.append(Paragraph(f"<b>{phase.title()} - {title}:</b> {detail}", styles["AcneBody"]))
                else:
                    story.append(Paragraph(f"<b>{phase.title()}:</b> {str(item)}", styles["AcneBody"]))
        if not tips.get("morning") and not tips.get("night"):
            story.append(Paragraph("Not available for this scan.", styles["AcneBody"]))
    else:
        story.append(Paragraph("Not available for this scan.", styles["AcneBody"]))

    story.append(Spacer(1, 6))
    story.append(Paragraph("Safety disclaimer", styles["AcneH2"]))
    story.append(
        Paragraph(
            "This report contains educational image-based estimates and general wellness suggestions. "
            "It is not a medical diagnosis, and no product, food, or enhancement result is claimed to cure acne. "
            "For persistent, painful, infected, or worsening symptoms, consult a qualified dermatologist.",
            styles["AcneSmall"],
        )
    )
    document.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buffer.getvalue()
