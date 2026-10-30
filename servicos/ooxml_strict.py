"""
Conversão de PowerPoint "Open XML Strict" para o formato padrão (Transitional).

O PowerPoint às vezes salva como Strict ("Apresentação Open XML Strict"), que
a biblioteca python-pptx não lê. As diferenças relevantes são:
- endereços de namespace e tipos de relacionamento (purl.oclc.org/ooxml/...);
- porcentagens escritas como "50%" em vez de 50000 (milésimos de por cento);
- o atributo conformance="strict" na apresentação.
O XML do PowerPoint é mantido; só esses pontos são reescritos.
"""
from io import BytesIO
import re
import zipfile

STRICT = "http://purl.oclc.org/ooxml/"

# Trocas específicas antes da regra geral (nomes que mudam além do prefixo).
TROCAS_FIXAS = [
    ("http://purl.oclc.org/ooxml/officeDocument/relationships/metadata/thumbnail",
     "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"),
    ("http://purl.oclc.org/ooxml/officeDocument/relationships/extendedProperties",
     "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties"),
    ("http://purl.oclc.org/ooxml/officeDocument/relationships/customProperties",
     "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties"),
    ("http://purl.oclc.org/ooxml/officeDocument/extendedProperties",
     "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"),
    ("http://purl.oclc.org/ooxml/officeDocument/customProperties",
     "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"),
]

# purl.oclc.org/ooxml/<área>/<resto>  ->  schemas.openxmlformats.org/<área>/2006/<resto>
REGRA_GERAL = re.compile(r"http://purl\.oclc\.org/ooxml/(drawingml|presentationml|officeDocument|spreadsheetml|wordprocessingml)/")

# Atributos com porcentagem: "50%" -> "50000"
PORCENTAGEM = re.compile(r'(\s[\w:]+)="(-?\d+(?:\.\d+)?)%"')


def eh_strict(conteudo):
    """True se os bytes do .pptx estiverem no formato Strict."""
    try:
        with zipfile.ZipFile(BytesIO(conteudo)) as z:
            return STRICT in z.read("_rels/.rels").decode("utf-8", "ignore")
    except (KeyError, zipfile.BadZipFile):
        return False


def _converter_xml(texto):
    for antigo, novo in TROCAS_FIXAS:
        texto = texto.replace(antigo, novo)
    texto = REGRA_GERAL.sub(lambda m: f"http://schemas.openxmlformats.org/{m.group(1)}/2006/", texto)
    texto = PORCENTAGEM.sub(lambda m: f'{m.group(1)}="{round(float(m.group(2)) * 1000)}"', texto)
    texto = texto.replace(' conformance="strict"', "")
    return texto


def converter(conteudo):
    """Recebe os bytes de um .pptx Strict e devolve os bytes no formato padrão."""
    entrada = zipfile.ZipFile(BytesIO(conteudo))
    saida = BytesIO()
    with zipfile.ZipFile(saida, "w", zipfile.ZIP_DEFLATED) as z:
        for info in entrada.infolist():
            dados = entrada.read(info.filename)
            if info.filename.endswith((".xml", ".rels")):
                dados = _converter_xml(dados.decode("utf-8")).encode("utf-8")
            z.writestr(info.filename, dados)
    return saida.getvalue()
