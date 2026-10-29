# Propostas Comerciais - Ambipar

Painel para o comercial montar a proposta de compensação de logística reversa a
partir do que o cliente enviar. O comercial preenche cliente, volumes e preços
uma vez e gera três arquivos:

| Botão | Gera | Como |
|---|---|---|
| **Gerar planilha** | `Autodeclaracao_volume_embalagens_preenchida.xlsx` | Preenche o modelo oficial (B5:K31 de cada guia) |
| **Atualizar proposta** | `Proposta_Comercial_<nº>_<cliente>.pptx` | Troca os marcadores `{{...}}` do modelo PowerPoint |
| **Gerar PDF técnico** | `Proposta_Tecnica_<nº>_<cliente>.pdf` | Volumes, meta, massa a compensar e valores por ano, material e UF |

## Fluxo no painel

O preenchimento segue o mesmo processo do site [Selo Circular Pack](https://www.selocircularpack.com/como-escolher):
ano-base → por estados ou nacional → toneladas por material → percentual de recuperação.

1. **Cliente e proposta**: razão social (obrigatória), CNPJ, contato, nº, data, validade e responsável.
2. **Volumes declarados**: escolha o ano-base nas abas e o modo daquele ano:
   - **Por estados**: grade de 27 UFs × 10 materiais. Dá para colar direto do Excel (`Ctrl+V`),
     com um bloco de números a partir da célula selecionada ou com linhas que começam com a
     UF/nome do estado (`SP  10,5  3 ...`), e **Importar planilha** lê um `.xlsx` no layout do modelo.
   - **Nacional · Metodologia CONFAZ**: assistente em 3 etapas (ano-base → toneladas por
     material → confirmação). A massa nacional é distribuída entre as UFs pela tabela CONFAZ
     do ano (veja abaixo). Disponível para os anos de `anos_nacional`.
   Uma proposta pode misturar anos (ex.: SP e MS por estado em 2019–2023 e nacional em 2024–2025).
3. **Recuperação e preços**: recuperação contratada em cada ano (do mínimo legal até 100%),
   preço por tonelada de cada material, desconto e nome para "Outro material".

O resumo à direita recalcula na hora. O rascunho fica salvo no navegador
(localStorage); **Nova proposta** limpa tudo, menos responsável e preços.

### Cálculo

```
% aplicado na UF  = maior entre a recuperação contratada e a meta mínima da UF no ano
massa a compensar = massa declarada na UF × % aplicado
valor             = massa a compensar × preço por tonelada do material
total             = soma dos valores − desconto
```

Metas mínimas (`config/regras_compensacao.json`):

| Ano-base | Todas as UFs | Exceções |
|---|---|---|
| 2025 | 32% | SP 33%, MT 35%, MG 32,5% |
| 2026 | 33,10% | SP 34%, MT 40%, MG 35% |
| Demais | célula `L1` da guia do ano na planilha modelo (hoje 22%) | — |

### Metodologia CONFAZ

`config/confaz.json` guarda, por ano-base, a participação (%) de cada UF usada para distribuir
a massa nacional (os 27 valores somam 100). **A tabela ainda não foi cadastrada.** Enquanto não
houver tabela para o ano, a compensação nacional aplica o percentual geral sobre o total
nacional: o PDF e o PPT saem normalmente, mas a planilha por UF daquele ano não é gerada
(o painel avisa).

## Modelo PowerPoint (proposta comercial)

O botão **Atualizar proposta** abre `modelo/Proposta_Comercial.pptx`, troca os marcadores
e devolve uma cópia. O arquivo que está no repositório é **provisório**, criado por
`scripts/criar_modelo_ppt_exemplo.py` só para teste. Quando a proposta oficial estiver
pronta, salve-a com o mesmo nome e escreva os marcadores onde os dados devem entrar
(caixas de texto, formas, tabelas ou grupos). A formatação do texto é mantida.

Salve o modelo como **"Apresentação do PowerPoint (*.pptx)"**. O formato
"Apresentação Open XML Strict" não é suportado (o painel avisa se for o caso).

Marcadores disponíveis (a lista completa também aparece no painel, em
"Marcadores do modelo PowerPoint"):

| Marcador | Conteúdo |
|---|---|
| `{{CLIENTE}}`, `{{CNPJ}}`, `{{CONTATO}}`, `{{EMAIL_CLIENTE}}`, `{{TELEFONE}}`, `{{CIDADE_UF}}` | Dados do cliente |
| `{{NUMERO_PROPOSTA}}`, `{{DATA_PROPOSTA}}`, `{{VALIDADE}}`, `{{VALIDADE_DIAS}}` | Dados da proposta |
| `{{RESPONSAVEL}}`, `{{EMAIL_RESPONSAVEL}}`, `{{OBSERVACOES}}` | Comercial |
| `{{ESCOPO}}` | Ex.: "Compensação SP e MS ano base 2019 e 2020 e nacional ano base 2024 e 2025" |
| `{{TEXTO_METAS}}`, `{{RECUPERACAO}}` | Texto legal das metas dos anos da proposta e recuperação contratada |
| `{{ANOS}}`, `{{QTD_ANOS}}`, `{{ESTADOS}}`, `{{QTD_ESTADOS}}`, `{{MATERIAIS}}` | Escopo |
| `{{VOLUME_DECLARADO}}`, `{{VOLUME_COMPENSAR}}` | Massas totais (t) |
| `{{SUBTOTAL}}`, `{{DESCONTO_PERCENTUAL}}`, `{{DESCONTO}}`, `{{VALOR_TOTAL}}` | Valores (R$) |
| `{{META_2025}}`, `{{RECUPERACAO_2025}}`, `{{VOLUME_2025}}`, `{{COMPENSAR_2025}}`, `{{VALOR_2025}}` | Por ano (troque o ano) |
| `{{EMPRESA}}`, `{{CNPJ_EMPRESA}}` | Dados da Ambipar |

Se o modelo tiver um marcador desconhecido, ele fica como está e o painel avisa.

## Parâmetros

`config/parametros.json` guarda os dados da Ambipar, prefixo do número da proposta,
validade padrão, texto de condições do PDF e o **preço padrão por tonelada** de cada
material (hoje `0`; preencha com a tabela vigente para não digitar a cada proposta).

## Regra do Excel

O arquivo `modelo/Declaracao_volume_embalagens.xlsx` é tratado como template intocável:
a aplicação abre o modelo, zera B5:K31 dos 27 estados em todas as guias, grava os
valores informados e envia a cópia. O modelo original nunca é sobrescrito.

## Estrutura

```text
├── app.py                       # rotas Flask
├── servicos/
│   ├── calculos.py              # validação, cálculo e formatação pt-BR
│   ├── regras.py                # metas por ano/UF e tabela CONFAZ
│   ├── planilha.py              # gerar/importar a autodeclaração (.xlsx)
│   ├── proposta_ppt.py          # marcadores do PowerPoint
│   └── proposta_pdf.py          # PDF da proposta técnica
├── config/
│   ├── parametros.json          # empresa, validade, condições, preços padrão
│   ├── regras_compensacao.json  # metas mínimas por ano e UF, anos com modo nacional
│   └── confaz.json              # participação por UF (Metodologia CONFAZ)
├── modelo/
│   ├── Declaracao_volume_embalagens.xlsx
│   └── Proposta_Comercial.pptx  # provisório
├── templates/index.html
├── static/css/app.css
├── static/js/app.js
├── scripts/criar_modelo_ppt_exemplo.py
├── iniciar.bat
└── requirements.txt
```

## Executar

No Windows, dê dois cliques em `iniciar.bat` (instala as dependências se faltar e abre o navegador).

Ou manualmente:

```cmd
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Abra `http://127.0.0.1:5000`.
