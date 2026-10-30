from datetime import date
from pathlib import Path
import json
import os
import threading
import webbrowser

from flask import Flask, jsonify, render_template, request, send_file

from servicos.calculos import (
    ESTADOS, MATERIAIS, calcular, gerar_numero, slug, validar_declaracao, validar_proposta,
    volumes_para_planilha,
)
from servicos.planilha import MODEL_PATH, generate_excel, import_excel
from servicos.proposta_pdf import gerar_pdf
from servicos.proposta_ppt import PPT_MODEL_PATH, gerar_ppt, listar_marcadores, montar_valores
from servicos.regras import contexto
from servicos import registro

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
    ctx = contexto()
    proposta = validar_proposta(payload, ctx, parametros)
    return payload, proposta, calcular(proposta, ctx), parametros, ctx


def registrar(response, payload, proposta, calc):
    """Salva a proposta no registro ao gerar PDF/PPT; uma falha aqui não bloqueia o download."""
    try:
        _, aviso = registro.salvar(payload, proposta, calc)
        response.headers["X-Registro"] = "aviso" if aviso else "ok"
    except Exception:
        app.logger.exception("Erro ao salvar a proposta no registro.")
        response.headers["X-Registro"] = "erro"
    return response


def nome_arquivo(prefixo, proposta, extensao):
    return (f'{prefixo}_{slug(proposta["proposta"]["numero"], 30)}_'
            f'{slug(proposta["cliente"]["razao_social"])}.{extensao}')


@app.route("/")
def index():
    try:
        parametros = load_parametros()
        ctx = contexto()
        return render_template(
            "index.html",
            config={
                "anos": ctx["anos"],
                "anos_planilha": ctx["anos_planilha"],
                "anos_nacional": ctx["anos_nacional"],
                "regras": {str(a): r for a, r in ctx["regras"].items()},
                "confaz": {str(a): t for a, t in ctx["confaz"].items()},
                "materiais": MATERIAIS,
                "estados": ESTADOS,
                "confaz_origem": {str(a): o for a, o in ctx["confaz_origem"].items()},
                "precos": ctx["precos"],
                "dre": ctx["dre"],
                "forma_pagamento": parametros["proposta"].get("forma_pagamento", ""),
                "status": registro.STATUS,
                "validade_dias": parametros["proposta"]["validade_dias"],
                "numero_sugerido": gerar_numero(parametros),
                "hoje": date.today().isoformat(),
                "modelo_ppt": PPT_MODEL_PATH.exists(),
                "marcadores": listar_marcadores(ctx["anos"]),
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
        ctx = contexto()
        volumes = volumes_para_planilha(validar_declaracao(payload, ctx), ctx)
        metas = {ano: r["minimo"] / 100 for ano, r in ctx["regras"].items()}
        return send_file(generate_excel(volumes, metas), as_attachment=True,
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
        payload, proposta, calc, parametros, ctx = proposta_do_request()
        valores = montar_valores(proposta, calc, parametros, ctx)
        arquivo, pendentes = gerar_ppt(valores)
        response = send_file(arquivo, as_attachment=True, mimetype=MIME_PPTX,
                             download_name=nome_arquivo("Proposta_Comercial", proposta, "pptx"))
        if pendentes:
            response.headers["X-Marcadores-Pendentes"] = ",".join(pendentes)
        return registrar(response, payload, proposta, calc)
    except (ValueError, FileNotFoundError) as exc:
        return erro(str(exc))
    except Exception:
        app.logger.exception("Erro inesperado ao atualizar a proposta.")
        return erro("Ocorreu um erro inesperado ao atualizar a proposta.", 500)


@app.route("/gerar-pdf", methods=["POST"])
def gerar_pdf_route():
    try:
        payload, proposta, calc, parametros, _ = proposta_do_request()
        response = send_file(gerar_pdf(proposta, calc, parametros), as_attachment=True,
                             mimetype="application/pdf",
                             download_name=nome_arquivo("Proposta_Tecnica", proposta, "pdf"))
        return registrar(response, payload, proposta, calc)
    except ValueError as exc:
        return erro(str(exc))
    except Exception:
        app.logger.exception("Erro inesperado ao gerar o PDF.")
        return erro("Ocorreu um erro inesperado ao gerar o PDF.", 500)


# ---------- registro de propostas ----------

@app.route("/propostas", methods=["GET"])
def listar_propostas_route():
    return jsonify({"sucesso": True, "propostas": registro.listar()})


@app.route("/propostas", methods=["POST"])
def salvar_proposta_route():
    try:
        payload, proposta, calc, _, _ = proposta_do_request()
        dados, aviso = registro.salvar(payload, proposta, calc)
        return jsonify({"sucesso": True, "numero": dados["numero"], "aviso": aviso})
    except ValueError as exc:
        return erro(str(exc))
    except Exception:
        app.logger.exception("Erro inesperado ao salvar a proposta.")
        return erro("Ocorreu um erro inesperado ao salvar a proposta.", 500)


@app.route("/propostas/<path:numero>", methods=["GET"])
def obter_proposta_route(numero):
    try:
        return jsonify({"sucesso": True, "proposta": registro.obter(numero)})
    except FileNotFoundError as exc:
        return erro(str(exc), 404)


@app.route("/propostas/<path:numero>", methods=["PATCH"])
def atualizar_registro_route(numero):
    try:
        dados, aviso = registro.atualizar_registro(numero, request.get_json(silent=True) or {})
        return jsonify({"sucesso": True, "registro": dados["registro"], "aviso": aviso})
    except FileNotFoundError as exc:
        return erro(str(exc), 404)
    except ValueError as exc:
        return erro(str(exc))


@app.route("/propostas/<path:numero>", methods=["DELETE"])
def excluir_proposta_route(numero):
    try:
        aviso = registro.excluir(numero)
        return jsonify({"sucesso": True, "aviso": aviso})
    except FileNotFoundError as exc:
        return erro(str(exc), 404)


@app.route("/relatorio-propostas.xlsx")
def relatorio_route():
    nome = f"Registro_propostas_{date.today():%Y-%m-%d}.xlsx"
    return send_file(registro.gerar_relatorio(), as_attachment=True, download_name=nome,
                     mimetype=MIME_XLSX)


if __name__ == "__main__":
    url = "http://127.0.0.1:5000"
    print("=" * 60)
    print("PROPOSTAS COMERCIAIS - AMBIPAR")
    print("=" * 60)
    print(f"Modelo Excel: {MODEL_PATH}")
    print(f"Modelo PPT:   {PPT_MODEL_PATH}{'' if PPT_MODEL_PATH.exists() else '  (não encontrado)'}")
    print(f"Registro:     {registro.PLANILHA_PATH}")
    print(f"Acesse: {url}")
    print("Para encerrar: CTRL+C")
    print("=" * 60)

    # O modo debug reinicia o processo; abre o navegador só no processo principal.
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=5000, debug=True)
