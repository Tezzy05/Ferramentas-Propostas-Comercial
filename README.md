# Autodeclaração de Massas - Ambipar

Formulário Flask para gerar o Excel exatamente a partir do modelo oficial.

## Regra do Excel

O arquivo `modelo/Declaracao_volume_embalagens.xlsx` é tratado como template intocável.

A aplicação:
1. abre o modelo;
2. mantém abas, layout e formatação;
3. preenche com `0` todas as células B5:K31 dos 27 estados em todas as abas;
4. substitui os zeros pelos valores informados;
5. envia a cópia final para download.

O modelo original nunca é sobrescrito.

## Estrutura

```text
autodeclaracao-volumes/
├── app.py
├── requirements.txt
├── .gitignore
├── README.md
├── modelo/
│   └── Declaracao_volume_embalagens.xlsx
└── templates/
    └── index.html
```

## Executar

```cmd
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Abra `http://127.0.0.1:5000`.
