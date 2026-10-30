"""
Precificação da proposta.

- Massa a compensar total (soma de todos os anos) de até 5 t: plano fechado,
  com preço por tonelada da faixa (1 t R$ 950/t, 2 t R$ 900/t ...).
- Acima de 5 t: preço de venda por tonelada com a DRE (DRE_Exemplo.xlsx)
  mostrando custos, impostos e margem. O comercial informa o preço (padrão:
  preço de referência da planilha) e vê a margem, ou informa a margem e o
  preço é recalculado para atingi-la.
"""
import math


def plano_para(total_t, planos):
    """Menor faixa de plano que cobre a massa total, ou None acima da maior faixa."""
    if total_t <= 0:
        return None
    for plano in planos:
        if total_t <= plano["ate_t"] + 1e-9:
            return plano
    return None


def valor_plano(total_t, plano, faixa_cheia=True):
    toneladas = plano["ate_t"] if faixa_cheia else total_t
    return toneladas * plano["preco_t"]


def custo_direto(linhas, categorias, dre):
    """
    linhas: [(custo_por_t, indice_categoria, toneladas_a_compensar)].
    Reproduz a aba 'VOLUME A COMPENSAR' + 'CUSTO DIRETO' da DRE.
    """
    credito = rec = custodia = toneladas = 0.0
    for custo_t, j, t in linhas:
        credito += t * custo_t
        rec += t * dre["rec_pct"] * custo_t * dre["taxa_rec"]
        custodia += t * dre["coop_pct"] * dre["custodia_por_t"][categorias[j]]
        toneladas += t
    auditoria = toneladas * dre["auditoria_por_t"]
    return {
        "credito": credito, "rec": rec, "custodia": custodia, "auditoria": auditoria,
        "total": credito + rec + custodia + auditoria, "toneladas": toneladas,
    }


def dre_resultado(faturamento, custos, classe, dre):
    """Reproduz o bloco FATURAMENTO → Resultado Final da DRE."""
    toneladas = custos["toneladas"]
    cofins = faturamento * dre["cofins"]
    pis = faturamento * dre["pis"]
    receita_liquida = faturamento - cofins - pis
    lucro_bruto = receita_liquida - custos["total"]
    base = max(lucro_bruto, 0.0)
    ir = base * dre["ir"]
    ir_adicional = max(lucro_bruto - dre["ir_adicional_limite"], 0.0) * dre["ir_adicional"]
    csll = base * dre["csll"]
    lucro_liquido = lucro_bruto - ir - csll - (ir_adicional if dre["subtrair_ir_adicional"] else 0.0)
    equipe = toneladas * dre["mao_de_obra_por_t"][classe]
    comissao = faturamento * dre["comissao_pct"]
    resultado = lucro_liquido - equipe - dre["beneficios"] - comissao
    return {
        "faturamento": faturamento, "cofins": cofins, "pis": pis,
        "receita_liquida": receita_liquida, "custo_direto": custos["total"],
        "custos": custos, "lucro_bruto": lucro_bruto, "ir": ir, "ir_adicional": ir_adicional,
        "csll": csll, "lucro_liquido": lucro_liquido, "equipe": equipe,
        "beneficios": dre["beneficios"], "comissao": comissao, "resultado": resultado,
        "margem": resultado / faturamento if faturamento else 0.0, "classe": classe,
    }


def preco_para_margem(custos, classe, dre, margem, desconto=0.0):
    """Menor preço por tonelada (em centavos) cuja margem final, já com desconto, atinge a desejada."""
    toneladas = custos["toneladas"]
    if toneladas <= 0 or desconto >= 1:
        return 0.0

    def margem_em(preco):
        return dre_resultado(preco * toneladas * (1 - desconto), custos, classe, dre)["margem"]

    baixo, alto = 0.0, 1000.0
    while margem_em(alto) < margem and alto < 1e7:
        alto *= 2
    for _ in range(80):
        meio = (baixo + alto) / 2
        if margem_em(meio) < margem:
            baixo = meio
        else:
            alto = meio
    return math.ceil(round(alto * 100, 6)) / 100  # arredonda para cima no centavo
