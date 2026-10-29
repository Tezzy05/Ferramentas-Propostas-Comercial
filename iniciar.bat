@echo off
chcp 65001 >nul
title Propostas Comerciais - AMBIPAR
cd /d "%~dp0"

echo ============================================================
echo   PROPOSTAS COMERCIAIS - AMBIPAR
echo ============================================================
echo.

REM Verifica se o Python esta instalado e acessivel no PATH
where python >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Python nao foi encontrado no seu computador.
    echo Instale o Python em https://www.python.org/downloads/
    echo e marque a opcao "Add Python to PATH" durante a instalacao.
    echo.
    pause
    exit /b 1
)

REM Verifica se as bibliotecas necessarias estao instaladas; instala se faltar
python -c "import flask, openpyxl, pptx, reportlab" >nul 2>nul
if errorlevel 1 (
    echo Instalando dependencias necessarias, aguarde...
    python -m pip install --quiet -r requirements.txt
)

echo Iniciando o sistema, o navegador vai abrir automaticamente...
echo Para encerrar, feche esta janela ou pressione CTRL+C.
echo.

REM app.py ja abre o navegador sozinho apos o servidor subir
python app.py

pause
