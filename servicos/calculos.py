"""
Regras de negócio da proposta: normalização de números, validação do que
vem do painel e cálculo de massa a compensar e valores.

Massa a compensar = massa declarada × meta de compensação do ano.
Valor             = massa a compensar × preço por tonelada do material.
"""
from datetime import date, datetime, timedelta
import math
import re
import unicodedata

MATERIAIS = [
    "PAPEL/PAPELÃO", "PLÁSTICO", "VIDRO", "AÇO/FERRO", "ALUMÍNIO",
    "LONGA VIDA", "ISOPOR", "BOPP", "AEROSSOL", "OUTRO MATERIAL"
]

ESTADOS = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
    "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"
]


def normalize_number(value, campo="Valor"):
    """Aceita número ou texto em pt-BR ("1.234,56") / en ("1234.56")."""
    if value is None or value == "":
        return 0.0

    if isinstance(value, bool):
        raise ValueError(f"{campo}: valor inválido.")

    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip().replace(" ", "").replace("R$", "").replace("%", "")
        if "," in text and "." in text:
            text = text.replace(".", "").replace(",", ".")
        elif "," in text:
            text = text.replace(",", ".")
        try:
            number = float(text) if text else 0.0
        except ValueError:
            raise ValueError(f"{campo}: valor inválido ({value}).")

    if not math.isfinite(number):
        raise ValueError(f"{campo}: valor numérico inválido ({value}).")
    if number < 0:
        raise ValueError(f"{campo}: não são permitidos valores negativos.")
    return number


def _texto(value, limite=300):
    return str(value or "").strip()[:limite]


def _data(value):
    if not value:
        return date.today()
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError:
        raise ValueError(f"Data da proposta inválida: {value}")


def validar_volumes(anos_payload, anos_disponiveis):
    """
    Recebe {"2025": {"SP": [10 valores], ...}, ...} e devolve
    {2025: {"SP": [floats]}} sem estados zerados. Exige ao menos um volume.
    """
    if not isinstance(anos_payload, dict):
        raise ValueError("Volumes recebidos em formato inválido.")

    normalized = {}
    for year_text, states_data in anos_payload.items():
        try:
            year = int(year_text)
        except (TypeError, ValueError):
            raise ValueError(f"Ano inválido: {year_text}")

        if year not in anos_disponiveis:
            raise ValueError(f'A guia "{year}" não existe no modelo.')
        if not isinstance(states_data, dict):
            raise ValueError(f"Os dados de {year} estão inválidos.")

        for state_text, values in states_data.items():
            state = str(state_text).strip().upper()
            if state not in ESTADOS:
                raise ValueError(f'Estado inválido: "{state_text}".')
            if not isinstance(values, list) or len(values) != len(MATERIAIS):
                raise ValueError(f"{state}/{year}: são esperados {len(MATERIAIS)} valores.")

            vals = [
                normalize_number(v, f"{state}/{year} - {MATERIAIS[i]}")
                for i, v in enumerate(values)
            ]
            if any(v > 0 for v in vals):
                normalized.setdefault(year, {})[state] = vals

    if not normalized:
        raise ValueError("Informe o volume de pelo menos um estado.")
    return dict(sorted(normalized.items(), reverse=True))


def validar_proposta(payload, anos_disponiveis, metas_modelo, parametros):
    """Valida o payload completo do painel (cliente, proposta, comercial, volumes)."""
    if not isinstance(payload, dict):
        raise ValueError("Dados recebidos em formato inválido.")

    volumes = validar_volumes(payload.get("anos"), anos_disponiveis)

    cliente_raw = payload.get("cliente") or {}
    cliente = {k: _texto(cliente_raw.get(k)) for k in
               ("razao_social", "cnpj", "contato", "email", "telefone", "cidade_uf")}
    if not cliente["razao_social"]:
        raise ValueError("Informe a razão social do cliente.")

    proposta_raw = payload.get("proposta") or {}
    data_proposta = _data(proposta_raw.get("data"))
    validade_dias = int(normalize_number(
        proposta_raw.get("validade_dias") or parametros["proposta"]["validade_dias"],
        "Validade"
    ))
    proposta = {
        "numero": _texto(proposta_raw.get("numero"), 60) or gerar_numero(parametros),
        "data": data_proposta,
        "validade_dias": validade_dias,
        "validade": data_proposta + timedelta(days=validade_dias),
        "responsavel": _texto(proposta_raw.get("responsavel")),
        "email_responsavel": _texto(proposta_raw.get("email_responsavel")),
        "observacoes": _texto(proposta_raw.get("observacoes"), 2000),
    }

    comercial_raw = payload.get("comercial") or {}
    precos_raw = comercial_raw.get("precos") or []
    if not isinstance(precos_raw, list) or len(precos_raw) != len(MATERIAIS):
        raise ValueError(f"São esperados {len(MATERIAIS)} preços por tonelada.")
    precos = [normalize_number(v, f"Preço - {MATERIAIS[i]}") for i, v in enumerate(precos_raw)]

    metas_raw = comercial_raw.get("metas") or {}
    metas = {}
    for year in volumes:
        meta = metas_raw.get(str(year))
        meta_pct = normalize_number(meta, f"Meta {year}") if meta not in (None, "") \
            else metas_modelo.get(year, 0) * 100
        if meta_pct > 100:
            raise ValueError(f"Meta {year}: o percentual não pode passar de 100%.")
        metas[year] = meta_pct / 100

    desconto = normalize_number(comercial_raw.get("desconto_percentual"), "Desconto")
    if desconto > 100:
        raise ValueError("Desconto: o percentual não pode passar de 100%.")

    nomes = list(MATERIAIS)
    outro_nome = _texto(comercial_raw.get("outro_material_nome"), 40)
    if outro_nome:
        nomes[-1] = outro_nome.upper()

    return {
        "cliente": cliente,
        "proposta": proposta,
        "volumes": volumes,
        "metas": metas,
        "precos": precos,
        "desconto": desconto / 100,
        "materiais": nomes,
    }


def gerar_numero(parametros, hoje=None):
    hoje = hoje or datetime.now()
    return f'{parametros["proposta"]["prefixo_numero"]}-{hoje:%Y%m%d-%H%M}'


def calcular(proposta):
    """Monta todos os números usados no PDF e no PPT."""
    volumes, metas, precos = proposta["volumes"], proposta["metas"], proposta["precos"]
    nomes = proposta["materiais"]

    por_ano = []
    acumulado = [{"material": nomes[i], "declarado": 0.0, "compensar": 0.0,
                  "preco": precos[i], "valor": 0.0} for i in range(len(MATERIAIS))]
    estados_total = {}

    for year, states in volumes.items():
        meta = metas[year]
        materiais = []
        for i in range(len(MATERIAIS)):
            declarado = sum(vals[i] for vals in states.values())
            compensar = declarado * meta
            valor = compensar * precos[i]
            materiais.append({"material": nomes[i], "declarado": declarado,
                              "compensar": compensar, "preco": precos[i], "valor": valor})
            acumulado[i]["declarado"] += declarado
            acumulado[i]["compensar"] += compensar
            acumulado[i]["valor"] += valor

        estados = []
        for uf in ESTADOS:
            if uf not in states:
                continue
            vals = states[uf]
            declarado = sum(vals)
            compensar = declarado * meta
            valor = sum(v * meta * precos[i] for i, v in enumerate(vals))
            estados.append({"uf": uf, "declarado": declarado,
                            "compensar": compensar, "valor": valor})
            total_uf = estados_total.setdefault(uf, {"uf": uf, "declarado": 0.0,
                                                     "compensar": 0.0, "valor": 0.0})
            total_uf["declarado"] += declarado
            total_uf["compensar"] += compensar
            total_uf["valor"] += valor

        por_ano.append({
            "ano": year,
            "meta": meta,
            "materiais": [m for m in materiais if m["declarado"] > 0],
            "estados": estados,
            "declarado": sum(m["declarado"] for m in materiais),
            "compensar": sum(m["compensar"] for m in materiais),
            "valor": sum(m["valor"] for m in materiais),
        })

    subtotal = sum(m["valor"] for m in acumulado)
    desconto_valor = subtotal * proposta["desconto"]

    return {
        "por_ano": por_ano,
        "por_material": [m for m in acumulado if m["declarado"] > 0],
        "por_estado": [estados_total[uf] for uf in ESTADOS if uf in estados_total],
        "anos": list(volumes.keys()),
        "declarado": sum(m["declarado"] for m in acumulado),
        "compensar": sum(m["compensar"] for m in acumulado),
        "subtotal": subtotal,
        "desconto_percentual": proposta["desconto"],
        "desconto_valor": desconto_valor,
        "total": subtotal - desconto_valor,
        "materiais_sem_preco": [m["material"] for m in acumulado
                                if m["declarado"] > 0 and m["preco"] == 0],
    }


# ---------- formatação pt-BR ----------

def fmt_num(value, casas=2):
    text = f"{value:,.{casas}f}"
    return text.replace(",", "_").replace(".", ",").replace("_", ".")


def fmt_moeda(value):
    return f"R$ {fmt_num(value, 2)}"


def fmt_pct(value):
    texto = fmt_num(value * 100, 2)
    texto = re.sub(r",00$", "", texto)
    return f"{texto}%"


def fmt_data(value):
    return value.strftime("%d/%m/%Y")


def slug(texto, limite=40):
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^\w\s-]", "", texto).strip()
    texto = re.sub(r"[\s-]+", "_", texto)
    return texto[:limite] or "cliente"
