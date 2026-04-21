# -*- coding: utf-8 -*-
"""
generar_pdf.py
Usage: python generar_pdf.py input.json output.pdf

Generates a 5-page PDF report from Planify dashboard JSON data.
Requires: reportlab

NOTE: All text intentionally avoids accented characters and special chars
to prevent encoding issues in subprocess execution.
"""

import sys
import json

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Spacer, Table, TableStyle, PageBreak
)
from reportlab.platypus.flowables import Flowable
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.charts.barcharts import VerticalBarChart, HorizontalBarChart
from reportlab.graphics.charts.piecharts import Pie

# ---------------------------------------------------------------------------
# Colour constants
# ---------------------------------------------------------------------------
ORANGE      = HexColor("#F97316")
ORANGE_L    = HexColor("#FEF3E7")
ORANGE_BD   = HexColor("#FED7AA")
ORANGE_D    = HexColor("#C2410C")
TEAL        = HexColor("#0D9488")
TEAL_L      = HexColor("#CCFBF1")
SLATE_DARK  = HexColor("#1E293B")
SLATE_MID   = HexColor("#334155")
SLATE_LIGHT = HexColor("#F1F5F9")
SLATE_TEXT  = HexColor("#475569")
MUTED       = HexColor("#94A3B8")
WHITE       = colors.white
GREEN       = HexColor("#16A34A")
GREEN_L     = HexColor("#DCFCE7")
YELLOW      = HexColor("#F59E0B")
YELLOW_L    = HexColor("#FEF9C3")
YELLOW_T    = HexColor("#A16207")
YELLOW_DARK = HexColor("#FFFBEB")
GRAY_LINE   = HexColor("#E2E8F0")
RED         = HexColor("#DC2626")
RED_L       = HexColor("#FEE2E2")

PAGE_W, PAGE_H = A4   # 595.27 x 841.89 pt
CONTENT_W = PAGE_W - 72  # margins 36 each side

PAGE_SUBTITLES = [
    "Resumen Ejecutivo",
    "Distribuciones y Graficos",
    "Alertas",
    "Trabajos Cerrados",
    "Lectura para Reunion",
]

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------
def safe(val, default=""):
    if val is None:
        return default
    return str(val)

def trunc_w(text, font_name, font_size, max_width):
    s = str(text or "")
    while len(s) > 3 and stringWidth(s, font_name, font_size) > max_width:
        s = s[:-4] + "..."
    return s

def _safe_pct(val):
    """Safely convert a pct value (int, float, or '72%' string) to float."""
    try:
        return float(str(val or 0).replace("%", "").strip())
    except Exception:
        return 0

def _trunc_fit(text, font, size, max_w):
    """Truncate text with '...' to fit max_w points."""
    s = str(text or "")
    if stringWidth(s, font, size) <= max_w:
        return s
    while len(s) > 3:
        s = s[:-1]
        if stringWidth(s + "...", font, size) <= max_w:
            return s + "..."
    return s[:3]


# ---------------------------------------------------------------------------
# Page header/footer callback
# ---------------------------------------------------------------------------
def draw_page_frame(canvas, doc):
    canvas.saveState()

    # --- HEADER ---
    canvas.setFillColor(SLATE_DARK)
    canvas.rect(36, PAGE_H - 38, CONTENT_W, 38, fill=1, stroke=0)

    # Orange left bar
    canvas.setFillColor(ORANGE)
    canvas.rect(36, PAGE_H - 38, 5, 38, fill=1, stroke=0)

    # PLANIFY label
    canvas.setFillColor(ORANGE)
    canvas.setFont("Helvetica-Bold", 15)
    canvas.drawString(48, PAGE_H - 20, "PLANIFY")

    # Subtitle
    idx = min(doc.page - 1, len(PAGE_SUBTITLES) - 1)
    subtitle = PAGE_SUBTITLES[idx]
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(48, PAGE_H - 32, subtitle)

    # Date range right-aligned
    date_range = getattr(doc, '_planify_daterange', "")
    if date_range:
        canvas.setFillColor(WHITE)
        canvas.setFont("Helvetica", 8)
        sw = stringWidth(date_range, "Helvetica", 8)
        canvas.drawString(36 + CONTENT_W - sw - 4, PAGE_H - 20, date_range)

    # Page number
    page_str = "Pagina %d" % doc.page
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    sw2 = stringWidth(page_str, "Helvetica", 7)
    canvas.drawString(36 + CONTENT_W - sw2 - 4, PAGE_H - 32, page_str)

    # --- FOOTER ---
    canvas.setFillColor(SLATE_LIGHT)
    canvas.rect(36, 12, CONTENT_W, 18, fill=1, stroke=0)
    canvas.setStrokeColor(GRAY_LINE)
    canvas.setLineWidth(0.5)
    canvas.line(36, 30, 36 + CONTENT_W, 30)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 6.5)
    generado = getattr(doc, '_planify_generado', "")
    footer_l = "PLANIFY  Mantenimiento Predictivo  Generado: %s  Uso interno" % generado
    canvas.drawString(40, 16, footer_l)
    canvas.setFont("Helvetica-Bold", 6.5)
    canvas.setFillColor(SLATE_TEXT)
    canvas.drawRightString(36 + CONTENT_W - 4, 16, "Applus+")

    canvas.restoreState()


# ---------------------------------------------------------------------------
# Custom Flowables
# ---------------------------------------------------------------------------
class PeriodBanner(Flowable):
    """Orange period info banner."""
    def __init__(self, text, width=None):
        super().__init__()
        self.width = width or CONTENT_W
        self.height = 16
        self.text = text

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(ORANGE_L)
        c.rect(0, 0, self.width, self.height, fill=1, stroke=0)
        c.setFillColor(ORANGE)
        c.rect(0, 0, 3, self.height, fill=1, stroke=0)
        c.setStrokeColor(ORANGE)
        c.setLineWidth(0.5)
        c.line(0, 0, self.width, 0)
        c.line(0, self.height, self.width, self.height)
        c.setFillColor(ORANGE_D)
        c.setFont("Helvetica", 8)
        c.drawString(8, 4, self.text)
        c.restoreState()


class SectionLabel(Flowable):
    """Slate section header with orange left bar."""
    def __init__(self, text, width=None):
        super().__init__()
        self.width = width or CONTENT_W
        self.height = 16
        self.text = text

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(SLATE_LIGHT)
        c.rect(0, 0, self.width, self.height, fill=1, stroke=0)
        c.setFillColor(ORANGE)
        c.rect(0, 0, 2, self.height, fill=1, stroke=0)
        c.setFillColor(SLATE_MID)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawString(8, 4, self.text.upper())
        c.restoreState()


class AlertBanner(Flowable):
    """Yellow alert state banner."""
    def __init__(self, text, width=None):
        super().__init__()
        self.width = width or CONTENT_W
        self.height = 22
        self.text = text

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(YELLOW_DARK)
        c.rect(0, 0, self.width, self.height, fill=1, stroke=0)
        c.setFillColor(YELLOW)
        c.rect(0, 0, 4, self.height, fill=1, stroke=0)
        c.setFillColor(YELLOW_T)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(10, 6, self.text)
        c.restoreState()


class ActionItem(Flowable):
    """Action item with numbered circle and text."""
    def __init__(self, number, title, body, accent=None, width=None, height=70):
        super().__init__()
        self.width = width or (CONTENT_W - 4) / 2
        self.height = height
        self.number = str(number)
        self.title = title
        self.body = body
        self.accent = accent or ORANGE

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(SLATE_LIGHT)
        c.roundRect(0, 0, self.width, self.height, 4, fill=1, stroke=0)

        # Circle
        r = 10
        cx = 20
        cy = self.height - 20
        c.setFillColor(self.accent)
        c.circle(cx, cy, r, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        sw = stringWidth(self.number, "Helvetica-Bold", 9)
        c.drawString(cx - sw / 2, cy - 3.5, self.number)

        # Title
        c.setFillColor(SLATE_DARK)
        c.setFont("Helvetica-Bold", 8.5)
        title_lines = simpleSplit(self.title, "Helvetica-Bold", 8.5, self.width - 46)
        y = self.height - 15
        for line in title_lines[:2]:
            c.drawString(38, y, line)
            y -= 12

        # Body
        c.setFillColor(SLATE_TEXT)
        c.setFont("Helvetica", 7)
        body_lines = simpleSplit(str(self.body or ""), "Helvetica", 7, self.width - 12)
        y = self.height - 40
        for line in body_lines[:3]:
            if y > 6:
                c.drawString(10, y, line)
                y -= 10
        c.restoreState()


class ClosingBlock(Flowable):
    """Dark closing block at page bottom."""
    def __init__(self, kpis_summary, date_gen, width=None, height=62):
        super().__init__()
        self.width = width or CONTENT_W
        self.height = height
        self.kpis_summary = kpis_summary
        self.date_gen = date_gen

    def draw(self):
        c = self.canv
        c.saveState()
        # 1. Fondo oscuro PRIMERO
        c.setFillColor(HexColor("#1E293B"))
        c.roundRect(0, 0, self.width, self.height, 6, fill=1, stroke=0)
        # 2. Barra naranja izquierda
        c.setFillColor(HexColor("#F97316"))
        c.rect(0, 0, 5, self.height, fill=1, stroke=0)
        c.restoreState()
        # 3. Textos DESPUES de los rectangulos
        c.saveState()
        c.setFillColor(HexColor("#94A3B8"))
        c.setFont("Helvetica-Bold", 8)
        c.drawString(14, self.height - 12, "RESUMEN DE CIERRE DEL PERIODO")
        c.setFillColor(HexColor("#FFFFFF"))
        c.setFont("Helvetica-Bold", 10)
        c.drawString(14, self.height - 26, "Periodo con alta actividad operacional.")
        c.setFillColor(HexColor("#F97316"))
        c.setFont("Helvetica", 8.5)
        c.drawString(14, self.height - 40, self.kpis_summary)
        c.setFillColor(HexColor("#94A3B8"))
        c.setFont("Helvetica", 7.5)
        c.drawString(14, self.height - 54, "Mantenimiento Predictivo - Uso Interno")
        c.restoreState()


# ---------------------------------------------------------------------------
# Compound row Flowables — draw all items in a single canvas pass
# These avoid Table-of-Flowable rendering issues with ALIGN=CENTER
# ---------------------------------------------------------------------------

class KpiCardRow(Flowable):
    """Draws N KPI cards side-by-side in a single Flowable."""
    def __init__(self, cards_data, width=None, card_h=62):
        """
        cards_data: list of dicts with keys:
            title, value, subtitle, delta, accent_color
        """
        super().__init__()
        self.width  = width or CONTENT_W
        self.height = card_h
        self.card_h = card_h
        self.cards_data = cards_data

    def draw(self):
        c   = self.canv
        n   = len(self.cards_data)
        if n == 0:
            return
        gap    = 3
        card_w = (self.width - gap * (n - 1)) / n

        for i, card in enumerate(self.cards_data):
            x      = i * (card_w + gap)
            y      = 0
            w      = card_w
            h      = self.card_h
            accent = card.get("accent_color", ORANGE)
            title  = str(card.get("title", ""))
            value  = str(card.get("value", ""))
            sub    = str(card.get("subtitle", ""))
            delta  = str(card.get("delta", "") or "")

            # 1 — white card background + gray border
            c.saveState()
            c.setFillColor(WHITE)
            c.setStrokeColor(GRAY_LINE)
            c.setLineWidth(0.5)
            c.roundRect(x, y, w, h, 4, fill=1, stroke=1)
            c.restoreState()

            # 2 — left accent bar (3 pt wide, no radius)
            c.saveState()
            c.setFillColor(accent)
            c.rect(x, y, 3, h, fill=1, stroke=0)
            c.restoreState()

            # 3 — title (muted, 7 pt bold)
            c.saveState()
            c.setFillColor(MUTED)
            c.setFont("Helvetica-Bold", 7)
            t_text = trunc_w(title, "Helvetica-Bold", 7, w - 12)
            c.drawString(x + 8, y + h - 10, t_text)
            c.restoreState()

            # 4 — value (dark, 21 pt bold)
            c.saveState()
            c.setFillColor(SLATE_DARK)
            c.setFont("Helvetica-Bold", 21)
            c.drawString(x + 8, y + h - 30, value)
            c.restoreState()

            # 5 — subtitle (slate text, 7 pt)
            c.saveState()
            c.setFillColor(SLATE_TEXT)
            c.setFont("Helvetica", 7)
            s_text = trunc_w(sub, "Helvetica", 7, w - 12)
            c.drawString(x + 8, y + h - 42, s_text)
            c.restoreState()

            # 6 — delta badge
            if delta:
                y_d = y + h - 55
                try:
                    diff = float(str(delta).replace("+", "").replace(" ", "").split("vs")[0])
                except Exception:
                    diff = 1 if delta.startswith("+") else 0
                if diff > 0:
                    bg_col = GREEN_L;     txt_col = GREEN
                elif diff == 0:
                    bg_col = SLATE_LIGHT; txt_col = SLATE_TEXT
                else:
                    bg_col = RED_L;       txt_col = RED
                bw = min(stringWidth(delta, "Helvetica-Bold", 8) + 12, w - 16)
                bh = 11
                # badge background
                c.saveState()
                c.setFillColor(bg_col)
                c.roundRect(x + 8, y_d, bw, bh, 3, fill=1, stroke=0)
                c.restoreState()
                # badge text
                c.saveState()
                c.setFillColor(txt_col)
                c.setFont("Helvetica-Bold", 8)
                c.drawCentredString(x + 8 + bw / 2, y_d + 2, delta)
                c.restoreState()


class MsgBoxRow(Flowable):
    """Draws N message boxes side-by-side in a single Flowable."""
    def __init__(self, boxes_data, width=None, box_h=52):
        """
        boxes_data: list of dicts with keys:
            tag, title, body, bg_color, accent
        """
        super().__init__()
        self.width     = width or CONTENT_W
        self.height    = box_h
        self.box_h     = box_h
        self.boxes_data = boxes_data

    def draw(self):
        c = self.canv
        n = len(self.boxes_data)
        if n == 0:
            return
        gap   = 3
        box_w = (self.width - gap * (n - 1)) / n

        for i, box in enumerate(self.boxes_data):
            x       = i * (box_w + gap)
            y       = 0
            w       = box_w
            h       = self.box_h
            bg      = box.get("bg_color", ORANGE_L)
            accent  = box.get("accent", ORANGE)
            tag     = str(box.get("tag", ""))
            title   = str(box.get("title", ""))
            body    = str(box.get("body", "Sin informacion") or "Sin informacion")
            inner_w = w - 18

            # 1 — colored background + gray border
            c.saveState()
            c.setFillColor(bg)
            c.setStrokeColor(GRAY_LINE)
            c.setLineWidth(0.5)
            c.roundRect(x, y, w, h, 4, fill=1, stroke=1)
            c.restoreState()

            # 2 — left accent bar
            c.saveState()
            c.setFillColor(accent)
            c.rect(x, y, 3, h, fill=1, stroke=0)
            c.restoreState()

            # 3 — tag label
            c.saveState()
            c.setFillColor(accent)
            c.setFont("Helvetica-Bold", 6.5)
            c.drawString(x + 8, y + h - 12, tag)
            c.restoreState()

            # 4 — title (up to 2 lines, 8.5 pt bold)
            c.saveState()
            c.setFillColor(SLATE_DARK)
            c.setFont("Helvetica-Bold", 8.5)
            t_lines = simpleSplit(title, "Helvetica-Bold", 8.5, inner_w)
            ty = y + h - 24
            for line in t_lines[:2]:
                c.drawString(x + 8, ty, line)
                ty -= 12
            c.restoreState()

            # 5 — body (up to 3 lines, 7 pt)
            c.saveState()
            c.setFillColor(SLATE_TEXT)
            c.setFont("Helvetica", 7)
            b_lines = simpleSplit(body, "Helvetica", 7, inner_w)
            by = y + h - 42
            for line in b_lines[:3]:
                if by > y + 4:
                    c.drawString(x + 8, by, line)
                    by -= 10
            c.restoreState()


class ChipRow(Flowable):
    """Draws N chips side-by-side in a single Flowable."""
    def __init__(self, chips_data, width=None, chip_h=22):
        """
        chips_data: list of dicts with keys: text, bg_color, text_color
        """
        super().__init__()
        self.width      = width or CONTENT_W
        self.height     = chip_h
        self.chip_h     = chip_h
        self.chips_data = chips_data

    def draw(self):
        c = self.canv
        n = len(self.chips_data)
        if n == 0:
            return
        gap    = 3
        chip_w = (self.width - gap * (n - 1)) / n

        for i, chip in enumerate(self.chips_data):
            x    = i * (chip_w + gap)
            y    = 0
            w    = chip_w
            h    = self.chip_h
            bg   = chip.get("bg_color", ORANGE)
            fg   = chip.get("text_color", WHITE)
            text = str(chip.get("text", ""))

            c.saveState()
            c.setFillColor(bg)
            c.roundRect(x, y, w, h, 4, fill=1, stroke=0)
            c.setFillColor(fg)
            c.setFont("Helvetica-Bold", 8)
            sw = stringWidth(text, "Helvetica-Bold", 8)
            c.drawString(x + (w - sw) / 2, y + (h - 8) / 2 + 1, text)
            c.restoreState()


# ---------------------------------------------------------------------------
# Helper: build KPI card row  → returns KpiCardRow Flowable
# ---------------------------------------------------------------------------
def _kpi_card_row(kpis, defs, card_w, card_h=62):
    cards_data = []
    for kpi_key, title, sub_key, delta_key, accent in defs:
        kpi      = kpis.get(kpi_key, {})
        actual   = kpi.get("actual", 0)
        anterior = kpi.get("anterior", 0)
        subtitle = str(kpi.get(sub_key, "") if sub_key else "")
        if not subtitle:
            subtitle = "anterior: %s" % str(anterior)
        delta_val = str(kpi.get(delta_key, "") if delta_key else "")
        if not delta_val:
            try:
                diff = int(float(actual or 0)) - int(float(anterior or 0))
                delta_val = "+%d" % diff if diff >= 0 else str(diff)
            except Exception:
                delta_val = ""
        cards_data.append({
            "title":        title,
            "value":        actual,
            "subtitle":     subtitle,
            "delta":        delta_val,
            "accent_color": accent,
        })
    return KpiCardRow(cards_data, width=CONTENT_W, card_h=card_h)


# ---------------------------------------------------------------------------
# Helper: build message box row  → returns MsgBoxRow Flowable
# ---------------------------------------------------------------------------
_TAG_LABELS = {
    "lecturaEjecutiva":   "LECTURA EJECUTIVA",
    "riesgoTecnico":      "RIESGO TECNICO",
    "movimientoSugerido": "MOVIMIENTO SUGERIDO",
    "siguienteAccion":    "SIGUIENTE ACCION",
}

def _msg_box_row(mensajes, msg_defs, msg_w, msg_h=52):
    boxes_data = []
    for mk, default_title, bg, accent in msg_defs:
        msg    = mensajes.get(mk, {})
        titulo = str(msg.get("titulo", default_title) or default_title)
        body   = str(msg.get("body",   "Sin informacion") or "Sin informacion")
        tag    = _TAG_LABELS.get(mk, mk.upper())
        boxes_data.append({
            "tag":      tag,
            "title":    titulo,
            "body":     body,
            "bg_color": bg,
            "accent":   accent,
        })
    return MsgBoxRow(boxes_data, width=CONTENT_W, box_h=msg_h)


# ---------------------------------------------------------------------------
# PAGE 1 — Resumen Ejecutivo
# ---------------------------------------------------------------------------
def build_page1(data):
    el = []
    rango       = data.get("rango", {})
    periodo_ant = data.get("periodoAnterior", {})
    kpis        = data.get("kpis", {})
    mensajes    = data.get("mensajes", {})

    desde      = rango.get("desde", "?")
    hasta      = rango.get("hasta", "?")
    dias       = rango.get("diasAnalizados", "?")
    prev_desde = periodo_ant.get("desde", "?")
    prev_hasta = periodo_ant.get("hasta", "?")

    el.append(Spacer(CONTENT_W, 4))
    el.append(PeriodBanner(
        "Periodo: %s al %s  |  %s dias  |  Comparado vs: %s - %s"
        % (desde, hasta, dias, prev_desde, prev_hasta)
    ))
    el.append(Spacer(CONTENT_W, 6))
    el.append(SectionLabel("PULSO OPERATIVO"))
    el.append(Spacer(CONTENT_W, 4))

    kpi_defs1 = [
        ("trabajosCerrados",    "TRABAJOS CERRADOS",    "porDia",     "extra",  ORANGE),
        ("mediciones",          "MEDICIONES",           "porDia",     None,     ORANGE),
        ("hhRegistradas",       "HH REGISTRADAS",       "porTrabajo", None,     ORANGE),
        ("otCerradas",          "OT CERRADAS",          "avisos",     None,     ORANGE),
    ]
    el.append(_kpi_card_row(kpis, kpi_defs1, (CONTENT_W - 9) / 4))
    el.append(Spacer(CONTENT_W, 4))
    el.append(SectionLabel("CONDICION Y PERSONAL"))
    el.append(Spacer(CONTENT_W, 4))

    kpi_defs2 = [
        ("equiposIntervenidos",  "EQUIPOS INTERVENIDOS",  None, None, TEAL),
        ("personalParticipante", "PERSONAL PARTICIPANTE", None, None, ORANGE),
        ("lecturasCriticas",     "LECTURAS CRITICAS",     None, None, RED),
        ("seguimientoActivo",    "SEGUIMIENTO ACTIVO",    None, None, YELLOW),
    ]
    el.append(_kpi_card_row(kpis, kpi_defs2, (CONTENT_W - 9) / 4))
    el.append(Spacer(CONTENT_W, 8))
    el.append(SectionLabel("LECTURA EJECUTIVA PARA REUNION"))
    el.append(Spacer(CONTENT_W, 4))

    msg_defs = [
        ("lecturaEjecutiva",   "Lectura Ejecutiva",   ORANGE_L,    ORANGE),
        ("riesgoTecnico",      "Riesgo Tecnico",      YELLOW_DARK, YELLOW),
        ("movimientoSugerido", "Movimiento Sugerido", ORANGE_L,    HexColor("#EA6005")),
        ("siguienteAccion",    "Siguiente Accion",    TEAL_L,      TEAL),
    ]
    el.append(_msg_box_row(mensajes, msg_defs, (CONTENT_W - 9) / 4, msg_h=52))
    el.append(Spacer(CONTENT_W, 8))
    el.append(SectionLabel("COMPARATIVA DE PERIODO"))
    el.append(Spacer(CONTENT_W, 4))

    # Comparison table
    kpi_map = [
        ("Trabajos Cerrados",     "trabajosCerrados"),
        ("Mediciones",            "mediciones"),
        ("HH Registradas",        "hhRegistradas"),
        ("OT Cerradas",           "otCerradas"),
        ("Equipos Intervenidos",  "equiposIntervenidos"),
        ("Personal Participante", "personalParticipante"),
        ("Lecturas Criticas",     "lecturasCriticas"),
        ("Seguimiento Activo",    "seguimientoActivo"),
    ]
    comp_data = [["Indicador", "Periodo Actual", "Periodo Anterior", "Variacion", "Tend."]]
    for label, kkey in kpi_map:
        kp       = kpis.get(kkey, {})
        actual   = kp.get("actual", 0)   or 0
        anterior = kp.get("anterior", 0) or 0
        try:
            diff      = int(float(actual)) - int(float(anterior))
            variacion = "+%d" % diff if diff >= 0 else str(diff)
            tend      = "^" if diff >= 0 else "v"
        except Exception:
            variacion = ""
            tend      = ""
        comp_data.append([label, str(actual), str(anterior), variacion, tend])

    cw = [140, 80, 80, 70, 50]
    t  = Table(comp_data, colWidths=cw, repeatRows=1,
               rowHeights=[13] * len(comp_data))

    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), SLATE_DARK),
        ("TEXTCOLOR",  (0, 0), (-1, 0), WHITE),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, 0), 7.5),
        ("FONTNAME",   (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",   (0, 1), (-1, -1), 7),
        ("TEXTCOLOR",  (0, 1), (-1, -1), SLATE_DARK),
        ("ALIGN",      (0, 0), (-1, -1), "CENTER"),
        ("ALIGN",      (0, 1), (0,  -1), "LEFT"),
        ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW",  (0, 0), (-1, -1), 0.3, GRAY_LINE),
        # Actual column orange bold
        ("FONTNAME",   (1, 1), (1, -1), "Helvetica-Bold"),
        ("TEXTCOLOR",  (1, 1), (1, -1), ORANGE),
    ]
    # Alternating rows
    for i in range(1, len(comp_data)):
        bg = SLATE_LIGHT if i % 2 == 1 else WHITE
        style_cmds.append(("BACKGROUND", (0, i), (-1, i), bg))
    # Variacion + Tend. coloring
    for i, (_, kkey) in enumerate(kpi_map, start=1):
        kp       = kpis.get(kkey, {})
        actual   = kp.get("actual", 0)   or 0
        anterior = kp.get("anterior", 0) or 0
        try:
            diff = int(float(actual)) - int(float(anterior))
            if diff > 0:
                style_cmds += [
                    ("TEXTCOLOR", (3, i), (3, i), GREEN),
                    ("FONTNAME",  (3, i), (3, i), "Helvetica-Bold"),
                    ("TEXTCOLOR", (4, i), (4, i), GREEN),
                    ("FONTNAME",  (4, i), (4, i), "Helvetica-Bold"),
                ]
            elif diff == 0:
                style_cmds += [
                    ("TEXTCOLOR", (3, i), (3, i), MUTED),
                    ("TEXTCOLOR", (4, i), (4, i), MUTED),
                ]
            else:
                style_cmds += [
                    ("TEXTCOLOR", (3, i), (3, i), RED),
                    ("FONTNAME",  (3, i), (3, i), "Helvetica-Bold"),
                    ("TEXTCOLOR", (4, i), (4, i), RED),
                    ("FONTNAME",  (4, i), (4, i), "Helvetica-Bold"),
                ]
        except Exception:
            pass

    t.setStyle(TableStyle(style_cmds))
    el.append(t)
    el.append(PageBreak())
    return el


# ---------------------------------------------------------------------------
# PAGE 2 — Distribuciones y Graficos
# ---------------------------------------------------------------------------

def _make_pie_drawing(items, colors_list, d_w, d_h, title_text, total_label=""):
    """
    Build a Drawing with a Pie chart (no floating labels) + manual legend.
    items: list of dicts with 'nombre'/'tipo'/'estado', 'pct', 'total'
    colors_list: list of HexColor matching items order
    """
    from reportlab.graphics.shapes import Rect, String as GString
    d = Drawing(d_w, d_h)

    t = GString(6, d_h - 12, title_text)
    t.fontName  = "Helvetica-Bold"
    t.fontSize  = 6.5
    t.fillColor = SLATE_MID
    d.add(t)

    if not items:
        no = GString(d_w / 2, d_h / 2, "Sin datos")
        no.fontName  = "Helvetica"
        no.fontSize  = 7
        no.fillColor = MUTED
        d.add(no)
        return d

    # Filter out zero-value slices
    valid = [(it, col) for it, col in zip(items, colors_list) if _safe_pct(it.get("pct")) > 0]
    if not valid:
        valid = [(items[0], colors_list[0])]

    pie_size = min(d_w * 0.40, d_h - 28)
    pie_x    = 6
    pie_y    = (d_h - pie_size) / 2 - 4

    pc = Pie()
    pc.x      = pie_x
    pc.y      = pie_y
    pc.width  = pie_size
    pc.height = pie_size
    pc.data   = [max(_safe_pct(it.get("pct")), 0.01) for it, _ in valid]
    pc.labels = []
    pc.sideLabels = 0
    for i, (_, col) in enumerate(valid):
        pc.slices[i].fillColor   = col
        pc.slices[i].popout      = 0
        pc.slices[i].strokeWidth = 0.5
        pc.slices[i].strokeColor = WHITE
    d.add(pc)

    # Manual legend to the right of the pie
    leg_x = pie_x + pie_size + 10
    leg_y = pie_y + pie_size - 8
    row_h = 18
    for i, (it, col) in enumerate(valid):
        ry  = leg_y - i * row_h
        sq  = Rect(leg_x, ry, 9, 9)
        sq.fillColor   = col
        sq.strokeWidth = 0
        d.add(sq)
        label = str(it.get("nombre") or it.get("tipo") or it.get("estado") or "")
        pct   = it.get("pct", 0)
        total = it.get("total", "")
        txt   = "%s  %s%%  (%s)" % (label[:14], pct, total) if total != "" else "%s  %s%%" % (label[:16], pct)
        s = GString(leg_x + 13, ry, txt)
        s.fontName  = "Helvetica"
        s.fontSize  = 6.5
        s.fillColor = SLATE_TEXT
        d.add(s)

    if total_label:
        tl = GString(pie_x, pie_y - 10, total_label)
        tl.fontName  = "Helvetica"
        tl.fontSize  = 6
        tl.fillColor = MUTED
        d.add(tl)

    return d


def _make_bar_drawing(actual_vals, prev_vals, cat_names, d_w, d_h, title_text):
    """Grouped vertical bar chart: orange=actual, gray=anterior with manual legend."""
    from reportlab.graphics.shapes import Rect, String as GString
    d = Drawing(d_w, d_h)

    t = GString(6, d_h - 12, title_text)
    t.fontName  = "Helvetica-Bold"
    t.fontSize  = 6.5
    t.fillColor = SLATE_MID
    d.add(t)

    bc = VerticalBarChart()
    bc.x      = 28
    bc.y      = 28
    bc.width  = d_w - 36
    bc.height = d_h - 52
    bc.data   = [
        [float(v) for v in actual_vals],
        [float(v) for v in prev_vals],
    ]
    bc.categoryAxis.categoryNames    = cat_names
    bc.bars[0].fillColor             = ORANGE
    bc.bars[1].fillColor             = HexColor("#CBD5E1")
    bc.valueAxis.valueMin            = 0
    bc.categoryAxis.labels.fontSize  = 6
    bc.categoryAxis.labels.fontName  = "Helvetica"
    bc.valueAxis.labels.fontSize     = 6
    bc.valueAxis.labels.fontName     = "Helvetica"
    bc.groupSpacing                  = 5
    d.add(bc)

    # Manual legend below chart
    leg_y = 10
    r1 = Rect(28, leg_y, 8, 8);  r1.fillColor = ORANGE;               r1.strokeWidth = 0
    d.add(r1)
    s1 = GString(40, leg_y, "Actual");    s1.fontName = "Helvetica"; s1.fontSize = 6; s1.fillColor = SLATE_TEXT
    d.add(s1)
    r2 = Rect(90, leg_y, 8, 8);  r2.fillColor = HexColor("#CBD5E1"); r2.strokeWidth = 0
    d.add(r2)
    s2 = GString(102, leg_y, "Anterior"); s2.fontName = "Helvetica"; s2.fontSize = 6; s2.fillColor = SLATE_TEXT
    d.add(s2)

    return d


def _make_hbar_drawing(unidades, d_w, d_h, title_text):
    """Horizontal bar chart sorted desc, first bar orange rest teal."""
    from reportlab.graphics.shapes import String as GString
    d = Drawing(d_w, d_h)

    t = GString(6, d_h - 12, title_text)
    t.fontName  = "Helvetica-Bold"
    t.fontSize  = 6.5
    t.fillColor = SLATE_MID
    d.add(t)

    if not unidades:
        return d

    sorted_u = sorted(unidades, key=lambda x: x.get("total", 0) or 0, reverse=True)
    names    = [str(u.get("nombre", ""))[:16] for u in sorted_u]
    values   = [float(u.get("total", 0) or 0) for u in sorted_u]

    n          = len(sorted_u)
    bar_area_h = max(n * 18, 40)

    hbc = HorizontalBarChart()
    hbc.x      = 62
    hbc.y      = max(d_h - 20 - bar_area_h - 16, 8)
    hbc.width  = d_w - 72
    hbc.height = min(bar_area_h, d_h - 36)
    hbc.data   = [values]
    hbc.categoryAxis.categoryNames   = names
    hbc.valueAxis.valueMin           = 0
    hbc.categoryAxis.labels.fontSize = 6
    hbc.categoryAxis.labels.fontName = "Helvetica"
    hbc.valueAxis.labels.fontSize    = 6
    hbc.valueAxis.labels.fontName    = "Helvetica"
    hbc.bars[0].fillColor            = TEAL
    try:
        hbc.bars[(0, 0)].fillColor   = ORANGE
    except Exception:
        pass
    d.add(hbc)
    return d


def build_page2(data):
    el = []
    dist    = data.get("distribucion", {})
    kpis    = data.get("kpis", {})
    lideres = data.get("lideres", [])

    el.append(Spacer(CONTENT_W, 4))

    half_w = (CONTENT_W - 6) / 2
    d_w    = half_w - 2
    ROW_H  = 140

    # -----------------------------------------------------------------------
    # Row 1: Bar chart  +  Pie especialidad
    # -----------------------------------------------------------------------
    actual_jobs     = kpis.get("trabajosCerrados",    {}).get("actual",   0) or 0
    actual_ots      = kpis.get("otCerradas",          {}).get("actual",   0) or 0
    actual_equip    = kpis.get("equiposIntervenidos", {}).get("actual",   0) or 0
    actual_personal = kpis.get("personalParticipante",{}).get("actual",   0) or 0
    actual_watch    = kpis.get("seguimientoActivo",   {}).get("actual",   0) or 0
    prev_jobs       = kpis.get("trabajosCerrados",    {}).get("anterior", 0) or 0
    prev_ots        = kpis.get("otCerradas",          {}).get("anterior", 0) or 0
    prev_equip      = kpis.get("equiposIntervenidos", {}).get("anterior", 0) or 0
    prev_personal   = kpis.get("personalParticipante",{}).get("anterior", 0) or 0
    prev_watch      = kpis.get("seguimientoActivo",   {}).get("anterior", 0) or 0

    d_bar = _make_bar_drawing(
        [actual_jobs, actual_ots, actual_equip, actual_personal, actual_watch],
        [prev_jobs,   prev_ots,   prev_equip,   prev_personal,   prev_watch],
        ["Trab.", "OT", "Equip.", "Personal", "Seguim."],
        d_w, ROW_H,
        "Comparativo Actual vs Anterior - KPIs principales"
    )

    especialidad = dist.get("especialidad", [])
    esp_colors   = [ORANGE, TEAL, GREEN, YELLOW]
    d_pie_esp    = _make_pie_drawing(
        especialidad, esp_colors[:len(especialidad)],
        d_w, ROW_H,
        "Distribucion por Especialidad - %d trabajos" % actual_jobs,
    )

    el.append(SectionLabel("COMPARATIVO KPI ACTUAL vs ANTERIOR  |  DISTRIBUCION POR ESPECIALIDAD"))
    el.append(Spacer(CONTENT_W, 4))
    row1_t = Table([[d_bar, d_pie_esp]], colWidths=[half_w, half_w])
    row1_t.setStyle(TableStyle([
        ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    el.append(row1_t)
    el.append(Spacer(CONTENT_W, 6))

    # -----------------------------------------------------------------------
    # Row 2: Horizontal bar chart units  +  Pie condicion
    # -----------------------------------------------------------------------
    unidades  = dist.get("unidad", [])
    total_med = kpis.get("mediciones", {}).get("actual", 0) or 0
    d_hbar    = _make_hbar_drawing(unidades, d_w, ROW_H, "Carga por Unidad")

    condicion = dist.get('condicion', [])

    COLOR_MAP_CONDICION = {
        'controlado':  HexColor('#16A34A'),
        'seguimiento': HexColor('#F59E0B'),
        'critico':     HexColor('#DC2626'),
    }

    # Filtrar estados con total > 0
    condicion_valida = [item for item in condicion if int(item.get('total', 0)) > 0]

    # Si no hay datos validos usar todos
    if not condicion_valida:
        condicion_valida = condicion

    # Construir lista de colores en el mismo orden que condicion_valida
    colores_condicion = []
    for item in condicion_valida:
        estado_key = str(item.get('estado', '')).lower().strip()
        color = COLOR_MAP_CONDICION.get(estado_key, HexColor('#94A3B8'))
        colores_condicion.append(color)

    # Llamar _make_pie_drawing con condicion_valida y colores_condicion
    pie_condicion = _make_pie_drawing(
        condicion_valida,
        colores_condicion,
        d_w,
        ROW_H,
        'Estado de Condicion - %d mediciones' % sum(int(i.get('total', 0)) for i in condicion),
    )

    el.append(SectionLabel("DISTRIBUCION POR UNIDAD  |  ESTADO DE CONDICION"))
    el.append(Spacer(CONTENT_W, 4))
    row2_t = Table([[d_hbar, pie_condicion]], colWidths=[half_w, half_w])
    row2_t.setStyle(TableStyle([
        ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    el.append(row2_t)
    el.append(Spacer(CONTENT_W, 6))

    # -----------------------------------------------------------------------
    # Row 3: Pie mix mediciones  +  Leaders table
    # -----------------------------------------------------------------------
    mix_items  = dist.get("mixMediciones", [])
    mix_colors = [ORANGE, TEAL, GREEN, YELLOW]
    d_pie_mix  = _make_pie_drawing(
        mix_items, mix_colors[:len(mix_items)],
        d_w, ROW_H,
        "Mix de Mediciones",
    )

    ldr_header = ["#", "Lider", "Trab.", "Unid."]
    ldr_rows   = []
    for idx, ldr in enumerate(lideres):
        ldr_rows.append([
            str(idx + 1) + ".",
            str(ldr.get("nombre", "")),
            str(ldr.get("trabajos", 0)),
            str(ldr.get("unidades", 0)),
        ])
    if not ldr_rows:
        ldr_rows = [["", "Sin datos", "", ""]]
    ldr_all  = [ldr_header] + ldr_rows
    ldr_cw   = [22, half_w - 115, 42, 42]
    ldr_t    = Table(ldr_all, colWidths=ldr_cw, repeatRows=1)
    ldr_style = [
        ("BACKGROUND",    (0, 0), (-1, 0),  SLATE_DARK),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  WHITE),
        ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 7),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("TEXTCOLOR",     (0, 1), (-1, -1), SLATE_DARK),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("ALIGN",         (1, 1), (1,  -1), "LEFT"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW",     (0, 0), (-1, -1), 0.3, GRAY_LINE),
    ]
    if ldr_rows:
        ldr_style.append(("BACKGROUND", (0, 1), (-1, 1), ORANGE_L))
        ldr_style.append(("TEXTCOLOR",  (0, 1), (0,  1), ORANGE_D))
        ldr_style.append(("FONTNAME",   (0, 1), (0,  1), "Helvetica-Bold"))
    for i in range(2, len(ldr_rows) + 1):
        bg = SLATE_LIGHT if i % 2 == 0 else WHITE
        ldr_style.append(("BACKGROUND", (0, i), (-1, i), bg))
    ldr_t.setStyle(TableStyle(ldr_style))

    el.append(SectionLabel("MIX DE MEDICIONES  |  LIDERES CON MAYOR ACTIVIDAD"))
    el.append(Spacer(CONTENT_W, 4))
    row3_t = Table([[d_pie_mix, ldr_t]], colWidths=[half_w, half_w])
    row3_t.setStyle(TableStyle([
        ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    el.append(row3_t)
    el.append(PageBreak())
    return el


# ---------------------------------------------------------------------------
# Custom bar chart for tendencia (direct canvas drawing)
# ---------------------------------------------------------------------------
class TendenciaBarras(Flowable):
    """Mini bar chart for weekly alert trends."""
    def __init__(self, alertas, width=None, height=90):
        super().__init__()
        self.width   = width or CONTENT_W
        self.height  = height
        self.alertas = alertas

    def draw(self):
        c = self.canv
        c.saveState()

        semanas = {}
        for alerta in self.alertas:
            fecha_str = str(alerta.get("fecha", ""))
            if len(fecha_str) >= 5:
                semana = fecha_str[:5]
                semanas[semana] = semanas.get(semana, 0) + 1

        if not semanas:
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 7)
            c.drawString(10, self.height / 2, "Sin datos de tendencia")
            c.restoreState()
            return

        semanas_sorted = sorted(semanas.items())
        max_v  = max(v for _, v in semanas_sorted) or 1
        n      = len(semanas_sorted)
        bar_w  = min(40, (self.width - 60) / max(n, 1))
        bh_max = 50
        y_base = 20

        for i, (semana, cnt) in enumerate(semanas_sorted):
            bx    = 20 + i * (bar_w + 6)
            bar_h = max(bh_max * cnt / max_v, 4)

            c.saveState()
            c.setFillColor(SLATE_LIGHT)
            c.roundRect(bx, y_base, bar_w, bh_max, 2, fill=1, stroke=0)
            c.restoreState()

            c.saveState()
            c.setFillColor(YELLOW)
            c.roundRect(bx, y_base, bar_w, bar_h, 2, fill=1, stroke=0)
            c.restoreState()

            c.saveState()
            c.setFillColor(YELLOW_T)
            c.setFont("Helvetica-Bold", 7.5)
            c.drawCentredString(bx + bar_w / 2, y_base + bar_h + 3, str(cnt))
            c.restoreState()

            c.saveState()
            c.setFillColor(SLATE_TEXT)
            c.setFont("Helvetica", 6)
            c.drawCentredString(bx + bar_w / 2, y_base - 10, semana)
            c.restoreState()

        c.restoreState()


# ---------------------------------------------------------------------------
# PAGE 3 — Alertas
# ---------------------------------------------------------------------------
def build_page3(data):
    el = []
    alertas   = data.get("alertas", [])
    n_alertas = len(alertas)

    el.append(Spacer(CONTENT_W, 4))
    el.append(AlertBanner(
        "ESTADO GENERAL: SEGUIMIENTO  --  %d lecturas en observacion  |  0 criticas" % n_alertas
    ))
    el.append(Spacer(CONTENT_W, 4))
    el.append(SectionLabel("ALERTAS EN SEGUIMIENTO"))
    el.append(Spacer(CONTENT_W, 4))

    alert_headers = ["Categoria", "Equipo", "Unidad", "Punto", "Valor", "Fecha"]
    alert_rows    = []
    for a in alertas[:30]:
        alert_rows.append([
            str(a.get("categoria", "")),
            str(a.get("equipo",    "")),
            str(a.get("unidad",    "")),
            str(a.get("punto",     ""))[:22],
            str(a.get("valor",     "")),
            str(a.get("fecha",     "")),
        ])
    if not alert_rows:
        alert_rows = [["", "Sin alertas activas", "", "", "", ""]]

    cw        = [50, 125, 30, 100, 68, 78]
    all_alert = [alert_headers] + alert_rows
    alert_t   = Table(all_alert, colWidths=cw, repeatRows=1,
                      rowHeights=[13] + [11] * len(alert_rows))
    alert_style = [
        ("BACKGROUND",    (0, 0), (-1, 0), SLATE_DARK),
        ("TEXTCOLOR",     (0, 0), (-1, 0), WHITE),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 7),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("TEXTCOLOR",     (0, 1), (-1, -1), SLATE_DARK),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW",     (0, 0), (-1, -1), 0.3, GRAY_LINE),
        # Valor column bold YELLOW_T
        ("FONTNAME",      (4, 1), (4, -1), "Helvetica-Bold"),
        ("TEXTCOLOR",     (4, 1), (4, -1), YELLOW_T),
    ]
    for i in range(1, len(alert_rows) + 1):
        bg = YELLOW_DARK if i % 2 == 1 else WHITE
        alert_style.append(("BACKGROUND", (0, i), (-1, i), bg))
    alert_t.setStyle(TableStyle(alert_style))
    el.append(alert_t)
    el.append(Spacer(CONTENT_W, 8))

    el.append(SectionLabel("TENDENCIA DE ALERTAS POR SEMANA"))
    el.append(Spacer(CONTENT_W, 4))
    el.append(TendenciaBarras(alertas, width=CONTENT_W, height=90))

    el.append(PageBreak())
    return el


# ---------------------------------------------------------------------------
# PAGE 4 — Trabajos Cerrados
# ---------------------------------------------------------------------------
def build_page4(data):
    el = []
    trabajos = data.get("trabajos", [])

    total_trabajos = len(trabajos)
    total_hh       = sum(float(t.get("hh", 0) or 0) for t in trabajos)
    total_ots      = len(set(t.get("ot", "") for t in trabajos if t.get("ot")))
    lideres_set    = set(t.get("lider", "") for t in trabajos if t.get("lider"))

    el.append(Spacer(CONTENT_W, 4))

    # Chips row — using ChipRow Flowable (draws all 4 in one pass)
    chips_data = [
        {"text": "%d TRABAJOS" % total_trabajos,    "bg_color": ORANGE,    "text_color": WHITE},
        {"text": "%.1f HH"     % total_hh,          "bg_color": TEAL,      "text_color": WHITE},
        {"text": "%d OT"       % total_ots,          "bg_color": SLATE_MID, "text_color": WHITE},
        {"text": "%d LIDERES"  % len(lideres_set),   "bg_color": ORANGE,    "text_color": WHITE},
    ]
    el.append(ChipRow(chips_data, width=CONTENT_W, chip_h=22))
    el.append(Spacer(CONTENT_W, 8))
    el.append(SectionLabel("DETALLE DE TRABAJOS CERRADOS"))
    el.append(Spacer(CONTENT_W, 4))

    job_headers = ["Fecha", "Unidad", "Equipo", "Esp.", "Lider", "OT", "HH"]
    job_rows    = []
    for t in trabajos:
        esp_raw = str(t.get("especialidad", "")).lower()
        if "vibr" in esp_raw:
            esp_badge = "VIB"
        elif "ter" in esp_raw:
            esp_badge = "TER"
        else:
            esp_badge = esp_raw[:3].upper()
        job_rows.append([
            str(t.get("fecha",   "")),
            str(t.get("unidad",  ""))[:10],
            _trunc_fit(t.get("equipo", ""), "Helvetica", 7, 126),
            esp_badge,
            _trunc_fit(t.get("lider",  ""), "Helvetica", 7, 84),
            _trunc_fit(t.get("ot",     ""), "Helvetica", 7, 91),
            "%.1f" % float(t.get("hh", 0) or 0),
        ])

    total_row_data = ["TOTAL", "", "", "", "", "", "%.1f" % total_hh]
    all_rows       = [job_headers] + job_rows + [total_row_data]
    cw             = [30, 42, 130, 28, 88, 95, 26]

    job_t      = Table(all_rows, colWidths=cw, repeatRows=1,
                       rowHeights=[12] * len(all_rows))
    style_cmds = [
        ("BACKGROUND",    (0, 0),  (-1, 0),  SLATE_DARK),
        ("TEXTCOLOR",     (0, 0),  (-1, 0),  WHITE),
        ("FONTNAME",      (0, 0),  (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0),  (-1, -1), 7),
        ("FONTNAME",      (0, 1),  (-1, -1), "Helvetica"),
        ("TEXTCOLOR",     (0, 1),  (-1, -1), SLATE_DARK),
        ("ALIGN",         (0, 0),  (-1, -1), "CENTER"),
        ("VALIGN",        (0, 0),  (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0),  (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0),  (-1, -1), 2),
        ("LINEBELOW",     (0, 0),  (-1, -1), 0.3, GRAY_LINE),
        # Total row
        ("BACKGROUND",    (0, -1), (-1, -1), SLATE_DARK),
        ("TEXTCOLOR",     (0, -1), (0,  -1), ORANGE),
        ("FONTNAME",      (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TEXTCOLOR",     (1, -1), (-2, -1), WHITE),
        ("TEXTCOLOR",     (-1,-1), (-1, -1), WHITE),
    ]
    # Alternating rows + specialty badge colors
    for i in range(1, len(job_rows) + 1):
        bg = SLATE_LIGHT if i % 2 == 1 else WHITE
        style_cmds.append(("BACKGROUND", (0, i), (-1, i), bg))
        esp = str(trabajos[i - 1].get("especialidad", "")).lower() if i - 1 < len(trabajos) else ""
        if "vibr" in esp:
            style_cmds += [
                ("BACKGROUND", (3, i), (3, i), ORANGE_L),
                ("TEXTCOLOR",  (3, i), (3, i), ORANGE),
                ("FONTNAME",   (3, i), (3, i), "Helvetica-Bold"),
            ]
        elif "ter" in esp:
            style_cmds += [
                ("BACKGROUND", (3, i), (3, i), TEAL_L),
                ("TEXTCOLOR",  (3, i), (3, i), TEAL),
                ("FONTNAME",   (3, i), (3, i), "Helvetica-Bold"),
            ]
    job_t.setStyle(TableStyle(style_cmds))
    el.append(job_t)
    el.append(PageBreak())
    return el


# ---------------------------------------------------------------------------
# PAGE 5 — Lectura para Reunion
# ---------------------------------------------------------------------------
def build_page5(data):
    el = []
    mensajes    = data.get("mensajes", {})
    acciones    = data.get("accionesSugeridas", [])
    top_equipos = data.get("topEquipos", [])
    kpis        = data.get("kpis", {})
    date_gen    = data.get("generado", "")

    el.append(Spacer(CONTENT_W, 4))
    el.append(SectionLabel("MENSAJES CLAVE PARA REUNION"))
    el.append(Spacer(CONTENT_W, 4))

    msg_defs = [
        ("lecturaEjecutiva",   "Lectura Ejecutiva",   ORANGE_L,    ORANGE),
        ("riesgoTecnico",      "Riesgo Tecnico",      YELLOW_DARK, YELLOW),
        ("movimientoSugerido", "Movimiento Sugerido", ORANGE_L,    HexColor("#EA6005")),
        ("siguienteAccion",    "Siguiente Accion",    TEAL_L,      TEAL),
    ]
    el.append(_msg_box_row(mensajes, msg_defs, (CONTENT_W - 9) / 4, msg_h=52))
    el.append(Spacer(CONTENT_W, 10))
    el.append(SectionLabel("ACCIONES SUGERIDAS"))
    el.append(Spacer(CONTENT_W, 4))

    action_items = list(acciones[:4])
    while len(action_items) < 4:
        action_items.append("")

    def _action_text(item):
        if isinstance(item, dict):
            return str(item.get("titulo", "")), str(item.get("body", ""))
        s = str(item or "")
        for sep in (". ", ", "):
            if sep in s:
                parts = s.split(sep, 1)
                return parts[0].strip(), parts[1].strip()
        return s, ""

    act_w       = (CONTENT_W - 4) / 2
    act_accents = [ORANGE, TEAL, HexColor("#EA6005"), SLATE_MID]
    act_rows_data = []
    for i, item in enumerate(action_items):
        ttl, bdy = _action_text(item)
        act_rows_data.append(ActionItem(i + 1, ttl, bdy,
                                        accent=act_accents[i],
                                        width=act_w, height=70))

    row1  = act_rows_data[:2]
    row2  = act_rows_data[2:]
    act_t = Table([row1, row2], colWidths=[act_w, act_w])
    act_t.setStyle(TableStyle([
        ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    el.append(act_t)
    el.append(Spacer(CONTENT_W, 10))
    el.append(SectionLabel("RANKING DE EQUIPOS"))
    el.append(Spacer(CONTENT_W, 4))

    eq_headers = ["Ranking", "Equipo", "Trabajos", "Unidad"]
    eq_rows    = []
    for idx, eq in enumerate(top_equipos):
        eq_rows.append([
            str(idx + 1),
            str(eq.get("nombre", "")),
            str(eq.get("trabajos", 0)),
            str(eq.get("unidad", "")),
        ])
    if not eq_rows:
        eq_rows = [["", "Sin datos", "", ""]]

    eq_all  = [eq_headers] + eq_rows
    eq_cw   = [40, CONTENT_W - 200, 80, 80]
    eq_t    = Table(eq_all, colWidths=eq_cw, repeatRows=1)
    eq_style = [
        ("BACKGROUND",    (0, 0), (-1, 0), SLATE_DARK),
        ("TEXTCOLOR",     (0, 0), (-1, 0), WHITE),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 7),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("TEXTCOLOR",     (0, 1), (-1, -1), SLATE_DARK),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW",     (0, 0), (-1, -1), 0.3, GRAY_LINE),
    ]
    if len(eq_rows) >= 1:
        eq_style.append(("BACKGROUND", (0, 1), (-1, 1), ORANGE_L))
    if len(eq_rows) >= 2:
        eq_style.append(("BACKGROUND", (0, 2), (-1, 2), ORANGE_L))
    for i in range(3, len(eq_rows) + 1):
        bg = SLATE_LIGHT if i % 2 == 1 else WHITE
        eq_style.append(("BACKGROUND", (0, i), (-1, i), bg))
    eq_t.setStyle(TableStyle(eq_style))
    el.append(eq_t)
    el.append(Spacer(CONTENT_W, 8))

    # Closing block
    n_trab = kpis.get("trabajosCerrados", {}).get("actual", 0) or 0
    n_med  = kpis.get("mediciones",       {}).get("actual", 0) or 0
    n_hh   = kpis.get("hhRegistradas",    {}).get("actual", 0) or 0
    n_ot   = kpis.get("otCerradas",       {}).get("actual", 0) or 0
    kpis_summary = "Trabajos: %s  |  Mediciones: %s  |  HH: %s  |  OT: %s" % (
        n_trab, n_med, n_hh, n_ot
    )
    el.append(ClosingBlock(kpis_summary, date_gen, width=CONTENT_W, height=62))
    return el


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    if len(sys.argv) < 3:
        print("Usage: python generar_pdf.py input.json output.pdf", file=sys.stderr)
        sys.exit(1)

    input_path  = sys.argv[1]
    output_path = sys.argv[2]

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    rango    = data.get("rango", {})
    date_gen = data.get("generado", "")

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=62,
        bottomMargin=30,
        title="Planify - Control de Mantenimiento",
        author="Planify",
    )
    doc._planify_daterange = "%s - %s" % (rango.get("desde", ""), rango.get("hasta", ""))
    doc._planify_generado  = date_gen

    story = []
    story.extend(build_page1(data))
    story.extend(build_page2(data))
    story.extend(build_page3(data))
    story.extend(build_page4(data))
    story.extend(build_page5(data))

    doc.build(story, onFirstPage=draw_page_frame, onLaterPages=draw_page_frame)
    print("PDF guardado en: %s" % output_path)


if __name__ == "__main__":
    main()
