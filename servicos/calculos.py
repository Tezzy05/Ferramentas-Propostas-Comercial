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
Valor             = massa a compensar × preço por tonelada (UF × categoria do material).
Ano-base com até 5 t a compensar usa o preço fechado do pacote (tabela do site).
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
        if year not in ctx["anos_planilha"]:
            raise ValueError(
                f"A planilha modelo não tem a guia {year}. Inclua a guia no modelo "
                "para gerar a autodeclaração deste ano-base."
            )
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


def preco_pacote(compensar, pacotes):
    """Pacote de menor faixa que cobre a massa a compensar, ou None acima da maior faixa."""
    if compensar <= 0:
        return None
    for pacote in pacotes:
        if compensar <= pacote["ate_t"] + 1e-9:
            return pacote
    return None


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
            raise ValueError(f"Tabela de preços: dados inválidos para a UF {uf}.")
        for i, valor in enumerate(valores):
            if valor in (None, ""):
                continue
            preco = normalize_number(valor, f"Preço {uf}/{categorias[i].title()}")
            if abs(preco - tabela[uf][i]) > 1e-9:
                editados.append(f"{uf}/{categorias[i].title()}")
            tabela[uf][i] = preco

    pacotes = [dict(p) for p in precos_cfg["pacotes"]]
    pacotes_raw = comercial_raw.get("pacotes") or []
    if pacotes_raw:
        if not isinstance(pacotes_raw, list) or len(pacotes_raw) != len(pacotes):
            raise ValueError(f"São esperados {len(pacotes)} preços de pacote.")
        for pacote, valor in zip(pacotes, pacotes_raw):
            if valor not in (None, ""):
                pacote["preco"] = normalize_number(valor, f'Pacote até {fmt_num(pacote["ate_t"], 0)} t')

    categoria_material = list(precos_cfg["categoria_material"])
    outro_categoria = _texto(comercial_raw.get("outro_categoria"), 20).upper()
    if outro_categoria:
        if outro_categoria not in categorias:
            raise ValueError(f'Categoria inválida para "Outro material": {outro_categoria}.')
        categoria_material[-1] = outro_categoria

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
        "declaracao": declaracao,
        "tabela_precos": tabela,
        "precos_editados": editados,
        "pacotes": pacotes,
        "categorias": categorias,
        "categoria_material": categoria_material,
        "vigencia_precos": precos_cfg["vigencia"],
        "desconto": desconto / 100,
        "materiais": nomes,
    }


def gerar_numero(parametros, hoje=None):
    hoje = hoje or datetime.now()
    return f'{parametros["proposta"]["prefixo_numero"]}-{hoje:%Y%m%d-%H%M}'


def calcular(proposta, ctx):
    """Monta todos os números usados no PDF, no PPT e no registro de propostas."""
    declaracao, nomes = proposta["declaracao"], proposta["materiais"]
    tabela, pacotes = proposta["tabela_precos"], proposta["pacotes"]
    cat_idx = [proposta["categorias"].index(c) for c in proposta["categoria_material"]]
    media = [sum(tabela[uf][j] for uf in ESTADOS) / len(ESTADOS) for j in range(len(proposta["categorias"]))]
    anos = sorted(set(declaracao["volumes"]) | set(declaracao["nacional"]), reverse=True)
    n = len(MATERIAIS)

    por_ano = []
    acumulado = [{"material": nomes[i], "categoria": proposta["categoria_material"][i],
                  "declarado": 0.0, "compensar": 0.0, "valor": 0.0} for i in range(n)]
    estados_total = {}

    for year in anos:
        regra = ctx["regras"][year]
        rec = declaracao["recuperacao"][year]
        estados, distribuido = estados_do_ano(declaracao, ctx, year)

        declarado, compensar, valor = [0.0] * n, [0.0] * n, [0.0] * n
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
                    val = comp * tabela[uf][cat_idx[i]]
                    declarado[i] += v
                    compensar[i] += comp
                    valor[i] += val
                    linha["declarado"] += v
                    linha["compensar"] += comp
                    linha["valor"] += val
                linhas_uf.append(linha)
        else:
            # Nacional sem tabela CONFAZ: percentual geral e preço médio nacional da categoria.
            pct = max(rec["nacional"], regra["minimo"] / 100)
            declarado = list(declaracao["nacional"][year])
            compensar = [v * pct for v in declarado]
            valor = [c * media[cat_idx[i]] for i, c in enumerate(compensar)]

        total_compensar = sum(compensar)
        valor_tabela = sum(valor)
        pacote = preco_pacote(total_compensar, pacotes)
        if pacote:
            # Até 5 t: preço fechado do pacote, rateado pela massa a compensar.
            fator = pacote["preco"] / total_compensar
            valor = [c * fator for c in compensar]
            for linha in linhas_uf:
                linha["valor"] = linha["compensar"] * fator

        for linha in linhas_uf:
            total_uf = estados_total.setdefault(
                linha["uf"], {"uf": linha["uf"], "declarado": 0.0, "compensar": 0.0, "valor": 0.0})
            for chave in ("declarado", "compensar", "valor"):
                total_uf[chave] += linha[chave]

        materiais = []
        for i in range(n):
            materiais.append({
                "material": nomes[i], "categoria": proposta["categoria_material"][i],
                "declarado": declarado[i], "compensar": compensar[i], "valor": valor[i],
                "preco": valor[i] / compensar[i] if compensar[i] else 0.0,
            })
            acumulado[i]["declarado"] += declarado[i]
            acumulado[i]["compensar"] += compensar[i]
            acumulado[i]["valor"] += valor[i]

        total_declarado = sum(declarado)
        por_ano.append({
            "ano": year,
            "modo": "nacional" if year in declaracao["nacional"] else "estados",
            "distribuido": distribuido,
            "confaz_origem": ctx.get("confaz_origem", {}).get(year),
            "regra": regra,
            "recuperacao": rec["nacional"],
            "ajustes_uf": rec["estados"],
            "percentual_efetivo": total_compensar / total_declarado if total_declarado else 0,
            "materiais": [m for m in materiais if m["declarado"] > 0],
            "estados": linhas_uf,
            "declarado": total_declarado,
            "compensar": total_compensar,
            "valor": sum(valor),
            "valor_tabela": valor_tabela,
            "pacote": pacote,
        })

    for m in acumulado:
        m["preco"] = m["valor"] / m["compensar"] if m["compensar"] else 0.0

    subtotal = sum(m["valor"] for m in acumulado)
    desconto_valor = subtotal * proposta["desconto"]

    return {
        "por_ano": por_ano,
        "por_material": [m for m in acumulado if m["declarado"] > 0],
        "por_estado": [estados_total[uf] for uf in ESTADOS if uf in estados_total],
        "anos": anos,
        "anos_estados": [a["ano"] for a in por_ano if a["modo"] == "estados"],
        "anos_nacional": [a["ano"] for a in por_ano if a["modo"] == "nacional"],
        "declarado": sum(m["declarado"] for m in acumulado),
        "compensar": sum(m["compensar"] for m in acumulado),
        "subtotal": subtotal,
        "desconto_percentual": proposta["desconto"],
        "desconto_valor": desconto_valor,
        "total": subtotal - desconto_valor,
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
