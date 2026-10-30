"""
Regras de compensação por ano-base e tabela da Metodologia CONFAZ.

- config/regras_compensacao.json: percentual mínimo por ano e exceções por UF.
  Anos sem regra cadastrada usam a meta da célula L1 da planilha modelo.
- config/confaz.json: participação (%) de cada UF para distribuir a massa nacional.
- config/precos_tonelada.json: preço por tonelada por UF e categoria, e pacotes até 5 t.
"""
from pathlib import Path
import json

from .calculos import ESTADOS, MATERIAIS, fmt_pct
from .planilha import get_available_years, get_metas

BASE_DIR = Path(__file__).resolve().parent.parent
REGRAS_PATH = BASE_DIR / "config" / "regras_compensacao.json"
CONFAZ_PATH = BASE_DIR / "config" / "confaz.json"
PRECOS_PATH = BASE_DIR / "config" / "precos_tonelada.json"


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

    # A tabela de um ano só é validada no ano seguinte: anos sem tabela própria
    # posteriores à última tabela usam a mais recente (ex.: 2026 usa 2025).
    tabelas = {int(a): _tabela_confaz(t, a) for a, t in confaz_json.get("anos", {}).items() if t}
    confaz, confaz_origem = {}, {}
    ultimo = max(tabelas) if tabelas else None
    for ano in anos:
        if ano in tabelas:
            confaz[ano], confaz_origem[ano] = tabelas[ano], ano
        elif ultimo and ano > ultimo and confaz_json.get("anos_sem_tabela") == "ultima":
            confaz[ano], confaz_origem[ano] = tabelas[ultimo], ultimo

    anos_nacional = [a for a in regras_json.get("anos_nacional", []) if a in anos]

    return {
        "anos": anos,
        "anos_planilha": anos_planilha,
        "anos_nacional": sorted(anos_nacional),
        "regras": regras,
        "confaz": confaz,
        "confaz_origem": confaz_origem,
        "precos": _precos(),
    }


def _precos():
    cfg = _load(PRECOS_PATH)
    categorias = cfg["categorias"]
    tabela = {}
    for uf in ESTADOS:
        valores = cfg["precos"].get(uf)
        if not valores or len(valores) != len(categorias):
            raise ValueError(f"config/precos_tonelada.json: preços da UF {uf} incompletos.")
        tabela[uf] = [float(v) for v in valores]
    materiais = [cfg["materiais"].get(m) for m in MATERIAIS]
    if any(c not in categorias for c in materiais):
        raise ValueError("config/precos_tonelada.json: todo material precisa de uma categoria válida.")
    pacotes = sorted(({"ate_t": float(p["ate_t"]), "preco": float(p["preco"])} for p in cfg["pacotes"]),
                     key=lambda p: p["ate_t"])
    return {
        "vigencia": cfg.get("vigencia", ""),
        "categorias": categorias,
        "categoria_material": materiais,
        "tabela": tabela,
        "pacotes": pacotes,
    }

