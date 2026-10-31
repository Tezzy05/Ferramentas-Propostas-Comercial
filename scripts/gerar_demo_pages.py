"""
Gera a versão de demonstração do painel em docs/ (GitHub Pages).

O GitHub Pages só serve arquivos estáticos, então a demo usa:
- a mesma tela e os mesmos cálculos do app (static/);
- static/js/demo.js no lugar do servidor: registro de propostas no navegador e
  arquivos de exemplo nos botões de planilha, PPT e PDF;
- arquivos de exemplo gerados aqui pelo próprio app (cenário do roteiro);
- um registro de exemplo com propostas fictícias em vários status.

Uso:  python scripts/gerar_demo_pages.py
Depois: GitHub > Settings > Pages > Branch "main", pasta "/docs".
"""
from datetime import date, timedelta
from pathlib import Path
import json
import shutil
import sys
import tempfile

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

import app as aplicacao  # noqa: E402
from servicos import calculos, registro  # noqa: E402
from servicos.regras import contexto  # noqa: E402

DOCS = RAIZ / "docs"
EXEMPLOS = DOCS / "exemplos"
ZEROS = [0] * 10


def proposta(numero, cliente, responsavel, data, anos=None, nacional=None, comercial=None,
             recuperacao=None, observacoes=""):
    emails = {"Kathleen Mulsa": "kathleen.mulsa@ambipar.com", "Thuíse Matsumura": "thuise.matsumura@ambipar.com"}
    return {
        "cliente": {"razao_social": cliente["nome"], "cnpj": cliente.get("cnpj", ""),
                    "contato": cliente.get("contato", ""), "email": cliente.get("email", ""),
                    "telefone": "", "cidade_uf": cliente.get("cidade_uf", "")},
        "proposta": {"numero": numero, "data": data.isoformat(), "validade_dias": "30",
                     "responsavel": responsavel, "email_responsavel": emails.get(responsavel, ""),
                     "telefone_responsavel": "", "forma_pagamento": "30 dias após o aceite desta proposta.",
                     "observacoes": observacoes},
        "comercial": {"precos_uf": {}, "classe_mo": "C", "modo_preco": "preco", "preco_t": "", "margem": "",
                      "desconto_modo": "pct", "desconto_percentual": "", "desconto_valor": "",
                      **(comercial or {})},
        "anos": anos or {},
        "nacional": nacional or {},
        "recuperacao": recuperacao or {},
    }


def material(**valores):
    ordem = ["papel", "plastico", "vidro", "aco", "aluminio", "longa_vida", "isopor", "bopp", "aerossol", "outro"]
    return [valores.get(k, 0) for k in ordem]


HOJE = date.today()

# Cenário do roteiro: é o que a demonstração mostra e o que os arquivos de exemplo trazem.
EXEMPLO = proposta(
    "AMB-EXEMPLO-001", {"nome": "Indústria Exemplo Ltda", "cnpj": "12.345.678/0001-90", "contato": "Maria Souza",
                        "cidade_uf": "São Paulo / SP"},
    "Kathleen Mulsa", HOJE,
    nacional={"2025": material(papel=100, plastico=50, vidro=10, aco=12, aluminio=3, longa_vida=8)},
    comercial={"modo_preco": "margem", "margem": "15"},
)

# Registro de exemplo (clientes fictícios) para mostrar a gestão do funil.
REGISTRO = [
    (proposta("AMB-DEMO-101", {"nome": "Bebidas Horizonte S.A.", "cnpj": "45.118.230/0001-07"}, "Kathleen Mulsa",
              HOJE - timedelta(days=24),
              nacional={"2025": material(papel=300, plastico=420, vidro=180, aco=90, aluminio=40, longa_vida=60)},
              comercial={"preco_t": "160"}),
     {"status": "Ganha", "negociado": 0.97, "venda": HOJE - timedelta(days=10)}),
    (proposta("AMB-DEMO-102", {"nome": "Cosméticos Aurora Ltda", "cnpj": "08.552.310/0001-44"}, "Thuíse Matsumura",
              HOJE - timedelta(days=12),
              nacional={"2025": material(papel=4, plastico=3, longa_vida=1)}),
     {"status": "Em negociação"}),
    (proposta("AMB-DEMO-103", {"nome": "Alimentos Vale Verde Ltda", "cnpj": "21.774.905/0001-63"}, "Kathleen Mulsa",
              HOJE - timedelta(days=30),
              anos={"2023": {"SP": material(papel=40, plastico=30, vidro=12), "MS": material(papel=10, plastico=5)}},
              nacional={"2024": material(papel=60, plastico=35, aco=8)}),
     {"status": "Perdida", "observacao": "Cliente optou por outra entidade gestora."}),
    (proposta("AMB-DEMO-104", {"nome": "Higiene Lar Distribuidora", "cnpj": "33.640.118/0001-90"}, "Thuíse Matsumura",
              HOJE - timedelta(days=5),
              nacional={"2024": material(papel=70, plastico=55), "2025": material(papel=80, plastico=60, vidro=15)},
              comercial={"desconto_percentual": "5"}),
     {"status": "Enviada"}),
    (proposta("AMB-DEMO-105", {"nome": "Pet Nutri Ltda", "cnpj": "17.209.442/0001-21"}, "Kathleen Mulsa",
              HOJE - timedelta(days=18),
              nacional={"2025": material(papel=2, plastico=1)}),
     {"status": "Ganha", "venda": HOJE - timedelta(days=8)}),
]


def baixar(cliente, rota, payload, destino):
    resposta = cliente.post(rota, json=payload)
    if resposta.status_code != 200:
        print(f"  ! {rota}: {resposta.get_json()}")
        return False
    destino.write_bytes(resposta.data)
    print(f"  {destino.relative_to(RAIZ)} ({len(resposta.data) / 1e6:.1f} MB)")
    return True


def main():
    pasta_dados = Path(tempfile.mkdtemp(prefix="demo-dados-"))
    registro.DADOS_DIR = pasta_dados
    registro.PROPOSTAS_DIR = pasta_dados / "propostas"
    registro.PLANILHA_PATH = pasta_dados / "registro_propostas.xlsx"
    cliente = aplicacao.app.test_client()

    if DOCS.exists():
        shutil.rmtree(DOCS)
    EXEMPLOS.mkdir(parents=True)
    shutil.copytree(RAIZ / "static", DOCS / "static")
    (DOCS / ".nojekyll").write_text("")

    print("Arquivos de exemplo:")
    exemplos = {
        "excel": "exemplos/Autodeclaracao_exemplo.xlsx",
        "ppt": "exemplos/Proposta_Comercial_exemplo.pptx",
        "pdf": "exemplos/Proposta_Comercial_exemplo.pdf",
        "relatorio": "exemplos/Registro_propostas_exemplo.xlsx",
    }
    baixar(cliente, "/gerar-excel", EXEMPLO, DOCS / exemplos["excel"])
    baixar(cliente, "/atualizar-proposta", EXEMPLO, DOCS / exemplos["ppt"])
    if not baixar(cliente, "/gerar-pdf", EXEMPLO, DOCS / exemplos["pdf"]):
        print("  (sem PowerPoint/LibreOffice: gere o PDF no app e salve em docs/" + exemplos["pdf"] + ")")
    # O exemplo do roteiro não fica no registro: ele entra quando a demo gerar a proposta.
    shutil.rmtree(registro.PROPOSTAS_DIR, ignore_errors=True)

    print("Registro de exemplo:")
    ctx = contexto()
    parametros = aplicacao.load_parametros()
    for payload, situacao in REGISTRO:
        prop = calculos.validar_proposta(payload, ctx, parametros)
        calc = calculos.calcular(prop, ctx)
        dados, _ = registro.salvar(payload, prop, calc)
        campos = {"status": situacao["status"], "observacao": situacao.get("observacao", "")}
        if "negociado" in situacao:
            campos["valor_negociado"] = round(calc["total"] * situacao["negociado"], 2)
        if "venda" in situacao:
            campos["data_venda"] = situacao["venda"].isoformat()
        registro.atualizar_registro(dados["numero"], campos)
        print(f'  {dados["numero"]} {payload["cliente"]["razao_social"]}: {situacao["status"]}')
    itens = []
    for d in registro._todas():
        d["resumo"] = {k: v for k, v in d["resumo"].items() if k != "detalhes"}
        itens.append(d)
    (DOCS / exemplos["relatorio"]).write_bytes(registro.gerar_relatorio().getvalue())

    html = cliente.get("/").data.decode("utf-8")
    html = html.replace('href="/static/', 'href="static/').replace('src="/static/', 'src="static/')
    html = html.replace("<title>Propostas Comerciais · Ambipar</title>",
                        "<title>Propostas Comerciais · Ambipar (demonstração)</title>")
    demo = json.dumps({"exemplos": exemplos, "registro": itens}, ensure_ascii=False).replace("</", "<\\/")
    ancora = '<script src="static/js/app.js'
    assert ancora in html, "não achei o script do app no HTML"
    html = html.replace(ancora, f'<script>window.DEMO = {demo};</script>\n'
                                f'<script src="static/js/demo.js"></script>\n{ancora}', 1)
    (DOCS / "index.html").write_text(html, encoding="utf-8")
    shutil.rmtree(pasta_dados, ignore_errors=True)
    print(f"Demo gerada em {DOCS}")


if __name__ == "__main__":
    main()
