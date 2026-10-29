"""
Regras de compensação por ano-base e tabela da Metodologia CONFAZ.

- config/regras_compensacao.json: percentual mínimo por ano e exceções por UF.
  Anos sem regra cadastrada usam a meta da célula L1 da planilha modelo.
- config/confaz.json: participação (%) de cada UF para distribuir a massa nacional.
"""
from pathlib import Path
import json

from .calculos import ESTADOS, fmt_pct
from .planilha import get_available_years, get_metas

BASE_DIR = Path(__file__).resolve().parent.parent
REGRAS_PATH = BASE_DIR / "config" / "regras_compensacao.json"
CONFAZ_PATH = BASE_DIR / "config" / "confaz.json"


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _tabela_confaz(tabela, origem):
    if not tabela:
        return None
    if not isinstance(tabela, dict):
        raise ValueError(f"config/confaz.json: a tabela {origem} está em formato inválido.")
    valores = {}
    for uf, pct in tabela.items():
        uf = str(uf).strip().upper()
        if uf not in ESTADOS:
            raise ValueError(f'config/confaz.json: UF inválida "{uf}" na tabela {origem}.')
        valores[uf] = float(pct)
    soma = sum(valores.values())
    if abs(soma - 100) > 0.05:
        raise ValueError(
            f"config/confaz.json: a tabela {origem} soma {soma:.4f}% (precisa somar 100%)."
        )
    return valores


def _texto_padrao(minimo, excecoes):
    texto = f"{fmt_pct(minimo / 100)} para todos os estados"
    if excecoes:
        partes = [f"{uf} ({fmt_pct(pct / 100)})" for uf, pct in excecoes.items()]
        texto += ", exceto " + ", ".join(partes[:-1]) + (" e " if len(partes) > 1 else "") + partes[-1]
    return texto + "."


def contexto():
    """Tudo o que o cálculo precisa saber sobre anos, metas e distribuição CONFAZ."""
    regras_json = _load(REGRAS_PATH)
    confaz_json = _load(CONFAZ_PATH)
    anos_planilha = get_available_years()
    metas_planilha = get_metas()

    anos = sorted(set(anos_planilha) | {int(a) for a in regras_json.get("anos", {})}, reverse=True)

    regras = {}
    for ano in anos:
        r = regras_json.get("anos", {}).get(str(ano))
        if r:
            minimo = float(r["minimo"])
            excecoes = {str(uf).upper(): float(p) for uf, p in (r.get("excecoes") or {}).items()}
            origem = "regra"
        else:
            minimo = round(metas_planilha.get(ano, 0) * 100, 4)
            excecoes = {}
            origem = "planilha"
        regras[ano] = {
            "minimo": minimo,
            "excecoes": excecoes,
            "resumo": _texto_padrao(minimo, excecoes),
            "texto": (r or {}).get("texto") or "",
            "origem": origem,
        }

    padrao = _tabela_confaz(confaz_json.get("padrao"), "padrão")
    confaz = {}
    for ano in anos:
        tabela = _tabela_confaz(confaz_json.get("anos", {}).get(str(ano)), str(ano)) or padrao
        if tabela:
            confaz[ano] = tabela

    anos_nacional = [a for a in regras_json.get("anos_nacional", []) if a in anos]

    return {
        "anos": anos,
        "anos_planilha": anos_planilha,
        "anos_nacional": sorted(anos_nacional),
        "regras": regras,
        "confaz": confaz,
    }

