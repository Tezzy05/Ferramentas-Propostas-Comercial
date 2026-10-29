from datetime import date
from pathlib import Path
import json
import os
import threading
import webbrowser

from flask import Flask, jsonify, render_template, request, send_file

from servicos.calculos import ESTADOS, MATERIAIS, calcular, gerar_numero, slug, validar_proposta, validar_volumes
from servicos.planilha import MODEL_PATH, generate_excel, get_available_years, get_metas, import_excel
from servicos.proposta_pdf import gerar_pdf
from servicos.proposta_ppt import PPT_MODEL_PATH, gerar_ppt, listar_marcadores, montar_valores

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
PARAMETROS_PATH = BASE_DIR / "config" / "parametros.json"
EXCEL_FILENAME = "Autodeclaracao_volume_embalagens_preenchida.xlsx"
MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def load_parametros():
    with open(PARAMETROS_PATH, encoding="utf-8") as f:
        return json.load(f)


def erro(mensagem, status=400):
    return jsonify({"sucesso": False, "erro": mensagem}), status


def proposta_do_request():
    payload = request.get_json(silent=True)
    if payload is None:
        raise ValueError("Nenhum dado foi recebido.")
    parametros = load_parametros()
    proposta = validar_proposta(payload, get_available_years(), get_metas(), parametros)
    return proposta, calcular(proposta), parametros


def nome_arquivo(prefixo, proposta, extensao):
    return (f'{prefixo}_{slug(proposta["proposta"]["numero"], 30)}_'
            f'{slug(proposta["cliente"]["razao_social"])}.{extensao}')


@app.route("/")
def index():
    try:
        parametros = load_parametros()
        anos = get_available_years()
        metas = get_metas()
        return render_template(
            "index.html",
            config={
                "anos": anos,
                "metas": {str(a): round(metas.get(a, 0) * 100, 4) for a in anos},
                "materiais": MATERIAIS,
                "estados": ESTADOS,
                "precos": [parametros["precos_por_tonelada"].get(m, 0) for m in MATERIAIS],
                "validade_dias": parametros["proposta"]["validade_dias"],
                "numero_sugerido": gerar_numero(parametros),
                "hoje": date.today().isoformat(),
                "modelo_ppt": PPT_MODEL_PATH.exists(),
                "marcadores": listar_marcadores(anos),
            },
            empresa=parametros["empresa"],
        )
    except Exception as exc:
        app.logger.exception("Erro ao carregar o painel.")
        return f"<h1>Erro ao carregar o painel</h1><p>{exc}</p>", 500


@app.route("/gerar-excel", methods=["POST"])
def gerar_excel_route():
    try:
        payload = request.get_json(silent=True) or {}
        volumes = validar_volumes(payload.get("anos"), get_available_years())
        return send_file(generate_excel(volumes), as_attachment=True,
                         download_name=EXCEL_FILENAME, mimetype=MIME_XLSX)
    except (ValueError, FileNotFoundError) as exc:
        return erro(str(exc))
    except Exception:
        app.logger.exception("Erro inesperado ao gerar Excel.")
        return erro("Ocorreu um erro inesperado ao gerar o Excel.", 500)


@app.route("/importar-excel", methods=["POST"])
def importar_excel_route():
    arquivo = request.files.get("arquivo")
    if not arquivo or not arquivo.filename.lower().endswith(".xlsx"):
        return erro("Envie um arquivo .xlsx.")
    try:
        return jsonify({"sucesso": True, "anos": import_excel(arquivo.stream)})
    except ValueError as exc:
        return erro(str(exc))
    except Exception:
        app.logger.exception("Erro inesperado ao importar Excel.")
        return erro("Ocorreu um erro inesperado ao ler a planilha.", 500)


@app.route("/atualizar-proposta", methods=["POST"])
def atualizar_proposta_route():
    try:
        proposta, calc, parametros = proposta_do_request()
        valores = montar_valores(proposta, calc, parametros, get_available_years())
        arquivo, pendentes = gerar_ppt(valores)
        response = send_file(arquivo, as_attachment=True, mimetype=MIME_PPTX,
                             download_name=nome_arquivo("Proposta_Comercial", proposta, "pptx"))
        if pendentes:
            response.headers["X-Marcadores-Pendentes"] = ",".join(pendentes)
        return response
    except (ValueError, FileNotFoundError) as exc:
        return erro(str(exc))
    except Exception:
        app.logger.exception("Erro inesperado ao atualizar a proposta.")
        return erro("Ocorreu um erro inesperado ao atualizar a proposta.", 500)


@app.route("/gerar-pdf", methods=["POST"])
def gerar_pdf_route():
    try:
        proposta, calc, parametros = proposta_do_request()
        return send_file(gerar_pdf(proposta, calc, parametros), as_attachment=True,
                         mimetype="application/pdf",
                         download_name=nome_arquivo("Proposta_Tecnica", proposta, "pdf"))
    except ValueError as exc:
        return erro(str(exc))
    except Exception:
        app.logger.exception("Erro inesperado ao gerar o PDF.")
        return erro("Ocorreu um erro inesperado ao gerar o PDF.", 500)


if __name__ == "__main__":
    url = "http://127.0.0.1:5000"
    print("=" * 60)
    print("PROPOSTAS COMERCIAIS - AMBIPAR")
    print("=" * 60)
    print(f"Modelo Excel: {MODEL_PATH}")
    print(f"Modelo PPT:   {PPT_MODEL_PATH}{'' if PPT_MODEL_PATH.exists() else '  (não encontrado)'}")
    print(f"Acesse: {url}")
    print("Para encerrar: CTRL+C")
    print("=" * 60)

    # O modo debug reinicia o processo; abre o navegador só no processo principal.
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=5000, debug=True)
