"""
Regras de negócio da proposta: normalização de números, validação do que
vem do painel e cálculo de massa a compensar e valores.

Cada ano-base é informado em um de dois modos:
- "estados": toneladas por UF e material (grade do painel);
- "nacional": toneladas totais por material, distribuídas entre as UFs pela
  Metodologia CONFAZ (participação de cada UF, config/confaz.json).

Percentual aplicado à UF = ajuste da UF, se houver; senão o maior entre a
recuperação nacional contratada e a meta mínima da UF no ano.
Massa a compensar = massa declarada × percentual aplicado.
Preço (sobre a massa a compensar total da proposta, soma de todos os anos):
- até 5 t: plano fechado com preço por tonelada da faixa;
- acima de 5 t: preço de venda por tonelada com DRE (custo por UF × categoria,
  impostos, mão de obra e margem); o preço vem do comercial (ou da referência)
  ou é recalculado a partir da margem informada. Ver servicos/precificacao.py.
"""
from datetime import date, datetime, timedelta
import math
import re
import unicodedata

from .precificacao import custo_direto, dre_resultado, plano_para, preco_para_margem, valor_plano

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


def _ano(year_text, permitidos, contexto):
    try:
        year = int(year_text)
    except (TypeError, ValueError):
        raise ValueError(f"Ano inválido: {year_text}")
    if year not in permitidos:
        raise ValueError(f"O ano-base {year} não está disponível {contexto}.")
    return year


def _materiais(values, rotulo):
    if not isinstance(values, list) or len(values) != len(MATERIAIS):
        raise ValueError(f"{rotulo}: são esperados {len(MATERIAIS)} valores.")
    return [normalize_number(v, f"{rotulo} - {MATERIAIS[i]}") for i, v in enumerate(values)]


def validar_declaracao(payload, ctx):
    """
    Valida os volumes do painel:
      anos:        {"2023": {"SP": [10 valores]}}  (modo por estados)
      nacional:    {"2025": [10 valores]}          (modo nacional / CONFAZ)
      recuperacao: {"2025": 40}                    (% contratado, mínimo = meta do ano)
    """
    if not isinstance(payload, dict):
        raise ValueError("Dados recebidos em formato inválido.")

    volumes = {}
    anos_payload = payload.get("anos") or {}
    if not isinstance(anos_payload, dict):
        raise ValueError("Volumes recebidos em formato inválido.")
    for year_text, states_data in anos_payload.items():
        year = _ano(year_text, set(ctx["anos"]), "no painel")
        if not isinstance(states_data, dict):
            raise ValueError(f"Os dados de {year} estão inválidos.")
        for state_text, values in states_data.items():
            state = str(state_text).strip().upper()
            if state not in ESTADOS:
                raise ValueError(f'Estado inválido: "{state_text}".')
            vals = _materiais(values, f"{state}/{year}")
            if any(v > 0 for v in vals):
                volumes.setdefault(year, {})[state] = vals

    nacional = {}
    nacional_payload = payload.get("nacional") or {}
    if not isinstance(nacional_payload, dict):
        raise ValueError("Volumes nacionais recebidos em formato inválido.")
    for year_text, values in nacional_payload.items():
        year = _ano(year_text, set(ctx["anos_nacional"]), "para compensação nacional (CONFAZ)")
        vals = _materiais(values, f"Nacional/{year}")
        if any(v > 0 for v in vals):
            nacional[year] = vals

    duplicados = sorted(set(volumes) & set(nacional))
    if duplicados:
        raise ValueError(
            f"O ano-base {duplicados[0]} está preenchido por estados e nacional ao mesmo tempo. "
            "Escolha um dos modos."
        )
    if not volumes and not nacional:
        raise ValueError("Informe o volume de pelo menos um estado ou da compensação nacional.")

    recuperacao_payload = payload.get("recuperacao") or {}
    recuperacao = {}
    for year in set(volumes) | set(nacional):
        regra = ctx["regras"][year]
        bruto = recuperacao_payload.get(str(year))
        if not isinstance(bruto, dict):
            bruto = {"nacional": bruto}
        pct = _pct_recuperacao(bruto.get("nacional"), regra["minimo"], f"Recuperação {year}")
        ajustes = {}
        for uf, valor in (bruto.get("estados") or {}).items():
            uf = str(uf).strip().upper()
            if uf not in ESTADOS:
                raise ValueError(f'Recuperação {year}: UF inválida "{uf}".')
            if valor in (None, ""):
                continue
            minimo_uf = regra["excecoes"].get(uf, regra["minimo"])
            ajustes[uf] = _pct_recuperacao(valor, minimo_uf, f"Recuperação {year}/{uf}")
        recuperacao[year] = {"nacional": pct, "estados": ajustes}

    return {"volumes": volumes, "nacional": nacional, "recuperacao": recuperacao}


def _pct_recuperacao(bruto, minimo, rotulo):
    pct = minimo if bruto in (None, "") else normalize_number(bruto, rotulo)
    if pct > 100:
        raise ValueError(f"{rotulo}: o percentual não pode passar de 100%.")
    if pct + 1e-9 < minimo:
        raise ValueError(f"{rotulo}: o mínimo é {fmt_pct(minimo / 100)}.")
    return pct / 100


def distribuir_nacional(totais, tabela):
    """Distribui toneladas nacionais por UF conforme a participação CONFAZ (%)."""
    return {
        uf: [v * tabela[uf] / 100 for v in totais]
        for uf in ESTADOS if tabela.get(uf, 0) > 0
    }


def estados_do_ano(declaracao, ctx, year):
    """Volumes por UF do ano e se a distribuição por UF existe (False = nacional sem tabela)."""
    if year in declaracao["volumes"]:
        return declaracao["volumes"][year], True
    tabela = ctx["confaz"].get(year)
    if not tabela:
        return None, False
    return distribuir_nacional(declaracao["nacional"][year], tabela), True


def volumes_para_planilha(declaracao, ctx):
    """Volumes por UF de todos os anos, prontos para a planilha de autodeclaração."""
    resultado = {}
    for year in sorted(set(declaracao["volumes"]) | set(declaracao["nacional"]), reverse=True):
        estados, distribuido = estados_do_ano(declaracao, ctx, year)
        if not distribuido:
            raise ValueError(
                f"{year} está como compensação nacional, mas a tabela da Metodologia CONFAZ "
                "deste ano não foi cadastrada (config/confaz.json). Sem ela não há como "
                "distribuir a massa por UF na planilha."
            )
        resultado[year] = {uf: [round(v, 6) for v in vals] for uf, vals in estados.items()}
    return resultado


def percentual_uf(regra, recuperacao, uf):
    """
    Percentual aplicado à UF (fração): o ajuste feito para a UF ou, sem ajuste,
    o maior entre a recuperação nacional contratada e a meta mínima da UF.
    """
    if uf in recuperacao["estados"]:
        return recuperacao["estados"][uf]
    return max(recuperacao["nacional"], regra["excecoes"].get(uf, regra["minimo"]) / 100)


def validar_proposta(payload, ctx, parametros):
    """Valida o payload completo do painel (cliente, proposta, comercial, volumes)."""
    declaracao = validar_declaracao(payload, ctx)

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
        "telefone_responsavel": _texto(proposta_raw.get("telefone_responsavel"), 40),
        "forma_pagamento": _texto(proposta_raw.get("forma_pagamento"), 300)
        or parametros["proposta"].get("forma_pagamento", ""),
        "observacoes": _texto(proposta_raw.get("observacoes"), 2000),
    }

    comercial_raw = payload.get("comercial") or {}
    precos_cfg = ctx["precos"]
    categorias = precos_cfg["categorias"]

    tabela = {uf: list(v) for uf, v in precos_cfg["tabela"].items()}
    editados = []
    for uf, valores in (comercial_raw.get("precos_uf") or {}).items():
        uf = str(uf).strip().upper()
        if uf not in ESTADOS or not isinstance(valores, list) or len(valores) != len(categorias):
            raise ValueError(f"Tabela de custos: dados inválidos para a UF {uf}.")
        for i, valor in enumerate(valores):
            if valor in (None, ""):
                continue
            preco = normalize_number(valor, f"Custo {uf}/{categorias[i].title()}")
            if abs(preco - tabela[uf][i]) > 1e-9:
                editados.append(f"{uf}/{categorias[i].title()}")
            tabela[uf][i] = preco

    # Preços dos planos até 5 t são fixos (config/precos_tonelada.json); ajuste só pelo desconto.
    planos = [dict(p) for p in precos_cfg["planos"]]

    dre = ctx["dre"]
    classe = _texto(comercial_raw.get("classe_mo"), 2).upper() or dre["classe_padrao"]
    if classe not in dre["mao_de_obra_por_t"]:
        raise ValueError(f"Classe de mão de obra inválida: {classe}.")
    modo_preco = comercial_raw.get("modo_preco") or "preco"
    if modo_preco not in ("preco", "margem"):
        raise ValueError(f"Modo de preço inválido: {modo_preco}.")
    bruto = comercial_raw.get("margem")
    margem = None if bruto in (None, "") else normalize_number(bruto, "Margem") / 100
    if margem is not None and margem >= 1:
        raise ValueError("Margem: o percentual precisa ser menor que 100%.")
    bruto = comercial_raw.get("preco_t")
    preco_t = None if bruto in (None, "") else normalize_number(bruto, "Preço por tonelada")

    categoria_material = list(precos_cfg["categoria_material"])
    outro_categoria = _texto(comercial_raw.get("outro_categoria"), 20).upper()
    if outro_categoria:
        if outro_categoria not in categorias:
            raise ValueError(f'Categoria inválida para "Outro material": {outro_categoria}.')
        categoria_material[-1] = outro_categoria

    # Desconto em % ou em R$: vale o último campo preenchido no painel.
    desconto_modo = comercial_raw.get("desconto_modo") or "pct"
    if desconto_modo not in ("pct", "valor"):
        raise ValueError(f"Modo de desconto inválido: {desconto_modo}.")
    desconto = normalize_number(comercial_raw.get("desconto_percentual"), "Desconto (%)")
    if desconto > 100:
        raise ValueError("Desconto: o percentual não pode passar de 100%.")
    desconto_valor = normalize_number(comercial_raw.get("desconto_valor"), "Desconto (R$)")

    nomes = list(MATERIAIS)
    outro_nome = _texto(comercial_raw.get("outro_material_nome"), 40)
    if outro_nome:
        nomes[-1] = outro_nome.upper()

    return {
        "cliente": cliente,
        "proposta": proposta,
        "declaracao": declaracao,
        "tabela_precos": tabela,
        "precos_editados": editados,
        "planos": planos,
        "faixa_cheia": precos_cfg["faixa_cheia"],
        "classe_mo": classe,
        "modo_preco": modo_preco,
        "margem": margem,
        "preco_t": preco_t,
        "categorias": categorias,
        "categoria_material": categoria_material,
        "vigencia_precos": precos_cfg["vigencia"],
        "desconto_modo": desconto_modo,
        "desconto": desconto / 100 if desconto_modo == "pct" else 0.0,
        "desconto_valor_fixo": desconto_valor if desconto_modo == "valor" else 0.0,
        "materiais": nomes,
    }


def gerar_numero(parametros, hoje=None):
    hoje = hoje or datetime.now()
    return f'{parametros["proposta"]["prefixo_numero"]}-{hoje:%Y%m%d-%H%M}'


def calcular(proposta, ctx):
    """Monta todos os números usados no PDF, no PPT e no registro de propostas."""
    declaracao, nomes = proposta["declaracao"], proposta["materiais"]
    tabela, categorias = proposta["tabela_precos"], proposta["categorias"]
    cat_idx = [categorias.index(c) for c in proposta["categoria_material"]]
    media = [sum(tabela[uf][j] for uf in ESTADOS) / len(ESTADOS) for j in range(len(categorias))]
    anos = sorted(set(declaracao["volumes"]) | set(declaracao["nacional"]), reverse=True)
    n = len(MATERIAIS)

    # 1) Massas por ano, UF e material; linhas de custo para a DRE.
    por_ano = []
    linhas_custo = []
    for year in anos:
        regra = ctx["regras"][year]
        rec = declaracao["recuperacao"][year]
        estados, distribuido = estados_do_ano(declaracao, ctx, year)

        declarado, compensar = [0.0] * n, [0.0] * n
        linhas_uf = []
        if distribuido:
            for uf in ESTADOS:
                if uf not in estados:
                    continue
                vals = estados[uf]
                pct = percentual_uf(regra, rec, uf)
                linha = {"uf": uf, "percentual": pct, "declarado": 0.0, "compensar": 0.0, "valor": 0.0}
                for i, v in enumerate(vals):
                    comp = v * pct
                    declarado[i] += v
                    compensar[i] += comp
                    linha["declarado"] += v
                    linha["compensar"] += comp
                    if comp:
                        linhas_custo.append((tabela[uf][cat_idx[i]], cat_idx[i], comp))
                linhas_uf.append(linha)
        else:
            # Nacional sem tabela CONFAZ: percentual geral e custo médio nacional da categoria.
            pct = max(rec["nacional"], regra["minimo"] / 100)
            declarado = list(declaracao["nacional"][year])
            compensar = [v * pct for v in declarado]
            linhas_custo += [(media[cat_idx[i]], cat_idx[i], c) for i, c in enumerate(compensar) if c]

        total_declarado, total_compensar = sum(declarado), sum(compensar)
        por_ano.append({
            "ano": year,
            "modo": "nacional" if year in declaracao["nacional"] else "estados",
            "distribuido": distribuido,
            "confaz_origem": ctx.get("confaz_origem", {}).get(year),
            "regra": regra,
            "recuperacao": rec["nacional"],
            "ajustes_uf": rec["estados"],
            "percentual_efetivo": total_compensar / total_declarado if total_declarado else 0,
            "declarado_mat": declarado,
            "compensar_mat": compensar,
            "estados": linhas_uf,
            "declarado": total_declarado,
            "compensar": total_compensar,
        })

    # 2) Preço sobre a massa total: plano até 5 t, DRE acima.
    total_t = sum(a["compensar"] for a in por_ano)
    dre_cfg = ctx["dre"]
    custos = custo_direto(linhas_custo, categorias, dre_cfg)
    plano = plano_para(total_t, proposta["planos"])
    if plano:
        regime = "plano"
        subtotal = valor_plano(total_t, plano, proposta["faixa_cheia"])
        preco_t = plano["preco_t"]
    else:
        regime = "dre"
        if proposta["modo_preco"] == "margem" and proposta["margem"] is not None:
            # Margem informada: recalcula o preço para a margem final (já com desconto).
            preco_t = preco_para_margem(custos, proposta["classe_mo"], dre_cfg, proposta["margem"],
                                        proposta["desconto"], proposta["desconto_valor_fixo"])
        else:
            preco_t = proposta["preco_t"] if proposta["preco_t"] is not None else dre_cfg["preco_referencia_t"]
        subtotal = total_t * preco_t
    fator = subtotal / total_t if total_t else 0.0   # R$ por tonelada efetivamente cobrado

    # 3) Rateio do valor por ano, material e UF (proporcional à massa a compensar).
    acumulado = [{"material": nomes[i], "categoria": proposta["categoria_material"][i],
                  "declarado": 0.0, "compensar": 0.0, "valor": 0.0} for i in range(n)]
    estados_total = {}
    for ano in por_ano:
        ano["materiais"] = []
        for i in range(n):
            dec, comp = ano["declarado_mat"][i], ano["compensar_mat"][i]
            if dec > 0:
                ano["materiais"].append({
                    "material": nomes[i], "categoria": proposta["categoria_material"][i],
                    "declarado": dec, "compensar": comp, "valor": comp * fator, "preco": fator,
                })
            acumulado[i]["declarado"] += dec
            acumulado[i]["compensar"] += comp
            acumulado[i]["valor"] += comp * fator
        for linha in ano["estados"]:
            linha["valor"] = linha["compensar"] * fator
            total_uf = estados_total.setdefault(
                linha["uf"], {"uf": linha["uf"], "declarado": 0.0, "compensar": 0.0, "valor": 0.0})
            for chave in ("declarado", "compensar", "valor"):
                total_uf[chave] += linha[chave]
        ano["valor"] = ano["compensar"] * fator
        del ano["declarado_mat"], ano["compensar_mat"]

    for m in acumulado:
        m["preco"] = fator if m["compensar"] else 0.0

    if proposta["desconto_modo"] == "valor":
        desconto_valor = min(proposta["desconto_valor_fixo"], subtotal)
        desconto_pct = desconto_valor / subtotal if subtotal else 0.0
    else:
        desconto_pct = proposta["desconto"]
        desconto_valor = subtotal * desconto_pct
    total = subtotal - desconto_valor

    return {
        "por_ano": por_ano,
        "por_material": [m for m in acumulado if m["declarado"] > 0],
        "por_estado": [estados_total[uf] for uf in ESTADOS if uf in estados_total],
        "anos": anos,
        "anos_estados": [a["ano"] for a in por_ano if a["modo"] == "estados"],
        "anos_nacional": [a["ano"] for a in por_ano if a["modo"] == "nacional"],
        "declarado": sum(m["declarado"] for m in acumulado),
        "compensar": total_t,
        "regime": regime,
        "plano": plano,
        "preco_t": preco_t,
        "preco_efetivo": fator,
        "modo_preco": proposta["modo_preco"],
        "subtotal": subtotal,
        "desconto_percentual": desconto_pct,
        "desconto_valor": desconto_valor,
        "total": total,
        "dre": dre_resultado(total, custos, proposta["classe_mo"], dre_cfg),
        "margem_alvo": dre_cfg["margem_alvo"],
        "precos_editados": proposta["precos_editados"],
    }


def juntar(itens):
    """["a", "b", "c"] -> "a, b e c"."""
    itens = [str(i) for i in itens]
    if len(itens) <= 1:
        return "".join(itens)
    return ", ".join(itens[:-1]) + " e " + itens[-1]


def texto_escopo(calc):
    """Ex.: "Compensação SP e MS ano base 2019, 2020 e 2021 e nacional ano base 2024 e 2025"."""
    partes = []
    if calc["anos_estados"]:
        ufs = sorted({e["uf"] for a in calc["por_ano"] if a["modo"] == "estados" for e in a["estados"]},
                     key=ESTADOS.index)
        partes.append(f'{juntar(ufs)} ano base {juntar(sorted(calc["anos_estados"]))}')
    if calc["anos_nacional"]:
        partes.append(f'nacional ano base {juntar(sorted(calc["anos_nacional"]))}')
    return "Compensação " + " e ".join(partes)


# ---------- formatação pt-BR ----------

def fmt_num(value, casas=2):
    text = f"{value:,.{casas}f}"
    return text.replace(",", "_").replace(".", ",").replace("_", ".")


def fmt_moeda(value):
    return f"R$ {fmt_num(value, 2)}"


def fmt_pct(value):
    texto = fmt_num(value * 100, 2)
    texto = re.sub(r",00$", "", texto)
    texto = re.sub(r"(,\d)0$", r"\1", texto)
    return f"{texto}%"


def fmt_data(value):
    return value.strftime("%d/%m/%Y")


def slug(texto, limite=40):
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^\w\s-]", "", texto).strip()
    texto = re.sub(r"[\s-]+", "_", texto)
    return texto[:limite] or "cliente"
