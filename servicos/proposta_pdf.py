"""
PDF da proposta técnica: volumes declarados, massa a compensar e valores.
"""
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
)

from .calculos import fmt_data, fmt_moeda, fmt_num, fmt_pct, texto_escopo

FOREST = colors.HexColor("#163300")
LIME = colors.HexColor("#9fe870")
MIST = colors.HexColor("#e2f6d5")
FOG = colors.HexColor("#e8ebe6")
INK = colors.HexColor("#0e0f0c")
CHARCOAL = colors.HexColor("#454745")
SLATE = colors.HexColor("#6a6c6a")
WARN = colors.HexColor("#9a5b00")

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

ST = {
    "titulo": ParagraphStyle("titulo", fontName="Helvetica-Bold", fontSize=20, leading=24,
                             textColor=INK, spaceAfter=2),
    "subtitulo": ParagraphStyle("subtitulo", fontName="Helvetica", fontSize=10, leading=14,
                                textColor=SLATE),
    "secao": ParagraphStyle("secao", fontName="Helvetica-Bold", fontSize=12, leading=16,
                            textColor=FOREST, spaceBefore=14, spaceAfter=6),
    "rotulo": ParagraphStyle("rotulo", fontName="Helvetica", fontSize=7.5, leading=10,
                             textColor=SLATE),
    "valor": ParagraphStyle("valor", fontName="Helvetica-Bold", fontSize=9.5, leading=12,
                            textColor=INK),
    "kpi_rotulo": ParagraphStyle("kpi_rotulo", fontName="Helvetica", fontSize=8, leading=10,
                                 textColor=SLATE),
    "kpi": ParagraphStyle("kpi", fontName="Helvetica-Bold", fontSize=15, leading=18,
                          textColor=INK),
    "kpi_dark_rotulo": ParagraphStyle("kpi_dark_rotulo", fontName="Helvetica", fontSize=8,
                                      leading=10, textColor=MIST),
    "kpi_dark": ParagraphStyle("kpi_dark", fontName="Helvetica-Bold", fontSize=15, leading=18,
                               textColor=LIME),
    "texto": ParagraphStyle("texto", fontName="Helvetica", fontSize=9, leading=13,
                            textColor=CHARCOAL),
    "aviso": ParagraphStyle("aviso", fontName="Helvetica-Bold", fontSize=8.5, leading=12,
                            textColor=WARN),
    "th": ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=8, leading=10,
                         textColor=FOREST),
    "th_r": ParagraphStyle("th_r", fontName="Helvetica-Bold", fontSize=8, leading=10,
                           textColor=FOREST, alignment=TA_RIGHT),
}


def _esc(texto):
    return (str(texto or "-").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _info_bloco(pares):
    cells = [[Paragraph(_esc(rotulo).upper(), ST["rotulo"]),
              Paragraph(_esc(valor), ST["valor"])] for rotulo, valor in pares]
    linhas = [[c[0] for c in cells[i:i + 2]] + [""] * (2 - len(cells[i:i + 2]))
              for i in range(0, len(cells), 2)]
    valores = [[c[1] for c in cells[i:i + 2]] + [""] * (2 - len(cells[i:i + 2]))
               for i in range(0, len(cells), 2)]
    data = []
    for rot, val in zip(linhas, valores):
        data += [rot, val]
    table = Table(data, colWidths=[CONTENT_W / 2] * 2)
    estilo = [("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
              ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]
    for r in range(1, len(data), 2):
        estilo.append(("BOTTOMPADDING", (0, r), (-1, r), 7))
    table.setStyle(TableStyle(estilo))
    return table


def _kpis(calc):
    def celula(rotulo, valor, escuro=False):
        sufixo = "_dark" if escuro else ""
        return [Paragraph(rotulo, ST[f"kpi{sufixo}_rotulo" if escuro else "kpi_rotulo"]),
                Paragraph(valor, ST[f"kpi{sufixo}"])]

    blocos = [
        celula("Massa declarada", f'{fmt_num(calc["declarado"], 3)} t'),
        celula("Massa a compensar", f'{fmt_num(calc["compensar"], 3)} t'),
        celula("Valor total", fmt_moeda(calc["total"]), escuro=True),
    ]
    table = Table([blocos], colWidths=[CONTENT_W / 3] * 3)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (1, 0), MIST),
        ("BACKGROUND", (2, 0), (2, 0), FOREST),
        ("LINEAFTER", (0, 0), (0, 0), 2, colors.white),
        ("LINEAFTER", (1, 0), (1, 0), 2, colors.white),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return table


def _tabela(cabecalho, linhas, total=None, larguras=None):
    head = [Paragraph(h, ST["th"] if i == 0 else ST["th_r"]) for i, h in enumerate(cabecalho)]
    data = [head] + linhas + ([total] if total else [])
    larguras = larguras or [CONTENT_W / len(cabecalho)] * len(cabecalho)
    table = Table(data, colWidths=larguras, repeatRows=1)
    estilo = [
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 8.5),
        ("TEXTCOLOR", (0, 1), (-1, -1), CHARCOAL),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("BACKGROUND", (0, 0), (-1, 0), MIST),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, FOG),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    if total:
        estilo += [
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("TEXTCOLOR", (0, -1), (-1, -1), INK),
            ("LINEABOVE", (0, -1), (-1, -1), 1, FOREST),
            ("LINEBELOW", (0, -1), (-1, -1), 0, colors.white),
        ]
    table.setStyle(TableStyle(estilo))
    return table


def _tabela_materiais(materiais, total_decl, total_comp, total_valor):
    linhas = [[m["material"].title(), fmt_num(m["declarado"], 3), fmt_num(m["compensar"], 3),
               fmt_moeda(m["preco"]), fmt_moeda(m["valor"])] for m in materiais]
    total = ["Total", fmt_num(total_decl, 3), fmt_num(total_comp, 3), "", fmt_moeda(total_valor)]
    w = CONTENT_W
    return _tabela(["Material", "Declarado (t)", "A compensar (t)", "Preço médio/t", "Valor"],
                   linhas, total, [w * .28, w * .17, w * .19, w * .16, w * .20])


def _tabela_estados(estados):
    linhas = [[e["uf"], fmt_num(e["declarado"], 3), fmt_pct(e["percentual"]),
               fmt_num(e["compensar"], 3), fmt_moeda(e["valor"])] for e in estados]
    w = CONTENT_W
    return _tabela(["UF", "Declarado (t)", "% aplicado", "A compensar (t)", "Valor"], linhas,
                   larguras=[w * .12, w * .22, w * .16, w * .24, w * .26])


def _descricao_ano(ano):
    regra = ano["regra"]
    if ano["modo"] == "nacional":
        if not ano["distribuido"]:
            modo = ("Compensação nacional. Distribuição por UF pela Metodologia CONFAZ pendente; "
                    "aplicado o percentual geral sobre o total declarado.")
        elif ano["confaz_origem"] and ano["confaz_origem"] != ano["ano"]:
            modo = ("Compensação nacional distribuída entre as UFs pela Metodologia CONFAZ "
                    f'(tabela de {ano["confaz_origem"]}, a mais recente validada).')
        else:
            modo = "Compensação nacional distribuída entre as UFs pela Metodologia CONFAZ."
    else:
        modo = "Compensação por estado, conforme massas declaradas por UF."

    ajustes = ""
    if ano["ajustes_uf"]:
        lista = ", ".join(f"{uf} {fmt_pct(p)}" for uf, p in sorted(ano["ajustes_uf"].items()))
        ajustes = f" Ajustes por UF: {lista}."

    return (f'{modo} Recuperação contratada: <b>{fmt_pct(ano["recuperacao"])}</b>{ajustes} '
            f'Mínimo legal do ano-base: {_esc(regra["resumo"])} '
            f'Percentual efetivo sobre a massa declarada: {fmt_pct(ano["percentual_efetivo"])}.')


def _tabela_investimento(calc):
    if calc["regime"] == "plano":
        plano = calc["plano"]
        linhas = [[f'{fmt_num(calc["compensar"], 3)} t a compensar × {fmt_moeda(plano["preco_t"])} por tonelada '
                   f'(plano até {fmt_num(plano["ate_t"], 0)} t)', fmt_moeda(calc["subtotal"])]]
    else:
        linhas = [[f'{fmt_num(calc["compensar"], 3)} t a compensar × {fmt_moeda(calc["preco_t"])} por tonelada',
                   fmt_moeda(calc["subtotal"])]]
    if calc["desconto_valor"]:
        linhas.append([f'Desconto ({fmt_pct(calc["desconto_percentual"])})',
                       f'- {fmt_moeda(calc["desconto_valor"])}'])
    linhas.append(["Valor total da proposta", fmt_moeda(calc["total"])])
    table = Table(linhas, colWidths=[CONTENT_W * .65, CONTENT_W * .35])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), CHARCOAL),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, FOG),
        ("BACKGROUND", (0, -1), (-1, -1), FOREST),
        ("TEXTCOLOR", (0, -1), (0, -1), colors.white),
        ("TEXTCOLOR", (1, -1), (1, -1), LIME),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def _moldura(proposta, parametros):
    numero = proposta["proposta"]["numero"]
    empresa = parametros["empresa"]

    def desenhar(canvas, doc):
        canvas.saveState()
        faixa = 20 * mm
        canvas.setFillColor(FOREST)
        canvas.rect(0, PAGE_H - faixa, PAGE_W, faixa, stroke=0, fill=1)
        canvas.setFillColor(LIME)
        canvas.rect(MARGIN, PAGE_H - faixa + 7.2 * mm, 3, 5.6 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(MARGIN + 7, PAGE_H - faixa + 8.4 * mm, "PROPOSTA TÉCNICA")
        canvas.setFont("Helvetica", 9)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - faixa + 8.4 * mm,
                               f'{empresa["nome_curto"]}  ·  Nº {numero}')

        canvas.setStrokeColor(FOG)
        canvas.setLineWidth(0.6)
        canvas.line(MARGIN, 14 * mm, PAGE_W - MARGIN, 14 * mm)
        canvas.setFillColor(SLATE)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(MARGIN, 9.5 * mm, f'{empresa["razao_social"]} · CNPJ {empresa["cnpj"]}')
        canvas.drawRightString(PAGE_W - MARGIN, 9.5 * mm, f"Página {doc.page}")
        canvas.restoreState()

    return desenhar


def gerar_pdf(proposta, calc, parametros):
    cliente, dados = proposta["cliente"], proposta["proposta"]
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        # O frame do reportlab tem 6pt de respiro interno; compensa para alinhar ao cabeçalho.
        buffer, pagesize=A4, leftMargin=MARGIN - 6, rightMargin=MARGIN - 6,
        topMargin=30 * mm, bottomMargin=20 * mm,
        title=f'Proposta Técnica {dados["numero"]} - {cliente["razao_social"]}',
        author=parametros["empresa"]["razao_social"],
    )

    story = [
        Paragraph("Compensação de logística reversa de embalagens", ST["titulo"]),
        Paragraph(f'Preparada para <b>{_esc(cliente["razao_social"])}</b> · '
                  f'{_esc(texto_escopo(calc))}',
                  ST["subtitulo"]),
        Spacer(1, 12),
        _info_bloco([
            ("Cliente", cliente["razao_social"]), ("Nº da proposta", dados["numero"]),
            ("CNPJ", cliente["cnpj"]), ("Data", fmt_data(dados["data"])),
            ("Contato", cliente["contato"]),
            ("Validade", f'{fmt_data(dados["validade"])} ({dados["validade_dias"]} dias)'),
            ("E-mail / telefone", " · ".join(x for x in (cliente["email"], cliente["telefone"]) if x)),
            ("Responsável comercial", " · ".join(
                x for x in (dados["responsavel"], dados["email_responsavel"]) if x)),
        ]),
        Spacer(1, 8),
        _kpis(calc),
    ]


    story += [
        Paragraph("Resumo por material", ST["secao"]),
        _tabela_materiais(calc["por_material"], calc["declarado"], calc["compensar"],
                          calc["subtotal"]),
    ]

    for ano in calc["por_ano"]:
        titulo = "Nacional · Metodologia CONFAZ" if ano["modo"] == "nacional" else "Por estados"
        story += [
            KeepTogether([
                Paragraph(f'Ano-base {ano["ano"]} · {titulo}', ST["secao"]),
                Paragraph(_descricao_ano(ano), ST["texto"]),
                Spacer(1, 6),
                _tabela_materiais(ano["materiais"], ano["declarado"], ano["compensar"],
                                  ano["valor"]),
            ]),
        ]
        if ano["estados"]:
            story += [Spacer(1, 8), _tabela_estados(ano["estados"])]

    story += [KeepTogether([
        Paragraph("Investimento", ST["secao"]),
        _tabela_investimento(calc),
    ])]

    condicoes = [parametros["proposta"]["condicoes"]]
    if proposta["proposta"].get("forma_pagamento"):
        condicoes.append(f'Forma de pagamento: {proposta["proposta"]["forma_pagamento"]}')
    for ano in sorted(calc["por_ano"], key=lambda a: a["ano"]):
        texto = ano["regra"]["texto"]
        if texto and texto not in condicoes:
            condicoes.append(texto)
    if dados["observacoes"]:
        condicoes.append(dados["observacoes"])
    story += [Paragraph("Condições e observações", ST["secao"])]
    story += [Paragraph(_esc(c).replace("\n", "<br/>"), ST["texto"]) for c in condicoes]

    moldura = _moldura(proposta, parametros)
    doc.build(story, onFirstPage=moldura, onLaterPages=moldura)
    buffer.seek(0)
    return buffer
