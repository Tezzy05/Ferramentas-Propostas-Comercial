"""
Conversão da proposta em PowerPoint para PDF.

O PDF é a mesma apresentação gerada pelo botão "Atualizar proposta". A conversão
usa, nesta ordem:
1. o Microsoft PowerPoint instalado no computador (Windows), que mantém fontes e
   efeitos exatamente como na apresentação;
2. o LibreOffice, se estiver instalado (alternativa gratuita; pode trocar fontes
   que não estiverem instaladas, como a Neo Sans Std).
"""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile

PP_SAVE_AS_PDF = 32
CAMINHOS_LIBREOFFICE = [
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
]

MENSAGEM_SEM_CONVERSOR = (
    "Não foi possível gerar o PDF: é preciso ter o Microsoft PowerPoint (ou o LibreOffice) "
    "instalado neste computador. Enquanto isso, use \"Atualizar proposta\" e salve o PPT "
    "como PDF pelo PowerPoint."
)


def _com_powerpoint(origem, destino):
    """Exporta pelo PowerPoint via automação COM. Devolve False se não houver PowerPoint."""
    if sys.platform != "win32":
        return False
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        return False

    pythoncom.CoInitialize()
    app = None
    ja_estava_aberto = False
    try:
        try:
            app = win32com.client.DispatchEx("PowerPoint.Application")
        except Exception:
            return False
        # Se a vendedora já estiver com o PowerPoint aberto, não fecha o programa dela.
        ja_estava_aberto = bool(app.Visible) or app.Presentations.Count > 0
        # Open(arquivo, somente leitura, sem título, sem janela): msoTrue = -1, msoFalse = 0
        apresentacao = app.Presentations.Open(str(origem), -1, 0, 0)
        try:
            apresentacao.SaveAs(str(destino), PP_SAVE_AS_PDF)
        finally:
            apresentacao.Close()
        return destino.exists()
    finally:
        if app is not None and not ja_estava_aberto:
            try:
                app.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()


def _soffice():
    for nome in ("soffice", "soffice.exe", "libreoffice"):
        caminho = shutil.which(nome)
        if caminho:
            return caminho
    return next((c for c in CAMINHOS_LIBREOFFICE if os.path.exists(c)), None)


def _com_libreoffice(origem, destino):
    soffice = _soffice()
    if not soffice:
        return False
    perfil = Path(tempfile.mkdtemp(prefix="lo-perfil-"))
    try:
        subprocess.run(
            [soffice, f"-env:UserInstallation={perfil.as_uri()}", "--headless",
             "--convert-to", "pdf", "--outdir", str(destino.parent), str(origem)],
            check=True, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except (subprocess.SubprocessError, OSError):
        return False
    finally:
        shutil.rmtree(perfil, ignore_errors=True)
    convertido = destino.parent / (origem.stem + ".pdf")
    if convertido.exists() and convertido != destino:
        convertido.replace(destino)
    return destino.exists()


def pptx_para_pdf(conteudo_pptx):
    """Recebe os bytes do .pptx gerado e devolve os bytes do PDF."""
    with tempfile.TemporaryDirectory(prefix="proposta-") as pasta:
        pasta = Path(pasta)
        origem = pasta / "proposta.pptx"
        destino = pasta / "proposta_final.pdf"
        origem.write_bytes(conteudo_pptx)
        for conversor in (_com_powerpoint, _com_libreoffice):
            try:
                if conversor(origem, destino):
                    return destino.read_bytes()
            except Exception:
                continue
        raise RuntimeError(MENSAGEM_SEM_CONVERSOR)
