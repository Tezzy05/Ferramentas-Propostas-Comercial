"""
Prepara o PowerPoint oficial para ser o modelo da proposta comercial.

- converte de "Open XML Strict" para o formato padrão, se for o caso;
- reduz imagens muito grandes (lado maior até 2560 px; fotos sem transparência
  viram JPEG), o que deixa o arquivo leve sem perda visível na tela;
- grava em modelo/Proposta_Comercial.pptx.

Os textos de exemplo destacados (razão social, escopo, metas, forma de
pagamento, validade e contato) continuam no arquivo: o app os reconhece e
preenche sozinho ao gerar cada proposta.

Uso:  python scripts/preparar_modelo_ppt.py "C:\\caminho\\Apresentação.pptx"
"""
from io import BytesIO
from pathlib import Path
import posixpath
import re
import sys
import zipfile

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from servicos.ooxml_strict import converter, eh_strict  # noqa: E402

DESTINO = RAIZ / "modelo" / "Proposta_Comercial.pptx"
LIMITE_BYTES = 500_000      # só mexe em imagens acima de ~500 KB
LADO_MAXIMO = 2560          # px


def _otimizar_imagem(dados, nome):
    """Devolve (novo_nome, novos_bytes) ou None se não valer a pena mexer."""
    try:
        img = Image.open(BytesIO(dados))
        img.load()
    except Exception:
        return None
    if max(img.size) > LADO_MAXIMO:
        img.thumbnail((LADO_MAXIMO, LADO_MAXIMO), Image.LANCZOS)
    saida = BytesIO()
    tem_alfa = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    if not tem_alfa and nome.lower().endswith(".png"):
        img.convert("RGB").save(saida, "JPEG", quality=88, optimize=True, progressive=True)
        novo_nome = re.sub(r"\.png$", ".jpeg", nome, flags=re.I)
    else:
        formato = "PNG" if nome.lower().endswith(".png") else (img.format or "PNG")
        img.save(saida, formato, optimize=True)
        novo_nome = nome
    novos = saida.getvalue()
    return (novo_nome, novos) if len(novos) < len(dados) * 0.9 else None


def preparar(origem):
    dados = Path(origem).read_bytes()
    tamanho_original = len(dados)
    if eh_strict(dados):
        print("Formato Strict detectado: convertendo para o padrão.")
        dados = converter(dados)

    entrada = zipfile.ZipFile(BytesIO(dados))
    renomeados = {}      # caminho antigo -> novo (dentro do pacote)
    substituidos = {}    # caminho -> bytes
    for info in entrada.infolist():
        nome = info.filename
        if nome.startswith("ppt/media/") and info.file_size > LIMITE_BYTES:
            resultado = _otimizar_imagem(entrada.read(nome), nome)
            if resultado:
                novo_nome, novos = resultado
                substituidos[novo_nome] = novos
                if novo_nome != nome:
                    renomeados[nome] = novo_nome
                print(f"  {nome}: {info.file_size / 1e6:.1f} MB -> {len(novos) / 1e6:.1f} MB"
                      + (f" ({posixpath.basename(novo_nome)})" if novo_nome != nome else ""))

    saida = BytesIO()
    with zipfile.ZipFile(saida, "w", zipfile.ZIP_DEFLATED) as z:
        for info in entrada.infolist():
            nome = info.filename
            if nome in renomeados:
                continue
            if nome in substituidos:
                z.writestr(nome, substituidos[nome])
                continue
            conteudo = entrada.read(nome)
            if nome.endswith(".rels") and renomeados:
                texto = conteudo.decode("utf-8")
                for antigo, novo in renomeados.items():
                    texto = texto.replace(posixpath.basename(antigo) + '"', posixpath.basename(novo) + '"')
                conteudo = texto.encode("utf-8")
            if nome == "[Content_Types].xml" and renomeados:
                texto = conteudo.decode("utf-8")
                if 'Extension="jpeg"' not in texto:
                    texto = texto.replace("<Default ", '<Default Extension="jpeg" ContentType="image/jpeg"/><Default ', 1)
                conteudo = texto.encode("utf-8")
            z.writestr(nome, conteudo)
        for novo in renomeados.values():
            z.writestr(novo, substituidos[novo])

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_bytes(saida.getvalue())
    print(f"Modelo salvo em {DESTINO} ({tamanho_original / 1e6:.1f} MB -> {DESTINO.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    preparar(sys.argv[1])
