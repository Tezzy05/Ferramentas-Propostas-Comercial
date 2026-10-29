"""
Atualização da proposta comercial em PowerPoint.

O modelo (modelo/Proposta_Comercial.pptx) usa marcadores no formato {{NOME}}
em caixas de texto, formas, tabelas e grupos. Ao gerar, cada marcador é trocado
pelo valor da proposta mantendo a formatação do texto original.
"""
from io import BytesIO
from pathlib import Path
import re

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from .calculos import fmt_data, fmt_moeda, fmt_num, fmt_pct

BASE_DIR = Path(__file__).resolve().parent.parent
PPT_MODEL_PATH = BASE_DIR / "modelo" / "Proposta_Comercial.pptx"

PATTERN = re.compile(r"\{\{\s*([A-Z0-9_]+)\s*\}\}")

# Descrição exibida no painel e no README. Marcadores por ano (META_2025,
# VOLUME_2025, COMPENSAR_2025, VALOR_2025) são gerados para cada ano do modelo.
DESCRICOES = {
    "CLIENTE": "Razão social do cliente",
    "CNPJ": "CNPJ do cliente",
    "CONTATO": "Nome do contato no cliente",
    "EMAIL_CLIENTE": "E-mail do contato",
    "TELEFONE": "Telefone do contato",
    "CIDADE_UF": "Cidade/UF do cliente",
    "NUMERO_PROPOSTA": "Número da proposta",
    "DATA_PROPOSTA": "Data da proposta (dd/mm/aaaa)",
    "VALIDADE": "Data de validade (dd/mm/aaaa)",
    "VALIDADE_DIAS": "Validade em dias",
    "RESPONSAVEL": "Responsável comercial",
    "EMAIL_RESPONSAVEL": "E-mail do responsável comercial",
    "ANOS": "Anos de compensação (ex.: 2025, 2024)",
    "QTD_ANOS": "Quantidade de anos",
    "ESTADOS": "UFs com volume declarado",
    "QTD_ESTADOS": "Quantidade de UFs",
    "MATERIAIS": "Materiais com volume declarado",
    "VOLUME_DECLARADO": "Massa total declarada (t)",
    "VOLUME_COMPENSAR": "Massa total a compensar (t)",
    "SUBTOTAL": "Valor antes do desconto (R$)",
    "DESCONTO_PERCENTUAL": "Desconto (%)",
    "DESCONTO": "Desconto (R$)",
    "VALOR_TOTAL": "Valor total da proposta (R$)",
    "OBSERVACOES": "Observações da proposta",
    "EMPRESA": "Razão social da Ambipar",
    "CNPJ_EMPRESA": "CNPJ da Ambipar",
}


def montar_valores(proposta, calc, parametros, anos_modelo):
    cliente, dados = proposta["cliente"], proposta["proposta"]
    valores = {
        "CLIENTE": cliente["razao_social"],
        "CNPJ": cliente["cnpj"],
        "CONTATO": cliente["contato"],
        "EMAIL_CLIENTE": cliente["email"],
        "TELEFONE": cliente["telefone"],
        "CIDADE_UF": cliente["cidade_uf"],
        "NUMERO_PROPOSTA": dados["numero"],
        "DATA_PROPOSTA": fmt_data(dados["data"]),
        "VALIDADE": fmt_data(dados["validade"]),
        "VALIDADE_DIAS": str(dados["validade_dias"]),
        "RESPONSAVEL": dados["responsavel"],
        "EMAIL_RESPONSAVEL": dados["email_responsavel"],
        "ANOS": ", ".join(str(a) for a in calc["anos"]),
        "QTD_ANOS": str(len(calc["anos"])),
        "ESTADOS": ", ".join(e["uf"] for e in calc["por_estado"]),
        "QTD_ESTADOS": str(len(calc["por_estado"])),
        "MATERIAIS": ", ".join(m["material"].title() for m in calc["por_material"]),
        "VOLUME_DECLARADO": f'{fmt_num(calc["declarado"], 3)} t',
        "VOLUME_COMPENSAR": f'{fmt_num(calc["compensar"], 3)} t',
        "SUBTOTAL": fmt_moeda(calc["subtotal"]),
        "DESCONTO_PERCENTUAL": fmt_pct(calc["desconto_percentual"]),
        "DESCONTO": fmt_moeda(calc["desconto_valor"]),
        "VALOR_TOTAL": fmt_moeda(calc["total"]),
        "OBSERVACOES": dados["observacoes"],
        "EMPRESA": parametros["empresa"]["razao_social"],
        "CNPJ_EMPRESA": parametros["empresa"]["cnpj"],
    }

    por_ano = {a["ano"]: a for a in calc["por_ano"]}
    for ano in anos_modelo:
        info = por_ano.get(ano)
        valores[f"META_{ano}"] = fmt_pct(info["meta"]) if info else "-"
        valores[f"VOLUME_{ano}"] = f'{fmt_num(info["declarado"], 3)} t' if info else "-"
        valores[f"COMPENSAR_{ano}"] = f'{fmt_num(info["compensar"], 3)} t' if info else "-"
        valores[f"VALOR_{ano}"] = fmt_moeda(info["valor"]) if info else "-"

    return {k: str(v).replace("\r", "").replace("\n", " ") for k, v in valores.items()}


def listar_marcadores(anos_modelo):
    lista = [{"marcador": f"{{{{{k}}}}}", "descricao": v} for k, v in DESCRICOES.items()]
    if anos_modelo:
        ano = anos_modelo[0]
        lista += [
            {"marcador": f"{{{{META_{ano}}}}}", "descricao": "Meta do ano (troque o ano conforme a guia)"},
            {"marcador": f"{{{{VOLUME_{ano}}}}}", "descricao": "Massa declarada no ano (t)"},
            {"marcador": f"{{{{COMPENSAR_{ano}}}}}", "descricao": "Massa a compensar no ano (t)"},
            {"marcador": f"{{{{VALOR_{ano}}}}}", "descricao": "Valor do ano (R$)"},
        ]
    return lista


def _replace_paragraph(paragraph, valores, pendentes):
    runs = paragraph.runs
    if not runs:
        return

    def sub(match):
        key = match.group(1)
        if key in valores:
            return valores[key]
        pendentes.add(key)
        return match.group(0)

    # 1) Marcador inteiro dentro de um único trecho: troca preservando cada formatação.
    for run in runs:
        if "{{" in run.text:
            run.text = PATTERN.sub(sub, run.text)

    # 2) PowerPoint às vezes quebra "{{CLIENTE}}" em vários trechos; junta no primeiro.
    full = "".join(run.text for run in runs)
    if any(m.group(1) in valores for m in PATTERN.finditer(full)):
        runs[0].text = PATTERN.sub(sub, full)
        for run in runs[1:]:
            run.text = ""


def _iter_text_frames(shapes):
    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from _iter_text_frames(shape.shapes)
            continue
        if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
            yield shape.text_frame
        if getattr(shape, "has_table", False) and shape.has_table:
            for row in shape.table.rows:
                for cell in row.cells:
                    yield cell.text_frame


def gerar_ppt(valores):
    if not PPT_MODEL_PATH.exists():
        raise FileNotFoundError(
            "Modelo da proposta não encontrado. Salve o PowerPoint com os marcadores "
            f"{{{{...}}}} em: modelo/{PPT_MODEL_PATH.name}"
        )

    prs = Presentation(str(PPT_MODEL_PATH))
    pendentes = set()
    for slide in prs.slides:
        for text_frame in _iter_text_frames(slide.shapes):
            for paragraph in text_frame.paragraphs:
                _replace_paragraph(paragraph, valores, pendentes)

    output = BytesIO()
    prs.save(output)
    output.seek(0)
    return output, sorted(pendentes)
