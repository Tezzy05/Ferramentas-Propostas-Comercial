# Propostas Comerciais - Ambipar

Painel para o comercial montar a proposta de compensação de logística reversa a
partir do que o cliente enviar. O comercial preenche cliente, volumes e preços
uma vez, gera três arquivos e cada proposta fica guardada no **registro de propostas**:

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
     do ano (veja abaixo). Disponível em todos os anos-base (2018 a 2026).
   Uma proposta pode misturar anos (ex.: SP e MS por estado em 2019–2023 e nacional em 2024–2025).
3. **Recuperação e preços**:
   - recuperação **nacional** de cada ano (do mínimo legal até 100%): todos os estados seguem;
   - **Ajustar por estado**: muda UFs individualmente, cada uma limitada ao seu mínimo legal.
     Mudar o nacional depois refaz os ajustes (todos voltam a seguir o nacional);
   - **preço**: planos até 5 t ou DRE acima de 5 t (veja abaixo), com a tabela de **custo por
     tonelada por UF e categoria** (fixa, com "Ver / editar tabela" para mudar valores só naquela
     proposta);
   - desconto, nome e categoria do "Outro material".

O resumo à direita recalcula na hora. O rascunho fica salvo no navegador
(localStorage); **Nova proposta** limpa o painel, mantendo o responsável.

### Cálculo

```
% aplicado na UF  = ajuste da UF, se houver; senão o maior entre a recuperação nacional
                    contratada e a meta mínima da UF no ano
massa a compensar = massa declarada na UF × % aplicado
total             = valor pelo preço (abaixo) − desconto
```

**Preço**, sempre sobre a massa a compensar **total da proposta** (soma de todos os anos):

| Massa total | Regra |
|---|---|
| até 1 t | massa × R$ 950/t |
| até 2 t | massa × R$ 900/t |
| até 3 t | massa × R$ 800/t |
| até 4 t | massa × R$ 750/t (ex.: 3,9 t × 750 = R$ 2.925) |
| até 5 t | massa × R$ 740/t |
| acima de 5 t | massa × preço de venda por tonelada, conferido pela **DRE** |

Os preços dos planos são editáveis em cada proposta (`cobrar_faixa_cheia: true` em
`config/precos_tonelada.json` passaria a cobrar a faixa inteira). O valor é rateado entre anos,
materiais e UFs pela massa.

**DRE** (`config/dre.json`, fonte `DRE_Exemplo.xlsx`): custo direto por UF × categoria (crédito
= massa × custo da tabela; rec+ = 45% × custo × 20%; custódia = 55% × R$ 1,32/t, vidro
R$ 1,50/t; auditoria R$ 1,30/t), PIS 1,65% e COFINS 7,6% sobre o faturamento, IR 15% e CSLL 9%
sobre o lucro bruto, mão de obra classe A/B/C (R$ 11,43 / 7,43 / 5,00 por t) e comissão de 1%.
Preço e margem andam juntos: o contrato abre no **preço de referência** da planilha
(R$ 130/t) e a DRE já mostra a **margem do contrato**; se o comercial digitar um preço, a
margem é recalculada; se digitar uma **margem**, o preço por tonelada e o valor do contrato são
recalculados para chegar nela (já considerando o desconto). Os **cenários** 10%, 15%, 20% e 25%
mostram preço e total de cada margem e aplicam com um clique. 15% é a referência visual. O IR adicional é calculado mas não descontado, como na
planilha (`subtrair_ir_adicional`). A DRE é interna: não sai no PDF nem no PPT do cliente.

Categorias de custo (`config/precos_tonelada.json`): Papel/Papelão e Longa Vida → **Papel**;
Plástico, Isopor e BOPP → **Plástico**; Vidro → **Vidro**; Aço/Ferro, Alumínio e Aerossol →
**Metal**; "Outro material" → escolhida no painel (padrão Plástico).

Metas mínimas (`config/regras_compensacao.json`):

| Ano-base | Todas as UFs | Exceções |
|---|---|---|
| 2021 | 22% | — |
| 2024 | 30% | — |
| 2025 | 32% | SP 33%, MT 35%, MG 32,5% |
| 2026 | 33,10% | SP 34%, MT 40%, MG 35% |
| Demais | célula `L1` da guia do ano na planilha modelo (hoje 22%); sem guia, `minimo_padrao` (22%) | — |

A planilha `Regras_CONFAZ_2018_a_2025.xlsx` (time técnico) prevalece sobre as demais fontes.

### Metodologia CONFAZ

`config/confaz.json` guarda, por ano-base, a participação (%) de cada UF na arrecadação de
ICMS (planilha `Regras_CONFAZ_2018_a_2025.xlsx`, aba "Comparativo %"), usada para distribuir a
massa nacional entre os estados. Tabelas de 2018 a 2025 cadastradas. A tabela de um ano só é
validada no ano seguinte: anos posteriores à última tabela (hoje **2026**) usam a mais recente
(2025), e o painel e o PDF avisam. Para incluir um ano novo, acrescente a tabela em `anos`.

## Modelo PowerPoint (proposta comercial)

O botão **Atualizar proposta** abre `modelo/Proposta_Comercial.pptx`, troca os marcadores
e devolve uma cópia. O arquivo que está no repositório é **provisório**, criado por
`scripts/criar_modelo_ppt_exemplo.py` só para teste.

**O PPT oficial pode ser colocado do jeito que está** (salvo com o nome acima): os textos de
exemplo destacados em amarelo são reconhecidos e preenchidos automaticamente, sem precisar
editar marcadores:

| Texto no PPT oficial | Vira |
|---|---|
| INSERIR RAZÃO SOCIAL | razão social do cliente |
| Compensação SP e MS ano base … e nacional ano base … | escopo da proposta (`{{ESCOPO}}`) |
| A meta mínima para a comprovação … | texto legal do ano mais recente + resumo dos demais |
| 30 dias após o aceite desta proposta. | forma de pagamento do painel |
| válida por 30 (trinta) dias | validade da proposta por extenso |
| e-mail e telefone do slide "Obrigado" | contato do responsável comercial |

O destaque amarelo é removido e textos que crescem (ex.: metas de vários anos) têm a fonte
reduzida para caber. Também dá para usar marcadores `{{...}}` em qualquer lugar.

Salve o modelo como **"Apresentação do PowerPoint (*.pptx)"**. O formato
"Apresentação Open XML Strict" não é suportado (o painel avisa se for o caso).

Marcadores disponíveis (a lista completa também aparece no painel, em
"Marcadores do modelo PowerPoint"):

| Marcador | Conteúdo |
|---|---|
| `{{CLIENTE}}`, `{{CNPJ}}`, `{{CONTATO}}`, `{{EMAIL_CLIENTE}}`, `{{TELEFONE}}`, `{{CIDADE_UF}}` | Dados do cliente |
| `{{NUMERO_PROPOSTA}}`, `{{DATA_PROPOSTA}}`, `{{VALIDADE}}`, `{{VALIDADE_DIAS}}` | Dados da proposta |
| `{{RESPONSAVEL}}`, `{{EMAIL_RESPONSAVEL}}`, `{{TELEFONE_RESPONSAVEL}}`, `{{OBSERVACOES}}` | Comercial |
| `{{FORMA_PAGAMENTO}}`, `{{VALIDADE_EXTENSO}}`, `{{PRECO_TONELADA}}`, `{{PLANO}}` | Condições e preço |
| `{{ESCOPO}}` | Ex.: "Compensação SP e MS ano base 2019 e 2020 e nacional ano base 2024 e 2025" |
| `{{TEXTO_METAS}}`, `{{RECUPERACAO}}` | Texto legal das metas dos anos da proposta e recuperação contratada |
| `{{ANOS}}`, `{{QTD_ANOS}}`, `{{ESTADOS}}`, `{{QTD_ESTADOS}}`, `{{MATERIAIS}}` | Escopo |
| `{{VOLUME_DECLARADO}}`, `{{VOLUME_COMPENSAR}}` | Massas totais (t) |
| `{{SUBTOTAL}}`, `{{DESCONTO_PERCENTUAL}}`, `{{DESCONTO}}`, `{{VALOR_TOTAL}}` | Valores (R$) |
| `{{META_2025}}`, `{{RECUPERACAO_2025}}`, `{{VOLUME_2025}}`, `{{COMPENSAR_2025}}`, `{{VALOR_2025}}` | Por ano (troque o ano) |
| `{{EMPRESA}}`, `{{CNPJ_EMPRESA}}` | Dados da Ambipar |

Se o modelo tiver um marcador desconhecido, ele fica como está e o painel avisa.

## Registro de propostas

Toda vez que o PDF ou o PPT é gerado (ou em **Salvar no registro**), a proposta é gravada em
`dados/propostas/<nº>.json` e a planilha **`dados/registro_propostas.xlsx`** é atualizada com:

- **Propostas**: cliente, CNPJ, contato, responsável, anos, massas, regra de preço (plano ou
  DRE), preço por t, classe de mão de obra, custo direto, resultado e margem da DRE, valor
  calculado, desconto, valor da proposta, valor negociado, status, data da venda e observação;
- **Detalhe por ano e material**: massa e valor por ano-base, material e regra de preço;
- **Resumo**: quantidade, massa e valor por status.

No botão **Propostas** (topo do painel) a vendedora busca, filtra por status, atualiza status,
valor negociado e data da venda, reabre uma proposta no painel ou baixa o relatório em Excel.
Se a planilha estiver aberta no Excel, a proposta é salva mesmo assim e a planilha é atualizada
no próximo salvamento. A pasta `dados/` fica só no computador (não vai para o Git); faça backup dela.

## Parâmetros

- `config/parametros.json`: dados da Ambipar, prefixo do número da proposta, validade padrão,
  forma de pagamento padrão, contato padrão do último slide e texto de condições do PDF.
- `config/precos_tonelada.json`: custo por tonelada por UF e categoria (vigência abril/2026),
  categoria de cada material e planos até 5 t.
- `config/dre.json`: impostos, custos, mão de obra, comissão e margem-alvo da DRE.

## Regra do Excel

O arquivo `modelo/Declaracao_volume_embalagens.xlsx` é tratado como template intocável:
a aplicação abre o modelo, zera B5:K31 dos 27 estados em todas as guias, grava os
valores informados e envia a cópia. O modelo original nunca é sobrescrito. Ano-base sem
guia no modelo (ex.: 2018, 2026) ganha, só na cópia, uma guia igual à do ano mais recente, e
a meta de cada guia (L1) segue a regra do ano (planilha de regras CONFAZ/MMA).

## Estrutura

```text
├── app.py                       # rotas Flask
├── servicos/
│   ├── calculos.py              # validação, cálculo e formatação pt-BR
│   ├── precificacao.py          # planos até 5 t e DRE
│   ├── regras.py                # metas por ano/UF e tabela CONFAZ
│   ├── planilha.py              # gerar/importar a autodeclaração (.xlsx)
│   ├── proposta_ppt.py          # marcadores do PowerPoint
│   ├── proposta_pdf.py          # PDF da proposta técnica
│   └── registro.py              # registro de propostas (JSON + planilha Excel)
├── config/
│   ├── parametros.json          # empresa, validade, condições
│   ├── precos_tonelada.json     # custo por UF × categoria e planos até 5 t
│   ├── dre.json                 # parâmetros da DRE (acima de 5 t)
│   ├── regras_compensacao.json  # metas mínimas por ano e UF, anos com modo nacional
│   └── confaz.json              # participação por UF (Metodologia CONFAZ 2018–2025)
├── dados/                       # criado no uso: registro de propostas (fora do Git)
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
