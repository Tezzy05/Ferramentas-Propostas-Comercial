(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const MATERIAIS = CFG.materiais;
  const ESTADOS = CFG.estados;
  const NM = MATERIAIS.length;
  const ANOS = CFG.anos.map(String);
  const ANOS_NACIONAL = CFG.anos_nacional.map(String);
  const STORAGE_KEY = "ambipar-propostas-rascunho-v1";
  const PREFIXO = String(CFG.numero_sugerido).split("-")[0];
  const CAT = CFG.precos.categorias;
  const PLANOS = CFG.precos.planos;
  const DRE = CFG.dre;
  const CLASSES = Object.keys(DRE.mao_de_obra_por_t);

  const NOMES_UF = {
    "acre": "AC", "alagoas": "AL", "amazonas": "AM", "amapa": "AP", "bahia": "BA", "ceara": "CE",
    "distrito federal": "DF", "espirito santo": "ES", "goias": "GO", "maranhao": "MA",
    "minas gerais": "MG", "mato grosso do sul": "MS", "mato grosso": "MT", "para": "PA",
    "paraiba": "PB", "pernambuco": "PE", "piaui": "PI", "parana": "PR", "rio de janeiro": "RJ",
    "rio grande do norte": "RN", "rondonia": "RO", "roraima": "RR", "rio grande do sul": "RS",
    "santa catarina": "SC", "sergipe": "SE", "sao paulo": "SP", "tocantins": "TO",
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const hasAnime = () => typeof window.anime === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- números pt-BR ----------
  function num(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return value;
    let text = String(value).trim().replace(/\s|R\$|%/g, "");
    if (!text || text === "-") return 0;
    if (text.includes(",") && text.includes(".")) text = text.replace(/\./g, "").replace(",", ".");
    else if (text.includes(",")) text = text.replace(",", ".");
    const n = Number(text);
    return Number.isFinite(n) ? n : NaN;
  }
  const fmt = (v, max = 2, min = max) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
  const ton = (v) => `${fmt(v, 3, 0)} t`;
  const money = (v) => `R$ ${fmt(v, 2)}`;
  const pct = (v) => `${fmt(v, 2, 0)}%`;
  const cellText = (v) => (v ? fmt(v, 3, 0) : "");
  const soma = (arr) => arr.reduce((a, b) => a + b, 0);
  const normaliza = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const titulo = (t) => t.toLowerCase().replace(/(^|[\s/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

  // ---------- regras do ano ----------
  const regra = (y) => CFG.regras[y];
  const minimo = (y) => regra(y).minimo;
  const metaUF = (y, uf) => regra(y).excecoes[uf] ?? regra(y).minimo;
  const temConfaz = (y) => !!CFG.confaz[y];

  function textoRegra(y) {
    const r = regra(y);
    const exc = Object.entries(r.excecoes).map(([uf, p]) => `${uf} (${pct(p)})`);
    let t = `<b>${pct(r.minimo)}</b> para todos os estados`;
    if (exc.length) t += `, exceto ${exc.slice(0, -1).join(", ")}${exc.length > 1 ? " e " : ""}${exc.at(-1)}`;
    return t + ".";
  }

  // ---------- estado ----------
  function novoNumero() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${PREFIXO}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function hojeISO() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function estadoInicial(base) {
    return {
      cliente: { razao_social: "", cnpj: "", contato: "", email: "", telefone: "", cidade_uf: "" },
      proposta: {
        numero: base ? novoNumero() : CFG.numero_sugerido,
        data: base ? hojeISO() : CFG.hoje,
        validade_dias: String(CFG.validade_dias),
        responsavel: base?.proposta.responsavel || "",
        email_responsavel: base?.proposta.email_responsavel || "",
        telefone_responsavel: base?.proposta.telefone_responsavel || "",
        forma_pagamento: CFG.forma_pagamento,
        observacoes: "",
      },
      comercial: {
        precos_uf: {},                       // {UF: [papel, plástico, vidro, metal]} só o que foi editado
        classe_mo: DRE.classe_padrao,
        modo_preco: "preco",                 // "preco": comercial define o preço; "margem": define a margem
        preco_t: "",                         // preço de venda acima de 5 t ("" = referência)
        margem: "",                          // margem final desejada, em %
        desconto_modo: "pct",                // "pct" ou "valor": o último campo de desconto preenchido
        desconto_percentual: "",
        desconto_valor: "",
        outro_material_nome: "",
        outro_categoria: "",
      },
      anos: {},        // modo "estados": {ano: {UF: [10]}}
      nacional: {},    // modo "nacional": {ano: [10]}
      modo: {},        // {ano: "estados" | "nacional"}
      recuperacao: {}, // {ano: {nacional: "40", estados: {SP: "45"}}} em %
      anoAtivo: ANOS[0],
    };
  }

  const vetor = (vals) => (Array.isArray(vals) && vals.length === NM
    ? vals.map((v) => (Number.isFinite(+v) && +v > 0 ? +v : 0)) : null);

  // Converte o que veio do localStorage ou do registro para o estado do painel.
  function normalizarEstado(salvo) {
    const padrao = estadoInicial();
    const s = {
      ...padrao,
      cliente: { ...padrao.cliente, ...salvo.cliente },
      proposta: { ...padrao.proposta, ...salvo.proposta },
      comercial: { ...padrao.comercial, ...salvo.comercial },
      anoAtivo: ANOS.includes(salvo.anoAtivo) ? salvo.anoAtivo : padrao.anoAtivo,
    };
    delete s.comercial.metas;
    delete s.comercial.precos;
    if (!s.comercial.precos_uf || typeof s.comercial.precos_uf !== "object") s.comercial.precos_uf = {};
    for (const [uf, vals] of Object.entries(s.comercial.precos_uf)) {
      if (!ESTADOS.includes(uf) || !Array.isArray(vals) || vals.length !== CAT.length) delete s.comercial.precos_uf[uf];
      else s.comercial.precos_uf[uf] = vals.map((v) => (v === null || v === undefined ? "" : String(v)));
    }
    delete s.comercial.pacotes;
    delete s.comercial.planos;  // planos até 5 t agora têm preço fixo
    if (!CLASSES.includes(s.comercial.classe_mo)) s.comercial.classe_mo = DRE.classe_padrao;
    delete s.comercial.margem_alvo;
    ["preco_t", "margem"].forEach((k) => { s.comercial[k] = s.comercial[k] === null || s.comercial[k] === undefined ? padrao.comercial[k] : String(s.comercial[k]); });
    if (!["preco", "margem"].includes(s.comercial.modo_preco)) s.comercial.modo_preco = "preco";
    if (!s.proposta.forma_pagamento) s.proposta.forma_pagamento = CFG.forma_pagamento;
    // Nome e categoria do "Outro material" saíram da tela: volta ao padrão.
    s.comercial.outro_material_nome = "";
    s.comercial.outro_categoria = "";
    if (!["pct", "valor"].includes(s.comercial.desconto_modo)) s.comercial.desconto_modo = "pct";
    s.comercial.desconto_valor = s.comercial.desconto_valor === null || s.comercial.desconto_valor === undefined ? "" : String(s.comercial.desconto_valor);
    for (const [y, ufs] of Object.entries(salvo.anos || {})) {
      if (!ANOS.includes(y)) continue;
      for (const [uf, vals] of Object.entries(ufs)) {
        if (ESTADOS.includes(uf) && vetor(vals)) (s.anos[y] ||= {})[uf] = vetor(vals);
      }
    }
    for (const [y, vals] of Object.entries(salvo.nacional || {})) {
      if (ANOS_NACIONAL.includes(y) && vetor(vals)) { s.nacional[y] = vetor(vals); s.modo[y] = "nacional"; }
    }
    for (const [y, m] of Object.entries(salvo.modo || {})) {
      if (m === "nacional" && ANOS_NACIONAL.includes(y)) s.modo[y] = m;
    }
    for (const [y, v] of Object.entries(salvo.recuperacao || {})) {
      if (!ANOS.includes(y)) continue;
      const r = v && typeof v === "object" ? v : { nacional: v };
      const estados = {};
      Object.entries(r.estados || {}).forEach(([uf, p]) => { if (ESTADOS.includes(uf) && p !== "" && p !== null) estados[uf] = String(p); });
      s.recuperacao[y] = { nacional: r.nacional === undefined || r.nacional === null ? "" : String(r.nacional), estados };
    }
    if (!temDadosEm(s, s.anoAtivo)) s.anoAtivo = ANOS.find((y) => temDadosEm(s, y)) || s.anoAtivo;
    return s;
  }

  function temDadosEm(s, y) {
    return s.modo[y] === "nacional" ? !!s.nacional[y]?.some((v) => v > 0) : Object.keys(s.anos[y] || {}).length > 0;
  }

  function carregar() {
    try {
      const salvo = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return salvo ? normalizarEstado(salvo) : estadoInicial();
    } catch (_) {
      return estadoInicial();
    }
  }

  let S = carregar();
  let saveTimer = null;

  function salvar() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
        const d = new Date();
        $("#saveState").textContent = `Rascunho salvo às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
      } catch (_) {
        $("#saveState").textContent = "Rascunho não pôde ser salvo neste navegador";
      }
    }, 350);
  }

  const getPath = (path) => path.split(".").reduce((o, k) => o?.[k], S);
  function setPath(path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    keys.reduce((o, k) => o[k], S)[last] = value;
  }

  const modo = (y) => S.modo[y] || "estados";

  function setVolume(ano, uf, col, valor) {
    const anoObj = (S.anos[ano] ||= {});
    const linha = (anoObj[uf] ||= Array(NM).fill(0));
    linha[col] = valor;
    if (linha.every((v) => !v)) delete anoObj[uf];
    if (!Object.keys(anoObj).length) delete S.anos[ano];
  }

  const nomeMaterial = (i) =>
    i === NM - 1 && S.comercial.outro_material_nome.trim()
      ? titulo(S.comercial.outro_material_nome.trim())
      : titulo(MATERIAIS[i]);

  // ---------- cálculo (espelha servicos/calculos.py) ----------
  const temDados = (y) => temDadosEm(S, y);
  const anosComVolume = () => ANOS.filter(temDados);

  const recObj = (y) => (S.recuperacao[y] ||= { nacional: "", estados: {} });
  function pctValido(bruto, min) {
    if (bruto === undefined || bruto === null || bruto === "") return min;
    const v = num(bruto);
    return Number.isFinite(v) && v >= min - 1e-9 && v <= 100 ? v : null;
  }
  const recuperacaoValida = (y) => pctValido(S.recuperacao[y]?.nacional, minimo(y));
  const recuperacao = (y) => recuperacaoValida(y) ?? minimo(y);
  const ajusteUF = (y, uf) => {
    const bruto = S.recuperacao[y]?.estados?.[uf];
    if (bruto === undefined || bruto === "") return null;
    return pctValido(bruto, metaUF(y, uf));
  };
  const ajusteInvalido = (y, uf) => {
    const bruto = S.recuperacao[y]?.estados?.[uf];
    return bruto !== undefined && bruto !== "" && ajusteUF(y, uf) === null;
  };
  const pctUF = (y, uf, rec = recuperacao(y)) => (ajusteUF(y, uf) ?? Math.max(rec, metaUF(y, uf))) / 100;

  // ---------- preços ----------
  const catMaterial = (i) => (i === NM - 1 && S.comercial.outro_categoria ? S.comercial.outro_categoria : CFG.precos.categoria_material[i]);
  const precoPadrao = (uf, j) => CFG.precos.tabela[uf][j];
  function precoEditado(uf, j) {
    const bruto = S.comercial.precos_uf[uf]?.[j];
    if (bruto === undefined || bruto === "") return null;
    const v = num(bruto);
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  const precoUF = (uf, j) => precoEditado(uf, j) ?? precoPadrao(uf, j);
  const mediaCategoria = (j) => soma(ESTADOS.map((uf) => precoUF(uf, j))) / ESTADOS.length;
  const planos = () => PLANOS;  // preços fixos; ajuste só pelo desconto
  const planoPara = (t) => (t > 0 ? planos().find((p) => t <= p.ate_t + 1e-9) || null : null);
  const valorPlano = (t, p) => (CFG.precos.faixa_cheia ? p.ate_t : t) * p.preco_t;

  // ---------- DRE (espelha servicos/precificacao.py) ----------
  function custoDireto(linhas) {
    let credito = 0, rec = 0, custodia = 0, toneladas = 0;
    linhas.forEach(([custoT, j, t]) => {
      credito += t * custoT;
      rec += t * DRE.rec_pct * custoT * DRE.taxa_rec;
      custodia += t * DRE.coop_pct * DRE.custodia_por_t[CAT[j]];
      toneladas += t;
    });
    const auditoria = toneladas * DRE.auditoria_por_t;
    return { credito, rec, custodia, auditoria, toneladas, total: credito + rec + custodia + auditoria };
  }
  function dreResultado(F, custos, classe) {
    const cofins = F * DRE.cofins, pis = F * DRE.pis;
    const receitaLiquida = F - cofins - pis;
    const lucroBruto = receitaLiquida - custos.total;
    const base = Math.max(lucroBruto, 0);
    const ir = base * DRE.ir, csll = base * DRE.csll;
    const irAdicional = Math.max(lucroBruto - DRE.ir_adicional_limite, 0) * DRE.ir_adicional;
    const lucroLiquido = lucroBruto - ir - csll - (DRE.subtrair_ir_adicional ? irAdicional : 0);
    const equipe = custos.toneladas * DRE.mao_de_obra_por_t[classe];
    const comissao = F * DRE.comissao_pct;
    const resultado = lucroLiquido - equipe - DRE.beneficios - comissao;
    return { F, cofins, pis, receitaLiquida, custos, lucroBruto, ir, csll, irAdicional, lucroLiquido,
      equipe, comissao, resultado, margem: F ? resultado / F : 0 };
  }
  function precoParaMargem(custos, classe, margem, desconto = 0, descontoValor = 0) {
    const t = custos.toneladas;
    if (t <= 0 || desconto >= 1) return 0;
    const m = (p) => dreResultado(Math.max(p * t * (1 - desconto) - descontoValor, 0), custos, classe).margem;
    let baixo = 0, alto = 1000;
    while (m(alto) < margem && alto < 1e7) alto *= 2;
    for (let k = 0; k < 80; k++) {
      const meio = (baixo + alto) / 2;
      if (m(meio) < margem) baixo = meio; else alto = meio;
    }
    return Math.ceil(Math.round(alto * 100 * 1e6) / 1e6) / 100;
  }
  const margemAlvo = () => DRE.margem_alvo;
  // Desconto fixado pelo comercial: em % ({pct}) ou em R$ ({valor}).
  function descontoFixo() {
    if (S.comercial.desconto_modo === "valor") {
      const v = num(S.comercial.desconto_valor);
      return { pct: 0, valor: Number.isFinite(v) && v >= 0 ? v : 0 };
    }
    const v = num(S.comercial.desconto_percentual);
    return { pct: Number.isFinite(v) ? Math.min(Math.max(v, 0), 100) / 100 : 0, valor: 0 };
  }
  const comDesconto = (bruto, d) => Math.max(bruto * (1 - d.pct) - d.valor, 0);
  const margemInformada = () => {
    if (S.comercial.margem === "") return null;
    const v = num(S.comercial.margem);
    return Number.isFinite(v) && v >= 0 && v < 100 ? v / 100 : null;
  };
  const precoInformado = () => {
    if (S.comercial.preco_t === "") return null;
    const v = num(S.comercial.preco_t);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  const precosEditados = () => Object.entries(S.comercial.precos_uf)
    .flatMap(([uf, vals]) => vals.map((_, j) => [uf, j])).filter(([uf, j]) => {
      const v = precoEditado(uf, j);
      return v !== null && Math.abs(v - precoPadrao(uf, j)) > 1e-9;
    });

  function distribuir(y, totais) {
    const tabela = CFG.confaz[y];
    if (!tabela) return null;
    const out = {};
    ESTADOS.forEach((uf) => { if (tabela[uf] > 0) out[uf] = totais.map((v) => (v * tabela[uf]) / 100); });
    return out;
  }

  // Calcula um ano isolado (massas e linhas de custo); o preço sai do total da proposta.
  function calcAno(y, { totais, rec } = {}) {
    const r = rec ?? recuperacao(y);
    const nacional = totais !== undefined || modo(y) === "nacional";
    const tot = totais ?? S.nacional[y] ?? Array(NM).fill(0);
    const estados = nacional ? distribuir(y, tot) : (S.anos[y] || {});
    const declarado = Array(NM).fill(0);
    const compensar = Array(NM).fill(0);
    const linhas = [];
    const custo = [];
    if (estados) {
      ESTADOS.forEach((uf) => {
        const vals = estados[uf];
        if (!vals) return;
        const p = pctUF(y, uf, r);
        const linha = { uf, p, declarado: 0, compensar: 0 };
        vals.forEach((v, i) => {
          const c = v * p;
          const j = CAT.indexOf(catMaterial(i));
          declarado[i] += v; compensar[i] += c;
          linha.declarado += v; linha.compensar += c;
          if (c) custo.push([precoUF(uf, j), j, c]);
        });
        linhas.push(linha);
      });
    } else {
      const p = Math.max(r, minimo(y)) / 100;
      tot.forEach((v, i) => {
        const j = CAT.indexOf(catMaterial(i));
        declarado[i] = v; compensar[i] = v * p;
        if (compensar[i]) custo.push([mediaCategoria(j), j, compensar[i]]);
      });
    }
    return { nacional, distribuido: !!estados, rec: r, declarado, compensar, linhas, custo };
  }

  function calcular() {
    const declarado = Array(NM).fill(0);
    const compensar = Array(NM).fill(0);
    const estados = new Set();
    const anos = anosComVolume();
    const porAno = {};
    const semDistribuicao = [];
    const linhasCusto = [];

    for (const y of anos) {
      const c = calcAno(y);
      porAno[y] = c;
      c.declarado.forEach((v, i) => (declarado[i] += v));
      c.compensar.forEach((v, i) => (compensar[i] += v));
      c.linhas.forEach((l) => estados.add(l.uf));
      linhasCusto.push(...c.custo);
      if (!c.distribuido) semDistribuicao.push(y);
    }
    const totalCompensar = soma(compensar);
    const custos = custoDireto(linhasCusto);
    const classe = S.comercial.classe_mo;
    const fixo = descontoFixo();
    const plano = planoPara(totalCompensar);
    let subtotal, precoT;
    if (plano) { subtotal = valorPlano(totalCompensar, plano); precoT = plano.preco_t; }
    else {
      const m = S.comercial.modo_preco === "margem" ? margemInformada() : null;
      precoT = m !== null ? precoParaMargem(custos, classe, m, fixo.pct, fixo.valor) : (precoInformado() ?? DRE.preco_referencia_t);
      subtotal = totalCompensar * precoT;
    }
    const fator = totalCompensar ? subtotal / totalCompensar : 0;
    const valor = compensar.map((c) => c * fator);
    const total = comDesconto(subtotal, fixo);
    const desconto = subtotal - total;
    const desc = subtotal ? desconto / subtotal : 0;
    return {
      anos, porAno, declarado, compensar, valor, subtotal, semDistribuicao,
      estados: [...estados],
      totalDeclarado: soma(declarado),
      totalCompensar,
      regime: plano ? "plano" : "dre",
      plano, precoT, fator, custos,
      dre: dreResultado(total, custos, classe),
      desconto,
      descPct: desc,
      descFixo: fixo,
      total,
    };
  }

  // ---------- grade de volumes (modo por estados) ----------
  const grid = { head: $("#gridHead"), body: $("#gridBody"), foot: $("#gridFoot") };

  function montarGrade() {
    grid.head.innerHTML = `<tr><th class="uf">UF</th>${MATERIAIS.map((_, i) =>
      `<th data-col-head="${i}">${nomeMaterial(i)}</th>`).join("")}<th class="row-total">Total</th></tr>`;

    grid.body.innerHTML = ESTADOS.map((uf, r) => `<tr data-uf="${uf}">
      <td class="uf">${uf}</td>
      ${MATERIAIS.map((m, c) => `<td class="cell"><input type="text" inputmode="decimal" autocomplete="off"
        data-r="${r}" data-c="${c}" aria-label="${uf} – ${titulo(m)}" placeholder="0"></td>`).join("")}
      <td class="row-total" data-row-total>–</td>
    </tr>`).join("") + `<tr class="empty-row hidden"><td colspan="${NM + 2}">Nenhum estado preenchido neste ano.</td></tr>`;

    grid.foot.innerHTML = `<tr><td class="uf">Total</td>${MATERIAIS.map((_, i) =>
      `<td data-col-total="${i}">0</td>`).join("")}<td class="row-total" data-grand-total>0 t</td></tr>`;
  }

  function preencherGrade() {
    const dados = S.anos[S.anoAtivo] || {};
    $$("tr[data-uf]", grid.body).forEach((tr) => {
      const vals = dados[tr.dataset.uf];
      $$("input", tr).forEach((inp, c) => {
        inp.value = cellText(vals ? vals[c] : 0);
        inp.classList.remove("bad");
      });
    });
    totaisGrade();
    filtrarGrade();
  }

  function totaisGrade() {
    const dados = S.anos[S.anoAtivo] || {};
    const col = Array(NM).fill(0);
    $$("tr[data-uf]", grid.body).forEach((tr) => {
      const vals = dados[tr.dataset.uf];
      const total = vals ? soma(vals) : 0;
      if (vals) vals.forEach((v, i) => (col[i] += v));
      $("[data-row-total]", tr).textContent = total ? fmt(total, 3, 0) : "–";
      tr.classList.toggle("filled", total > 0);
    });
    col.forEach((v, i) => ($(`[data-col-total="${i}"]`, grid.foot).textContent = fmt(v, 3, 0)));
    $("[data-grand-total]", grid.foot).textContent = ton(soma(col));
  }

  function filtrarGrade() {
    const so = $("#soPreenchidos").checked;
    let visiveis = 0;
    $$("tr[data-uf]", grid.body).forEach((tr) => {
      const esconder = so && !tr.classList.contains("filled");
      tr.classList.toggle("hidden", esconder);
      if (!esconder) visiveis++;
    });
    $(".empty-row", grid.body).classList.toggle("hidden", visiveis > 0);
  }

  const linhasVisiveis = () => $$("tr[data-uf]:not(.hidden)", grid.body);

  function focarCelula(tr, c) {
    const inp = tr && $(`input[data-c="${c}"]`, tr);
    if (inp) { inp.focus(); inp.select(); }
  }

  grid.body.addEventListener("input", (e) => {
    const inp = e.target.closest("input[data-c]");
    if (!inp) return;
    const v = num(inp.value);
    const invalido = !Number.isFinite(v) || v < 0;
    inp.classList.toggle("bad", invalido);
    if (!invalido) setVolume(S.anoAtivo, inp.closest("tr").dataset.uf, +inp.dataset.c, v);
    totaisGrade();
    atualizarTudo({ grade: false });
  });

  grid.body.addEventListener("focusout", (e) => {
    const inp = e.target.closest("input[data-c]");
    if (!inp || inp.classList.contains("bad")) return;
    inp.value = cellText(num(inp.value));
  });

  grid.body.addEventListener("keydown", (e) => {
    const inp = e.target.closest("input[data-c]");
    if (!inp) return;
    const tr = inp.closest("tr");
    const c = +inp.dataset.c;
    const linhas = linhasVisiveis();
    const idx = linhas.indexOf(tr);
    const fimTexto = inp.selectionStart === inp.value.length && inp.selectionEnd === inp.value.length;
    const inicioTexto = inp.selectionStart === 0 && inp.selectionEnd === 0;

    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focarCelula(linhas[idx + 1], c); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focarCelula(linhas[idx - 1], c); }
    else if (e.key === "ArrowRight" && fimTexto && c < NM - 1) { e.preventDefault(); focarCelula(tr, c + 1); }
    else if (e.key === "ArrowLeft" && inicioTexto && c > 0) { e.preventDefault(); focarCelula(tr, c - 1); }
  });

  function ufDoTexto(texto) {
    const t = normaliza(String(texto || ""));
    if (ESTADOS.includes(t.toUpperCase())) return t.toUpperCase();
    return NOMES_UF[t] || null;
  }

  // Colar do Excel: aceita bloco de números a partir da célula focada ou
  // linhas que começam com a UF/nome do estado (ex.: "SP  10,5  3  ...").
  grid.body.addEventListener("paste", (e) => {
    const inp = e.target.closest("input[data-c]");
    const texto = e.clipboardData?.getData("text") || "";
    if (!inp || !/[\t\n]/.test(texto.trim())) return;
    e.preventDefault();

    const linhas = texto.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "").map((l) => l.split("\t"));
    const porUF = linhas.some((cols) => ufDoTexto(cols[0]));
    const colInicial = +inp.dataset.c;
    let colados = 0, ignorados = 0;

    const aplicar = (uf, valores, c0) => {
      valores.forEach((bruto, k) => {
        const c = c0 + k;
        if (c >= NM) return;
        const v = num(bruto);
        if (!Number.isFinite(v) || v < 0) { ignorados++; return; }
        setVolume(S.anoAtivo, uf, c, v);
        colados++;
      });
    };

    if (porUF) {
      linhas.forEach((cols) => {
        const uf = ufDoTexto(cols[0]);
        if (!uf) { ignorados++; return; }
        const valores = cols.slice(1);
        aplicar(uf, valores, valores.length >= NM ? 0 : colInicial);
      });
    } else {
      const visiveis = linhasVisiveis();
      const r0 = visiveis.indexOf(inp.closest("tr"));
      linhas.forEach((cols, k) => {
        const tr = visiveis[r0 + k];
        if (tr) aplicar(tr.dataset.uf, cols, colInicial);
      });
    }

    preencherGrade();
    atualizarTudo({ grade: false });
    toast(`${colados} valor${colados === 1 ? "" : "es"} colado${colados === 1 ? "" : "s"}` +
      (ignorados ? ` · ${ignorados} ignorado${ignorados === 1 ? "" : "s"} (texto ou inválido)` : ""), colados ? "ok" : "warn");
  });

  // ---------- anos e modos ----------
  function renderAnos() {
    $("#yearTabs").innerHTML = ANOS.map((y) => {
      const ativo = y === S.anoAtivo;
      let marca = "";
      if (temDados(y)) {
        marca = modo(y) === "nacional"
          ? '<span class="tag-br" title="Nacional · CONFAZ">BR</span>'
          : `<span class="dot">${Object.keys(S.anos[y]).length}</span>`;
      }
      return `<button type="button" role="tab" aria-selected="${ativo}" class="${ativo ? "active" : ""}" data-ano="${y}">${y}${marca}</button>`;
    }).join("");

    const y = S.anoAtivo;
    const nacionalOk = ANOS_NACIONAL.includes(y);
    $$("#modoTabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.modo === modo(y));
      b.setAttribute("aria-selected", b.dataset.modo === modo(y));
      if (b.dataset.modo === "nacional") {
        b.disabled = !nacionalOk;
        b.title = nacionalOk ? "" : `Compensação nacional disponível para ${ANOS_NACIONAL.join(", ")}`;
      }
    });

    const c = calcAno(y);
    const n = c.linhas.length;
    $("#yearMeta").innerHTML = modo(y) === "nacional"
      ? `Recuperação <b>${pct(c.rec)}</b> · ${ton(soma(c.declarado))} declaradas`
      : `Recuperação <b>${pct(c.rec)}</b> · ${n} estado${n === 1 ? "" : "s"} · ${ton(soma(c.declarado))}`;

    const nota = $("#regraAno");
    const origem = "";
    nota.innerHTML = `Para ${y}: ${textoRegra(y)}${origem}`;
    nota.classList.remove("warn");

    $("#modoEstados").hidden = modo(y) === "nacional";
    $("#modoNacional").hidden = modo(y) !== "nacional";
  }

  $("#yearTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-ano]");
    if (!btn) return;
    S.anoAtivo = btn.dataset.ano;
    atualizarTudo();
    if (hasAnime()) anime({ targets: "#gridBody tr:not(.hidden), #modoNacional", opacity: [0.3, 1], duration: 300, delay: anime.stagger(8), easing: "easeOutQuad" });
  });

  $("#modoTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-modo]");
    const y = S.anoAtivo;
    if (!btn || btn.disabled || btn.dataset.modo === modo(y)) return;
    if (temDados(y) && !confirm(`Trocar o modo de ${y}? Os volumes já informados neste ano serão apagados.`)) return;
    delete S.anos[y];
    delete S.nacional[y];
    if (btn.dataset.modo === "nacional") S.modo[y] = "nacional";
    else delete S.modo[y];
    atualizarTudo();
    if (btn.dataset.modo === "nacional") abrirAssistente(y);
  });

  $("#soPreenchidos").addEventListener("change", filtrarGrade);

  $("#limparAno").addEventListener("click", () => {
    if (!S.anos[S.anoAtivo]) return toast(`Nada para limpar em ${S.anoAtivo}.`, "warn");
    if (!confirm(`Apagar todos os volumes de ${S.anoAtivo}?`)) return;
    delete S.anos[S.anoAtivo];
    atualizarTudo();
  });

  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (anosComVolume().length && !confirm("Substituir os volumes por estado pelos da planilha importada?")) return;
    const fd = new FormData();
    fd.append("arquivo", file);
    try {
      const res = await fetch("/importar-excel", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.sucesso) throw new Error(data.erro || "Não foi possível importar.");
      S.anos = data.anos;
      Object.keys(data.anos).forEach((y) => { delete S.modo[y]; delete S.nacional[y]; });
      S.anoAtivo = Object.keys(data.anos).sort((a, b) => b - a)[0] || S.anoAtivo;
      atualizarTudo();
      const n = Object.values(S.anos).reduce((s, a) => s + Object.keys(a).length, 0);
      toast(`Planilha importada: ${n} estado(s) em ${Object.keys(data.anos).sort((a, b) => b - a).join(", ")}.`, "ok");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  // ---------- modo nacional (CONFAZ) ----------
  function renderNacional() {
    const y = S.anoAtivo;
    const box = $("#modoNacional");
    if (modo(y) !== "nacional") { box.innerHTML = ""; return; }

    if (!temDados(y)) {
      box.innerHTML = `<div class="nac-empty">
        <h4>Compensação com abrangência nacional</h4>
        <p>Informe a massa total por material; a Metodologia CONFAZ distribui entre as UFs.</p>
        <button class="btn btn-primary" type="button" data-nac-editar>Adicionar materiais</button>
      </div>`;
      return;
    }

    const c = calcAno(y);
    const tot = S.nacional[y];
    const chips = tot.map((v, i) => (v > 0 ? `<span class="chip">${nomeMaterial(i)} <b>${ton(v)}</b></span>` : "")).join("");
    let distrib;
    if (c.distribuido) {
      const tabela = CFG.confaz[y];
      distrib = `<div class="dist-wrap"><table class="dist">
        <thead><tr><th>UF</th><th>Participação</th><th>Declarado</th><th>% aplicado</th><th>A compensar</th></tr></thead>
        <tbody>${c.linhas.map((l) => `<tr class="${regra(y).excecoes[l.uf] !== undefined ? "exc" : ""}">
          <td>${l.uf}</td><td>${fmt(tabela[l.uf], 4, 2)}%</td><td>${fmt(l.declarado, 3, 3)}</td>
          <td>${pct(l.p * 100)}</td><td>${fmt(l.compensar, 3, 3)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td>100%</td><td>${fmt(soma(c.declarado), 3, 3)}</td>
          <td>${pct((soma(c.compensar) / soma(c.declarado)) * 100)}</td><td>${fmt(soma(c.compensar), 3, 3)}</td></tr></tfoot>
      </table></div>`;
    } else {
      distrib = `<div class="callout warn">A tabela de participação por UF (Metodologia CONFAZ) de ${y} ainda não foi cadastrada em
        <code>config/confaz.json</code>. Até lá, o cálculo aplica ${pct(Math.max(c.rec, minimo(y)))} sobre o total nacional,
        o PDF e o PPT saem normalmente e a planilha por UF não pode ser gerada para este ano.</div>`;
    }

    box.innerHTML = `<div class="nac-head">
        <div><h4>Nacional · Metodologia CONFAZ · ${y}</h4>
        <p>Massa total colocada no mercado brasileiro, distribuída entre as UFs.</p></div>
        <div class="nac-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-nac-editar>Editar materiais</button>
          <button class="btn btn-danger-ghost btn-sm" type="button" data-nac-remover>Remover</button>
        </div>
      </div>
      <div class="chips">${chips}</div>
      <div class="stat-row">
        <div><span>Declarado</span><strong>${ton(soma(c.declarado))}</strong></div>
        <div><span>Recuperação contratada</span><strong>${pct(c.rec)}</strong></div>
        <div><span>A compensar</span><strong>${ton(soma(c.compensar))}</strong></div>
      </div>
      ${distrib}`;
  }

  $("#modoNacional").addEventListener("click", (e) => {
    if (e.target.closest("[data-nac-editar]")) abrirAssistente(S.anoAtivo);
    if (e.target.closest("[data-nac-remover]")) {
      if (!confirm(`Remover a compensação nacional de ${S.anoAtivo}?`)) return;
      delete S.nacional[S.anoAtivo];
      atualizarTudo();
    }
  });

  // ---------- assistente Metodologia CONFAZ ----------
  const wiz = { passo: 1, ano: null, valores: Array(NM).fill(""), rec: "" };
  const dlg = $("#confazDialog");
  const iconeCal = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>';

  function abrirAssistente(ano = null) {
    wiz.ano = ano && ANOS_NACIONAL.includes(ano) ? ano : null;
    const base = wiz.ano && S.nacional[wiz.ano];
    wiz.valores = base ? base.map((v) => (v ? fmt(v, 3, 3) : "")) : Array(NM).fill("");
    wiz.rec = wiz.ano ? fmt(recuperacao(wiz.ano), 2, 0) : "";
    irPara(wiz.ano ? 2 : 1);
    dlg.showModal();
  }

  const recWizard = () => {
    const v = num(wiz.rec);
    return Number.isFinite(v) && v >= minimo(wiz.ano) - 1e-9 && v <= 100 ? v : null;
  };
  const totaisWizard = () => wiz.valores.map((v) => num(v));

  function irPara(passo) {
    wiz.passo = passo;
    $$("[data-wpane]", dlg).forEach((p) => (p.hidden = +p.dataset.wpane !== passo));
    $$("[data-wstep]", dlg).forEach((li) => {
      li.classList.toggle("active", +li.dataset.wstep === passo);
      li.classList.toggle("done", +li.dataset.wstep < passo);
    });
    if (passo === 1) renderPasso1();
    if (passo === 2) renderPasso2();
    if (passo === 3) renderPasso3();
    $("#confazVoltar").textContent = passo === 1 ? "Cancelar" : "← Voltar";
    $("#confazAvancar").textContent = passo === 3 ? "Confirmar ano-base ✓" : "Avançar →";
    validarPasso();
    if (hasAnime()) anime({ targets: `[data-wpane="${passo}"]`, opacity: [0, 1], translateX: [12, 0], duration: 260, easing: "easeOutQuad" });
  }

  function validarPasso() {
    let ok = true;
    if (wiz.passo === 1) ok = !!wiz.ano;
    if (wiz.passo === 2) {
      const t = totaisWizard();
      ok = t.every((v) => Number.isFinite(v) && v >= 0) && t.some((v) => v > 0) && recWizard() !== null;
    }
    $("#confazAvancar").disabled = !ok;
  }

  function renderPasso1() {
    $("#confazAnos").innerHTML = ANOS_NACIONAL.map((y) => {
      let flag = "";
      if (modo(y) === "nacional" && temDados(y)) flag = '<span class="flag">Preenchido</span>';
      else if (Object.keys(S.anos[y] || {}).length) flag = '<span class="flag alt">Tem volumes por estado</span>';
      return `<button type="button" class="year-card ${wiz.ano === y ? "selected" : ""}" data-wano="${y}">
        <span class="cal">${iconeCal}</span><b>${y}</b><small>mín. ${pct(minimo(y))}</small>${flag}</button>`;
    }).join("");
  }

  function renderPasso2() {
    const y = wiz.ano;
    $("#confazAnoSel").textContent = y;
    $("#confazMateriais").innerHTML = MATERIAIS.map((_, i) => `<div class="mat-card">
      <label for="wm${i}">${nomeMaterial(i)}</label>
      <div class="ton"><input id="wm${i}" type="text" inputmode="decimal" data-wmat="${i}" placeholder="0,000" value="${wiz.valores[i]}"><span>ton</span></div>
      <small data-wkg="${i}"></small></div>`).join("");
    MATERIAIS.forEach((_, i) => atualizarKg(i));
    if (!wiz.rec) wiz.rec = fmt(minimo(y), 2, 0);
    $("#confazRec").value = wiz.rec;
    const range = $("#confazRecRange");
    range.min = minimo(y);
    range.value = num(wiz.rec) || minimo(y);
    $("#confazRegra").innerHTML = `Mínimo legal para ${y}: ${textoRegra(y)} O cliente pode contratar até 100%.`;
  }

  function atualizarKg(i) {
    const v = num(wiz.valores[i]);
    const el = $(`[data-wkg="${i}"]`);
    const ok = Number.isFinite(v) && v >= 0;
    el.closest(".mat-card").querySelector(".ton").classList.toggle("bad", !ok);
    el.textContent = ok ? `Valor considerado: ${fmt(v, 3, 3)} ton (${fmt(v * 1000, 0)} kg)` : "Valor inválido";
  }

  function renderPasso3() {
    const y = wiz.ano;
    const t = totaisWizard();
    const c = calcAno(y, { totais: t, rec: recWizard() });
    $("#confazResumoSub").innerHTML = `Ano-base <b>${y}</b> · recuperação contratada <b>${pct(c.rec)}</b>`;
    const linhas = t.map((v, i) => (v > 0 ? `<tr><td>${nomeMaterial(i)}</td><td>${fmt(v, 3, 3)}</td><td>${fmt(c.compensar[i], 3, 3)}</td></tr>` : "")).join("");
    const aviso = Object.keys(S.anos[y] || {}).length
      ? `<div class="callout warn">${y} tem volumes por estado. Ao confirmar, eles serão substituídos pela compensação nacional.</div>` : "";
    const nota = c.distribuido
      ? `<div class="callout">Distribuído entre ${c.linhas.length} UFs pela tabela CONFAZ de ${y}; cada UF usa o maior entre ${pct(c.rec)} e a sua meta mínima.</div>`
      : `<div class="callout warn">Tabela CONFAZ de ${y} não cadastrada: o cálculo aplica ${pct(Math.max(c.rec, minimo(y)))} sobre o total nacional e a planilha por UF ficará indisponível para este ano.</div>`;
    $("#confazResumo").innerHTML = `<table class="mini-table">
      <thead><tr><th>Material</th><th>Declarado (t)</th><th>A compensar (t)</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><td>Total</td><td>${fmt(soma(c.declarado), 3, 3)}</td><td>${fmt(soma(c.compensar), 3, 3)}</td></tr></tfoot>
    </table>${nota}${aviso}`;
  }

  $("#confazAnos").addEventListener("click", (e) => {
    const card = e.target.closest("[data-wano]");
    if (!card) return;
    if (wiz.ano !== card.dataset.wano) {
      wiz.ano = card.dataset.wano;
      const base = S.nacional[wiz.ano];
      wiz.valores = base ? base.map((v) => (v ? fmt(v, 3, 3) : "")) : Array(NM).fill("");
      wiz.rec = fmt(recuperacao(wiz.ano), 2, 0);
    }
    renderPasso1();
    validarPasso();
  });
  $("#confazAnos").addEventListener("dblclick", (e) => { if (e.target.closest("[data-wano]") && wiz.ano) irPara(2); });

  $("#confazMateriais").addEventListener("input", (e) => {
    const inp = e.target.closest("[data-wmat]");
    if (!inp) return;
    wiz.valores[+inp.dataset.wmat] = inp.value;
    atualizarKg(+inp.dataset.wmat);
    validarPasso();
  });
  $("#confazMateriais").addEventListener("focusout", (e) => {
    const inp = e.target.closest("[data-wmat]");
    const v = inp && num(inp.value);
    if (inp && Number.isFinite(v) && v >= 0) inp.value = wiz.valores[+inp.dataset.wmat] = v ? fmt(v, 3, 3) : "";
  });
  $("#confazRec").addEventListener("input", (e) => {
    wiz.rec = e.target.value;
    const v = recWizard();
    e.target.closest(".pct-input").classList.toggle("bad", v === null);
    if (v !== null) $("#confazRecRange").value = v;
    validarPasso();
  });
  $("#confazRecRange").addEventListener("input", (e) => {
    wiz.rec = fmt(+e.target.value, 2, 0);
    $("#confazRec").value = wiz.rec;
    $("#confazRec").closest(".pct-input").classList.remove("bad");
    validarPasso();
  });

  $("#confazVoltar").addEventListener("click", () => (wiz.passo === 1 ? dlg.close() : irPara(wiz.passo - 1)));
  $("#confazAvancar").addEventListener("click", () => {
    if (wiz.passo < 3) return irPara(wiz.passo + 1);
    const y = wiz.ano;
    delete S.anos[y];
    S.modo[y] = "nacional";
    S.nacional[y] = totaisWizard().map((v) => (v > 0 ? v : 0));
    if (num(wiz.rec) !== recuperacao(y) || recObj(y).nacional === "") mudarNacional(y, wiz.rec);
    S.anoAtivo = y;
    dlg.close();
    atualizarTudo();
    toast(`Compensação nacional de ${y} confirmada.`, "ok");
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });
  $("#abrirConfaz").addEventListener("click", () => abrirAssistente(ANOS_NACIONAL.includes(S.anoAtivo) && modo(S.anoAtivo) === "nacional" ? S.anoAtivo : null));

  // ---------- recuperação (nacional + por UF) ----------
  const ufsDoAno = (y) => (modo(y) === "nacional" ? ESTADOS.filter((uf) => (CFG.confaz[y]?.[uf] ?? 1) > 0) : Object.keys(S.anos[y] || {}).sort());
  const abertos = new Set();

  function renderRecuperacao() {
    const anos = anosComVolume();
    const box = $("#recuperacao");
    const chave = anos.map((y) => `${y}:${modo(y)}:${ufsDoAno(y).join("")}:${abertos.has(y)}`).join("|");
    if (box.dataset.chave === chave && anos.length) {
      // Só atualiza estados visuais para não perder o foco de quem está digitando.
      anos.forEach((y) => {
        const row = $(`[data-rec-row="${y}"]`, box);
        const nac = $(`[data-rec="${y}"]`, row);
        if (nac && document.activeElement !== nac && recObj(y).nacional === "") nac.value = fmt(recuperacao(y), 2, 0);
        $(".rec-ctl .pct-input", row).classList.toggle("bad", recuperacaoValida(y) === null);
        const n = Object.keys(recObj(y).estados).length;
        $(".rec-toggle", row).textContent = `${abertos.has(y) ? "Ocultar" : "Ajustar por estado"}${n ? ` (${n} ajustado${n > 1 ? "s" : ""})` : ""}`;
        $$("[data-rec-uf]", row).forEach((inp) => {
          const uf = inp.dataset.recUf;
          const editado = (recObj(y).estados[uf] ?? "") !== "";
          inp.closest(".rec-uf").classList.toggle("edited", editado);
          inp.closest(".pct-input").classList.toggle("bad", ajusteInvalido(y, uf));
          if (!editado && document.activeElement !== inp) inp.value = fmt(pctUF(y, uf) * 100, 2, 0);
        });
      });
      return;
    }
    box.dataset.chave = chave;
    if (!anos.length) {
      box.innerHTML = '<p class="empty-note">Informe volumes em algum ano-base para definir a recuperação.</p>';
      return;
    }
    box.innerHTML = anos.map((y) => {
      const n = Object.keys(recObj(y).estados).length;
      const ufs = abertos.has(y) ? `<div class="rec-ufs">${ufsDoAno(y).map((uf) => {
        const editado = (recObj(y).estados[uf] ?? "") !== "";
        const valor = editado ? recObj(y).estados[uf] : fmt(pctUF(y, uf) * 100, 2, 0);
        return `<div class="rec-uf ${editado ? "edited" : ""}"><div><b>${uf}</b><small>mín. ${pct(metaUF(y, uf))}</small></div>
          <label class="pct-input ${ajusteInvalido(y, uf) ? "bad" : ""}"><input type="text" inputmode="decimal" data-rec-ano="${y}" data-rec-uf="${uf}" value="${valor}" aria-label="Recuperação ${y} ${uf} (%)">%</label></div>`;
      }).join("")}</div>` : "";
      return `<div class="rec-row" data-rec-row="${y}">
        <div class="rec-year"><b>${y}</b><span>${modo(y) === "nacional" ? "Nacional · CONFAZ" : "Por estados"}</span></div>
        <div class="rec-rule">Mínimo: ${textoRegra(y)}<br><button type="button" class="rec-toggle" data-rec-abrir="${y}">${abertos.has(y) ? "Ocultar" : "Ajustar por estado"}${n ? ` (${n} ajustado${n > 1 ? "s" : ""})` : ""}</button></div>
        <div class="rec-ctl">
          <input type="range" min="${minimo(y)}" max="100" step="0.1" value="${recuperacao(y)}" data-rec-range="${y}" aria-label="Recuperação nacional ${y}">
          <label class="pct-input ${recuperacaoValida(y) === null ? "bad" : ""}"><input type="text" inputmode="decimal" data-rec="${y}" value="${recObj(y).nacional !== "" ? recObj(y).nacional : fmt(recuperacao(y), 2, 0)}" aria-label="Recuperação nacional ${y} (%)">%</label>
        </div>
        ${ufs ? `<div class="rec-more">${ufs}</div>` : ""}
      </div>`;
    }).join("");
  }

  // Mudar o nacional faz todos os estados acompanharem (ajustes individuais são refeitos).
  function mudarNacional(y, valor) {
    const r = recObj(y);
    const tinhaAjustes = Object.keys(r.estados).length > 0;
    r.nacional = valor;
    r.estados = {};
    $("#recuperacao").dataset.chave = "";
    return tinhaAjustes;
  }

  $("#recuperacao").addEventListener("input", (e) => {
    const txt = e.target.closest("[data-rec]");
    const rng = e.target.closest("[data-rec-range]");
    const uf = e.target.closest("[data-rec-uf]");
    if (txt) {
      if (mudarNacional(txt.dataset.rec, txt.value)) toast(`Ajustes por estado de ${txt.dataset.rec} refeitos: todos seguem o nacional.`, "warn");
      atualizarTudo({ grade: false });
      const novo = $(`[data-rec="${txt.dataset.rec}"]`);
      if (novo && novo !== txt) { novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
      return;
    }
    if (rng) {
      if (mudarNacional(rng.dataset.recRange, fmt(+rng.value, 2, 0))) toast(`Ajustes por estado de ${rng.dataset.recRange} refeitos: todos seguem o nacional.`, "warn");
      atualizarTudo({ grade: false });
      $(`[data-rec-range="${rng.dataset.recRange}"]`)?.focus();
      return;
    }
    if (uf) {
      const y = uf.dataset.recAno;
      const automatico = fmt(Math.max(recuperacao(y), metaUF(y, uf.dataset.recUf)), 2, 0);
      if (uf.value === "" || uf.value === automatico) delete recObj(y).estados[uf.dataset.recUf];
      else recObj(y).estados[uf.dataset.recUf] = uf.value;
      atualizarTudo({ grade: false });
    }
  });
  // Ao sair de um campo vazio, volta a mostrar o percentual automático.
  $("#recuperacao").addEventListener("focusout", (e) => {
    if (e.target.closest("[data-rec-uf], [data-rec]")) setTimeout(renderRecuperacao, 0);
  });
  $("#recuperacao").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-rec-abrir]");
    if (!btn) return;
    const y = btn.dataset.recAbrir;
    abertos.has(y) ? abertos.delete(y) : abertos.add(y);
    renderRecuperacao();
  });

  // ---------- tabela de preços e pacotes ----------
  function renderPrecosCard() {
    const editados = precosEditados();
    $("#precoVigencia").innerHTML = `Vigência ${CFG.precos.vigencia}${editados.length ? `<span class="badge-edit">${editados.length} preço${editados.length > 1 ? "s" : ""} editado${editados.length > 1 ? "s" : ""}</span>` : ""}`;
    $("#catMedias").innerHTML = CAT.map((c, j) => {
      const vals = ESTADOS.map((uf) => precoUF(uf, j));
      return `<div><span>${titulo(c)}</span><strong>${money(mediaCategoria(j))}</strong><small>média · ${money(Math.min(...vals))} a ${money(Math.max(...vals))}</small></div>`;
    }).join("");
  }

  function montarPlanos() {
    $("#planos").innerHTML = PLANOS.map((p, k) => `<div class="pack" data-pack="${k}">
      <span>Até ${fmt(p.ate_t, 0)} t</span>
      <strong class="pack-preco">${money(p.preco_t)}<em>/t</em></strong>
      <small data-plano-total="${k}"></small>
    </div>`).join("");
    $("#classeMo").innerHTML = CLASSES.map((c) => `<button type="button" role="radio" data-classe="${c}">${c}<small>${money(DRE.mao_de_obra_por_t[c])}/t</small></button>`).join("");
  }

  $("#classeMo").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-classe]");
    if (!btn) return;
    S.comercial.classe_mo = btn.dataset.classe;
    atualizarTudo({ grade: false });
  });
  $("#precoVenda").addEventListener("input", (e) => {
    S.comercial.modo_preco = "preco";
    S.comercial.preco_t = e.target.value;
    atualizarTudo({ grade: false });
  });
  $("#margemContrato").addEventListener("input", (e) => {
    S.comercial.modo_preco = "margem";
    S.comercial.margem = e.target.value;
    atualizarTudo({ grade: false });
  });
  ["#precoVenda", "#margemContrato"].forEach((sel) => $(sel).addEventListener("focusout", () => setTimeout(() => atualizarTudo({ grade: false }), 0)));
  $("#usarReferencia").addEventListener("click", () => {
    S.comercial.modo_preco = "preco";
    S.comercial.preco_t = "";
    atualizarTudo({ grade: false });
    toast(`Preço de referência aplicado (${money(DRE.preco_referencia_t)}/t).`, "ok");
  });
  $("#cenarios").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cenario]");
    if (!btn) return;
    S.comercial.modo_preco = "margem";
    S.comercial.margem = btn.dataset.cenario;
    atualizarTudo({ grade: false });
  });

  function renderPreco(r) {
    const dreAtivo = r.anos.length > 0 && r.regime === "dre";
    $("#cardPlanos").classList.toggle("ativo", r.anos.length > 0 && r.regime === "plano");
    $("#cardPlanos").hidden = r.anos.length > 0 && r.regime === "dre";
    $("#cardDre").classList.toggle("ativo", dreAtivo);
    $("#regime").innerHTML = !r.anos.length ? "Informe volumes para calcular o preço."
      : r.regime === "plano"
        ? `<span class="chip">Massa a compensar total <b>${fmt(r.totalCompensar, 3, 3)} t</b></span> → <span class="chip">Plano até <b>${fmt(r.plano.ate_t, 0)} t</b> · ${money(r.plano.preco_t)}/t = <b>${money(r.subtotal)}</b></span>`
        : `<span class="chip">Massa a compensar total <b>${fmt(r.totalCompensar, 3, 3)} t</b></span> → <span class="chip">DRE · ${money(r.precoT)}/t = <b>${money(r.subtotal)}</b></span>`;
    PLANOS.forEach((p, k) => {
      const pl = planos()[k];
      $(`[data-plano-total="${k}"]`).textContent = `até ${money(pl.ate_t * pl.preco_t)}`;
      $(`[data-pack="${k}"]`).classList.toggle("atual", r.regime === "plano" && r.plano?.ate_t === pl.ate_t);
    });
    $$("#classeMo [data-classe]").forEach((b) => {
      b.classList.toggle("active", b.dataset.classe === S.comercial.classe_mo);
      b.setAttribute("aria-checked", b.dataset.classe === S.comercial.classe_mo);
    });
    const venda = $("#precoVenda");
    const margemEl = $("#margemContrato");
    const porMargem = S.comercial.modo_preco === "margem" && margemInformada() !== null;
    if (document.activeElement !== venda) {
      venda.value = S.comercial.modo_preco === "preco" && S.comercial.preco_t !== "" ? S.comercial.preco_t : fmt(r.regime === "dre" ? r.precoT : (porMargem ? precoParaMargem(r.custos, S.comercial.classe_mo, margemInformada(), r.descFixo.pct, r.descFixo.valor) : precoInformado() ?? DRE.preco_referencia_t), 2);
    }
    if (document.activeElement !== margemEl) {
      margemEl.value = S.comercial.modo_preco === "margem" && S.comercial.margem !== "" ? S.comercial.margem : (r.anos.length ? fmt(r.dre.margem * 100, 2, 2) : "");
    }
    venda.classList.toggle("invalid", S.comercial.modo_preco === "preco" && S.comercial.preco_t !== "" && precoInformado() === null);
    margemEl.classList.toggle("invalid", S.comercial.modo_preco === "margem" && S.comercial.margem !== "" && margemInformada() === null);
    venda.classList.toggle("fixo", S.comercial.modo_preco === "preco");
    margemEl.classList.toggle("fixo", S.comercial.modo_preco === "margem");
    $("#usarReferencia").textContent = `Referência ${money(DRE.preco_referencia_t)}/t`;
    $("#dreModo").innerHTML = !r.anos.length ? "" : (r.regime === "plano"
      ? "Até 5 t vale o plano; a DRE abaixo é só informativa."
      : porMargem
        ? `Margem definida em <b>${pct(margemInformada() * 100)}</b> → preço recalculado para <b>${money(r.precoT)}/t</b>${r.descPct ? " (já considerando o desconto)" : ""}.`
        : `Preço definido em <b>${money(r.precoT)}/t</b>${S.comercial.preco_t === "" ? " (referência da planilha)" : ""} → margem do contrato <b>${pct(r.dre.margem * 100)}</b>. Digite uma margem para recalcular o preço.`);
    $("#cenarios").innerHTML = !r.anos.length || r.regime === "plano" ? "" : "Cenários:" + DRE.cenarios_margem.map((m) => {
      const p = precoParaMargem(r.custos, S.comercial.classe_mo, m, r.descFixo.pct, r.descFixo.valor);
      const atual = porMargem && Math.abs(margemInformada() - m) < 1e-9;
      return `<button type="button" class="${atual ? "atual" : ""}" data-cenario="${fmt(m * 100, 2, 0)}"><b>${pct(m * 100)}</b>${money(p)}/t · ${money(comDesconto(r.totalCompensar * p, r.descFixo))}</button>`;
    }).join("");

    const d = r.dre;
    const linha = (rotulo, v, cls = "") => `<tr class="${cls}"><td>${rotulo}</td><td>${money(v)}</td></tr>`;
    const alvo = margemAlvo();
    $("#dre").innerHTML = !r.anos.length ? "" : `
      <table><tbody>
        ${linha("Faturamento", d.F, "tot")}
        ${linha(`COFINS (${pct(DRE.cofins * 100)})`, -d.cofins, "sub")}
        ${linha(`PIS (${pct(DRE.pis * 100)})`, -d.pis, "sub")}
        ${linha("Receita líquida", d.receitaLiquida, "tot")}
        ${linha("Custo direto", -d.custos.total, "tot")}
        ${linha("Crédito (tabela por UF)", -d.custos.credito, "sub")}
        ${linha(`Rec+ (${pct(DRE.rec_pct * 100)} × ${pct(DRE.taxa_rec * 100)})`, -d.custos.rec, "sub")}
        ${linha("Custódia (coop)", -d.custos.custodia, "sub")}
        ${linha("Auditoria", -d.custos.auditoria, "sub")}
      </tbody></table>
      <table><tbody>
        ${linha("Lucro bruto", d.lucroBruto, "tot")}
        ${linha(`IR (${pct(DRE.ir * 100)})`, -d.ir, "sub")}
        ${linha(`CSLL (${pct(DRE.csll * 100)})`, -d.csll, "sub")}
        ${DRE.subtrair_ir_adicional ? linha("IR adicional", -d.irAdicional, "sub") : ""}
        ${linha("Lucro líquido", d.lucroLiquido, "tot")}
        ${linha(`Mão de obra classe ${S.comercial.classe_mo}`, -d.equipe, "sub")}
        ${linha(`Comissão (${pct(DRE.comissao_pct * 100)})`, -d.comissao, "sub")}
        ${linha("Resultado final", d.resultado, "res")}
      </tbody></table>
      <div class="margem ${d.margem < alvo - 1e-9 ? "baixa" : ""}">Margem <b>${pct(d.margem * 100)}</b>
        · referência ${pct(alvo * 100)}
        ${!dreAtivo ? "· (informativo: até 5 t vale o plano)" : ""}
        ${!DRE.subtrair_ir_adicional && d.irAdicional > 0 ? `· IR adicional de ${money(d.irAdicional)} não descontado (como na planilha)` : ""}</div>`;
  }

  function renderValoresAno(r) {
    if (!r.anos.length) { $("#valoresAno").innerHTML = ""; return; }
    const linhaDesconto = r.desconto
      ? `<tr><td>Desconto</td><td></td><td>${pct(r.descPct * 100)}</td><td>− ${money(r.desconto)}</td></tr>` : "";
    $("#valoresAno").innerHTML = `<table class="mini-table">
      <thead><tr><th>Ano-base</th><th>A compensar (t)</th><th>Rateio</th><th>Valor</th></tr></thead>
      <tbody>${r.anos.map((y) => {
        const c = soma(r.porAno[y].compensar);
        return `<tr><td>${y}</td><td>${fmt(c, 3, 3)}</td><td>${pct(r.totalCompensar ? (c / r.totalCompensar) * 100 : 0)}</td><td>${money(c * r.fator)}</td></tr>`;
      }).join("")}${linhaDesconto}</tbody>
      <tfoot><tr><td>Total do contrato</td><td>${fmt(r.totalCompensar, 3, 3)}</td><td>${money(r.fator)}/t</td><td>${money(r.total)}</td></tr></tfoot>
    </table>`;
  }

  // ---------- desconto em R$ ou % (um calcula o outro) ----------
  function renderDesconto(r) {
    const valorEl = $("#descontoValor");
    const pctEl = $("#descontoPct");
    const porValor = S.comercial.desconto_modo === "valor";
    if (document.activeElement !== valorEl) {
      valorEl.value = porValor ? S.comercial.desconto_valor : (r.desconto ? fmt(r.desconto, 2) : "");
    }
    if (document.activeElement !== pctEl) {
      pctEl.value = porValor ? (r.desconto ? fmt(r.descPct * 100, 2, 2) : "") : S.comercial.desconto_percentual;
    }
    valorEl.classList.toggle("fixo", porValor && S.comercial.desconto_valor !== "");
    pctEl.classList.toggle("fixo", !porValor && S.comercial.desconto_percentual !== "");
    const vValor = num(S.comercial.desconto_valor);
    valorEl.classList.toggle("invalid", porValor && S.comercial.desconto_valor !== "" && !(Number.isFinite(vValor) && vValor >= 0));
    const vPct = num(S.comercial.desconto_percentual);
    pctEl.classList.toggle("invalid", !porValor && S.comercial.desconto_percentual !== "" && !(Number.isFinite(vPct) && vPct >= 0 && vPct <= 100));
  }

  $("#descontoValor").addEventListener("input", (e) => {
    S.comercial.desconto_modo = "valor";
    S.comercial.desconto_valor = e.target.value;
    atualizarTudo({ grade: false });
  });
  $("#descontoPct").addEventListener("input", (e) => {
    S.comercial.desconto_modo = "pct";
    S.comercial.desconto_percentual = e.target.value;
    atualizarTudo({ grade: false });
  });
  ["#descontoValor", "#descontoPct"].forEach((sel) => $(sel).addEventListener("focusout", () => setTimeout(() => atualizarTudo({ grade: false }), 0)));

  const dlgPrecos = $("#precosDialog");
  function renderGradePrecos() {
    $("#precosSub").textContent = `Vigência ${CFG.precos.vigencia}. Os valores editados valem só para esta proposta; a tabela padrão não muda.`;
    $("#precosGrid").innerHTML = `<thead><tr><th>UF</th>${CAT.map((c) => `<th>${titulo(c)} (R$/t)</th>`).join("")}</tr></thead>
      <tbody>${ESTADOS.map((uf) => `<tr><td>${uf}</td>${CAT.map((_, j) => {
        const bruto = S.comercial.precos_uf[uf]?.[j] ?? "";
        const editado = precoEditado(uf, j) !== null && Math.abs(precoEditado(uf, j) - precoPadrao(uf, j)) > 1e-9;
        return `<td><input type="text" inputmode="decimal" data-puf="${uf}" data-pcat="${j}" class="${editado ? "edited" : ""}"
          value="${bruto !== "" ? bruto : fmt(precoPadrao(uf, j), 2)}" title="Padrão: ${money(precoPadrao(uf, j))}" aria-label="${uf} ${titulo(CAT[j])}"></td>`;
      }).join("")}</tr>`).join("")}</tbody>`;
  }
  $("#abrirPrecos").addEventListener("click", () => { renderGradePrecos(); dlgPrecos.showModal(); });
  $("#precosGrid").addEventListener("input", (e) => {
    const inp = e.target.closest("[data-puf]");
    if (!inp) return;
    const { puf: uf, pcat } = inp.dataset;
    const j = +pcat;
    const v = num(inp.value);
    const ok = Number.isFinite(v) && v >= 0;
    inp.classList.toggle("bad", !ok);
    const linha = (S.comercial.precos_uf[uf] ||= CAT.map(() => ""));
    linha[j] = ok && Math.abs(v - precoPadrao(uf, j)) < 1e-9 ? "" : inp.value;
    if (linha.every((x) => x === "")) delete S.comercial.precos_uf[uf];
    inp.classList.toggle("edited", ok && Math.abs(v - precoPadrao(uf, j)) > 1e-9);
    atualizarTudo({ grade: false });
  });
  $("#restaurarPrecos").addEventListener("click", () => {
    S.comercial.precos_uf = {};
    renderGradePrecos();
    atualizarTudo({ grade: false });
    toast("Tabela de preços padrão restaurada para esta proposta.", "ok");
  });
  dlgPrecos.addEventListener("click", (e) => {
    if (e.target === dlgPrecos || e.target.closest("[data-close]")) dlgPrecos.close();
  });

  // ---------- campos de cliente/proposta ----------
  function mascaraCNPJ(v) {
    const d = v.replace(/\D/g, "").slice(0, 14);
    return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
  }

  function preencherCampos() {
    $$("[data-bind]").forEach((el) => (el.value = getPath(el.dataset.bind) ?? ""));
  }

  document.addEventListener("input", (e) => {
    const el = e.target.closest("[data-bind]");
    if (!el) return;
    if (el.dataset.mask === "cnpj") el.value = mascaraCNPJ(el.value);
    el.classList.remove("invalid");
    setPath(el.dataset.bind, el.value);
    atualizarTudo({ grade: false });
  });

  function validadeAte() {
    const dias = parseInt(S.proposta.validade_dias, 10);
    if (!S.proposta.data || !Number.isFinite(dias)) return "—";
    const d = new Date(`${S.proposta.data}T12:00:00`);
    d.setDate(d.getDate() + dias);
    return d.toLocaleDateString("pt-BR");
  }

  // ---------- resumo ----------
  let totalExibido = 0;

  function renderResumo(r) {
    $("#sumNumero").textContent = S.proposta.numero || "Sem número";
    $("#sumCliente").textContent = S.cliente.razao_social.trim() || "Cliente não informado";
    $("#sumDeclarado").textContent = ton(r.totalDeclarado);
    $("#sumCompensar").textContent = ton(r.totalCompensar);
    $("#sumEstados").textContent = r.estados.length || (r.anos.length ? "Nacional" : 0);
    $("#sumAnos").textContent = r.anos.length
      ? r.anos.map((y) => (modo(y) === "nacional" ? `${y} (BR)` : y)).join(", ") : "—";
    const regimeTxt = !r.anos.length ? "" : r.regime === "plano"
      ? `Plano até ${fmt(r.plano.ate_t, 0)} t · ${money(r.plano.preco_t)}/t`
      : `DRE · ${money(r.precoT)}/t · margem ${pct(r.dre.margem * 100)}`;
    $("#sumDesconto").textContent = [regimeTxt, r.desconto
      ? `subtotal ${money(r.subtotal)} − ${fmt(r.descPct * 100, 2, 0)}% (${money(r.desconto)})` : ""].filter(Boolean).join(" · ");
    $("#validadeAte").value = validadeAte();

    const el = $("#sumTotal");
    if (hasAnime() && Math.abs(r.total - totalExibido) > 0.005) {
      const obj = { v: totalExibido };
      anime.remove(el);
      anime({ targets: obj, v: r.total, duration: 450, easing: "easeOutCubic", update: () => (el.textContent = money(obj.v)) });
    } else {
      el.textContent = money(r.total);
    }
    totalExibido = r.total;

    const max = Math.max(...r.compensar, 0);
    const itens = MATERIAIS.map((_, i) => i).filter((i) => r.compensar[i] > 0)
      .sort((a, b) => r.compensar[b] - r.compensar[a]).slice(0, 5);
    $("#sumBars").innerHTML = itens.map((i) => `<div class="bar-row">
      <span class="label" title="${nomeMaterial(i)}">${nomeMaterial(i)}</span>
      <span class="track"><span class="fill" style="width:${(r.compensar[i] / max) * 100}%"></span></span>
      <span class="val">${ton(r.compensar[i])}</span></div>`).join("");

    const alertas = [];
    if (!S.cliente.razao_social.trim()) alertas.push("Informe a razão social do cliente (obrigatória para PPT e PDF).");
    if (!r.anos.length) alertas.push("Nenhum volume informado ainda.");
    const recInvalidas = r.anos.filter((y) => recuperacaoValida(y) === null || ufsDoAno(y).some((uf) => ajusteInvalido(y, uf)));
    if (recInvalidas.length) alertas.push(`Recuperação fora do intervalo (mínimo legal a 100%) em ${recInvalidas.join(", ")}.`);
    if (r.semDistribuicao.length) alertas.push(`Tabela CONFAZ não cadastrada para ${r.semDistribuicao.join(", ")}: sem distribuição por UF e sem planilha desse ano.`);
    const provisorias = r.anos.filter((y) => modo(y) === "nacional" && CFG.confaz_origem[y] && String(CFG.confaz_origem[y]) !== y);
    if (provisorias.length) alertas.push(`${provisorias.join(", ")} usa a tabela CONFAZ de ${CFG.confaz_origem[provisorias[0]]} (a do ano ainda não foi validada).`);
    const semGuia = r.anos.filter((y) => !CFG.anos_planilha.map(String).includes(y));
    if (semGuia.length) alertas.push(`A planilha modelo não tem a guia ${semGuia.join(", ")}.`);
    const editados = precosEditados().length;
    if (editados) alertas.push(`${editados} custo(s) por tonelada editado(s) nesta proposta.`);
    if (r.anos.length && r.regime === "dre" && r.dre.margem < 0) alertas.push(`Contrato com prejuízo: margem da DRE de ${pct(r.dre.margem * 100)}.`);
    else if (r.anos.length && r.regime === "dre" && r.dre.margem < margemAlvo() - 1e-9) alertas.push(`Margem do contrato (${pct(r.dre.margem * 100)}) abaixo da referência de ${pct(margemAlvo() * 100)}.`);
    if ($$("#gridBody input.bad").length) alertas.push(`Há células com valor inválido em ${S.anoAtivo}; elas não entram no cálculo.`);
    if (!CFG.modelo_ppt) alertas.push("Modelo PowerPoint ainda não está em modelo/Proposta_Comercial.pptx.");
    $("#alerts").innerHTML = alertas.map((a) => `<li>${a}</li>`).join("");

    $('[data-step="cliente"]').classList.toggle("done", !!S.cliente.razao_social.trim());
    $('[data-step="volumes"]').classList.toggle("done", r.anos.length > 0);
    $('[data-step="precos"]').classList.toggle("done", r.anos.length > 0 && !recInvalidas.length);
  }

  function atualizarTudo({ grade = true } = {}) {
    if (grade) preencherGrade();
    const r = calcular();
    renderAnos();
    renderNacional();
    renderRecuperacao();
    renderPrecosCard();
    renderPreco(r);
    renderDesconto(r);
    renderValoresAno(r);
    MATERIAIS.forEach((_, i) => ($(`[data-col-head="${i}"]`, grid.head).textContent = nomeMaterial(i)));
    renderResumo(r);
    salvar();
  }

  // ---------- ações ----------
  function payload() {
    const anos = {};
    const nacional = {};
    const recuperacaoPayload = {};
    anosComVolume().forEach((y) => {
      if (modo(y) === "nacional") nacional[y] = S.nacional[y];
      else anos[y] = S.anos[y];
      const r = recObj(y);
      const estados = {};
      ufsDoAno(y).forEach((uf) => { if ((r.estados[uf] ?? "") !== "") estados[uf] = r.estados[uf]; });
      recuperacaoPayload[y] = { nacional: r.nacional, estados };
    });
    const precos_uf = {};
    Object.entries(S.comercial.precos_uf).forEach(([uf, vals]) => {
      if (vals.some((v) => v !== "")) precos_uf[uf] = vals;
    });
    return {
      cliente: S.cliente,
      proposta: S.proposta,
      comercial: {
        precos_uf,
        classe_mo: S.comercial.classe_mo,
        modo_preco: S.comercial.modo_preco,
        margem: S.comercial.margem,
        preco_t: S.comercial.preco_t,
        desconto_percentual: S.comercial.desconto_percentual,
        desconto_modo: S.comercial.desconto_modo,
        desconto_valor: S.comercial.desconto_valor,
      },
      anos,
      nacional,
      recuperacao: recuperacaoPayload,
    };
  }

  function nomeDoHeader(header, padrao) {
    if (!header) return padrao;
    const utf = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf) return decodeURIComponent(utf[1]);
    const simples = header.match(/filename="?([^";]+)"?/i);
    return simples ? simples[1] : padrao;
  }

  async function baixar(url, corpo, botao, padrao) {
    botao.disabled = true;
    botao.classList.add("loading");
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      });
      if (!res.ok) {
        let msg = "Não foi possível gerar o arquivo.";
        try { const j = await res.json(); if (j.erro) msg = j.erro; } catch (_) { /* resposta sem JSON */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href, download: nomeDoHeader(res.headers.get("Content-Disposition"), padrao) });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      return res;
    } finally {
      botao.disabled = false;
      botao.classList.remove("loading");
    }
  }

  function exigir({ cliente }) {
    if (!anosComVolume().length) {
      toast("Informe o volume de pelo menos um estado ou da compensação nacional.", "error");
      location.hash = "#volumes";
      return false;
    }
    const invalidas = anosComVolume().filter((y) => recuperacaoValida(y) === null || ufsDoAno(y).some((uf) => ajusteInvalido(y, uf)));
    if (invalidas.length) {
      toast(`Ajuste a recuperação de ${invalidas.join(", ")} (entre o mínimo legal e 100%).`, "error");
      location.hash = "#precos";
      return false;
    }
    if (cliente && !S.cliente.razao_social.trim()) {
      const campo = $('[data-bind="cliente.razao_social"]');
      campo.classList.add("invalid");
      campo.focus();
      toast("Informe a razão social do cliente.", "error");
      return false;
    }
    return true;
  }

  $("#btnExcel").addEventListener("click", async (e) => {
    if (!exigir({ cliente: false })) return;
    try {
      await baixar("/gerar-excel", payload(), e.currentTarget, "Autodeclaracao_volume_embalagens_preenchida.xlsx");
      toast("Planilha gerada. O download foi iniciado.", "ok");
    } catch (err) { toast(err.message, "error"); }
  });

  $("#btnPpt").addEventListener("click", async (e) => {
    if (!exigir({ cliente: true })) return;
    try {
      const res = await baixar("/atualizar-proposta", payload(), e.currentTarget, "Proposta_Comercial.pptx");
      const pendentes = res.headers.get("X-Marcadores-Pendentes");
      if (pendentes) toast(`Proposta gerada, mas o modelo tem marcadores desconhecidos: ${pendentes}`, "warn");
      else toast(`Proposta comercial atualizada. O download foi iniciado.${msgRegistro(res)}`, "ok");
    } catch (err) { toast(err.message, "error"); }
  });

  $("#btnPdf").addEventListener("click", async (e) => {
    if (!exigir({ cliente: true })) return;
    try {
      toast("Gerando o PDF da proposta… pode levar alguns segundos.", "");
      const res = await baixar("/gerar-pdf", payload(), e.currentTarget, "Proposta_Comercial.pdf");
      toast(`PDF da proposta gerado. O download foi iniciado.${msgRegistro(res)}`, "ok");
    } catch (err) { toast(err.message, "error"); }
  });

  $("#novaProposta").addEventListener("click", () => {
    if (!confirm("Começar uma nova proposta? O painel será limpo (o responsável é mantido). Propostas já geradas continuam no registro.")) return;
    S = estadoInicial(S);
    recarregarTela();
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("Nova proposta iniciada.", "ok");
  });

  // ---------- registro de propostas ----------
  function msgRegistro(res) {
    const st = res.headers.get("X-Registro");
    if (st === "ok") return " Proposta salva no registro.";
    if (st === "aviso") return " Proposta salva no registro (feche a planilha do registro no Excel para atualizá-la).";
    if (st === "erro") return " Não foi possível salvar no registro.";
    return "";
  }

  function recarregarTela() {
    abertos.clear();
    $("#recuperacao").dataset.chave = "";
    preencherCampos();
    montarPlanos();
    atualizarTudo();
  }

  $("#salvarRegistro").addEventListener("click", async () => {
    if (!exigir({ cliente: true })) return;
    try {
      const res = await fetch("/propostas", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()),
      });
      const j = await res.json();
      if (!res.ok || !j.sucesso) throw new Error(j.erro || "Não foi possível salvar.");
      toast(j.aviso || `Proposta ${j.numero} salva no registro.`, j.aviso ? "warn" : "ok");
    } catch (err) { toast(err.message, "error"); }
  });

  const dlgReg = $("#registroDialog");
  let registros = [];
  $("#registroStatus").innerHTML += CFG.status.map((st) => `<option value="${st}">${st}</option>`).join("");

  async function carregarRegistro() {
    try {
      const res = await fetch("/propostas");
      registros = (await res.json()).propostas || [];
    } catch (_) {
      registros = [];
      toast("Não foi possível ler o registro de propostas.", "error");
    }
    renderRegistro();
  }

  const valorFinal = (d) => (d.registro.valor_negociado ?? d.resumo.total);
  const dataBR = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");

  function renderRegistro() {
    const busca = normaliza($("#registroBusca").value || "");
    const status = $("#registroStatus").value;
    const lista = registros.filter((d) => (!status || d.registro.status === status) &&
      (!busca || normaliza([d.numero, d.resumo.cliente, d.resumo.cnpj, d.resumo.responsavel].join(" ")).includes(busca)));

    const ganhas = registros.filter((d) => d.registro.status === "Ganha");
    const abertas = registros.filter((d) => ["Enviada", "Em negociação", "Em elaboração"].includes(d.registro.status));
    $("#registroKpis").innerHTML = `
      <div><span>Propostas</span><strong>${registros.length}</strong></div>
      <div><span>Em aberto</span><strong>${abertas.length} · ${money(soma(abertas.map(valorFinal)))}</strong></div>
      <div class="win"><span>Ganhas</span><strong>${ganhas.length} · ${money(soma(ganhas.map(valorFinal)))}</strong></div>
      <div><span>Massa ganha a compensar</span><strong>${ton(soma(ganhas.map((d) => d.resumo.compensar)))}</strong></div>`;

    const cab = `<thead><tr><th>Nº</th><th>Cliente</th><th>Data</th><th>A compensar</th><th>Valor proposta</th>
      <th>Valor negociado</th><th>Status</th><th>Data da venda</th><th></th></tr></thead>`;
    if (!lista.length) {
      $("#registroTabela").innerHTML = `${cab}<tbody><tr><td colspan="9" class="reg-empty">${registros.length
        ? "Nenhuma proposta com esses filtros." : "Nenhuma proposta registrada ainda. Gere o PDF ou o PPT, ou use “Salvar no registro”."}</td></tr></tbody>`;
      return;
    }
    $("#registroTabela").innerHTML = cab + `<tbody>${lista.map((d) => `<tr data-num="${d.numero}">
      <td>${d.numero}</td>
      <td>${d.resumo.cliente}<small>${[d.resumo.cnpj, d.resumo.responsavel].filter(Boolean).join(" · ")} · ${d.resumo.anos.slice().sort().join(", ")}</small></td>
      <td>${dataBR(d.resumo.data_proposta)}</td>
      <td>${fmt(d.resumo.compensar, 3, 3)} t</td>
      <td>${money(d.resumo.total)}</td>
      <td><input type="text" inputmode="decimal" data-neg value="${d.registro.valor_negociado !== null && d.registro.valor_negociado !== undefined ? fmt(d.registro.valor_negociado, 2) : ""}" placeholder="—" aria-label="Valor negociado"></td>
      <td><select data-st class="st-${(d.registro.status || "").replace(/\s/g, "")}" aria-label="Status">${CFG.status.map((st) => `<option ${st === d.registro.status ? "selected" : ""}>${st}</option>`).join("")}</select></td>
      <td><input type="date" data-venda value="${d.registro.data_venda || ""}" aria-label="Data da venda"></td>
      <td><div class="acoes"><button class="btn btn-ghost btn-sm" type="button" data-abrir>Abrir</button>
        <button class="btn btn-danger-ghost btn-sm" type="button" data-excluir aria-label="Excluir">×</button></div></td>
    </tr>`).join("")}</tbody>`;
  }

  async function patchRegistro(numero, campos) {
    try {
      const res = await fetch(`/propostas/${encodeURIComponent(numero)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(campos),
      });
      const j = await res.json();
      if (!res.ok || !j.sucesso) throw new Error(j.erro || "Não foi possível atualizar.");
      const d = registros.find((x) => x.numero === numero);
      if (d) d.registro = j.registro;
      renderRegistro();
      toast(j.aviso || "Registro atualizado.", j.aviso ? "warn" : "ok");
    } catch (err) { toast(err.message, "error"); }
  }

  $("#abrirRegistro").addEventListener("click", () => { dlgReg.showModal(); carregarRegistro(); });
  $("#registroBusca").addEventListener("input", renderRegistro);
  $("#registroStatus").addEventListener("change", renderRegistro);
  dlgReg.addEventListener("click", async (e) => {
    if (e.target === dlgReg || e.target.closest("[data-close]")) return dlgReg.close();
    const tr = e.target.closest("tr[data-num]");
    if (!tr) return;
    const numero = tr.dataset.num;
    if (e.target.closest("[data-abrir]")) {
      if (anosComVolume().length && !confirm(`Abrir a proposta ${numero}? O que está no painel agora será substituído.`)) return;
      try {
        const res = await fetch(`/propostas/${encodeURIComponent(numero)}`);
        const j = await res.json();
        if (!res.ok || !j.sucesso) throw new Error(j.erro || "Não foi possível abrir.");
        S = normalizarEstado(j.proposta.payload);
        recarregarTela();
        dlgReg.close();
        window.scrollTo({ top: 0, behavior: "smooth" });
        toast(`Proposta ${numero} aberta no painel.`, "ok");
      } catch (err) { toast(err.message, "error"); }
    }
    if (e.target.closest("[data-excluir]")) {
      if (!confirm(`Excluir a proposta ${numero} do registro? Essa ação não pode ser desfeita.`)) return;
      const res = await fetch(`/propostas/${encodeURIComponent(numero)}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok || !j.sucesso) return toast(j.erro || "Não foi possível excluir.", "error");
      registros = registros.filter((x) => x.numero !== numero);
      renderRegistro();
      toast(j.aviso || `Proposta ${numero} excluída do registro.`, j.aviso ? "warn" : "ok");
    }
  });
  dlgReg.addEventListener("change", (e) => {
    const tr = e.target.closest("tr[data-num]");
    if (!tr) return;
    if (e.target.matches("[data-st]")) patchRegistro(tr.dataset.num, { status: e.target.value });
    if (e.target.matches("[data-venda]")) patchRegistro(tr.dataset.num, { data_venda: e.target.value });
    if (e.target.matches("[data-neg]")) {
      const v = num(e.target.value);
      if (e.target.value.trim() !== "" && !(Number.isFinite(v) && v >= 0)) return toast("Valor negociado inválido.", "error");
      patchRegistro(tr.dataset.num, { valor_negociado: e.target.value.trim() === "" ? "" : v });
    }
  });

  // ---------- marcadores ----------
  const dialog = $("#marcadoresDialog");
  $("#verMarcadores").addEventListener("click", () => {
    $("#modeloStatus").innerHTML = CFG.modelo_ppt
      ? "Modelo encontrado em <code>modelo/Proposta_Comercial.pptx</code>. Escreva os marcadores abaixo em qualquer caixa de texto ou tabela do PowerPoint. Clique para copiar."
      : "Salve o PowerPoint em <code>modelo/Proposta_Comercial.pptx</code> usando os marcadores abaixo. Clique para copiar.";
    $("#marcadoresList").innerHTML = CFG.marcadores.map((m) =>
      `<code data-copy="${m.marcador}">${m.marcador}</code><span>${m.descricao}</span>`).join("");
    dialog.showModal();
  });
  dialog.addEventListener("click", async (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) return dialog.close();
    const code = e.target.closest("[data-copy]");
    if (!code) return;
    try { await navigator.clipboard.writeText(code.dataset.copy); toast(`${code.dataset.copy} copiado.`, "ok"); }
    catch (_) { toast("Não foi possível copiar automaticamente.", "warn"); }
  });

  // ---------- etapas ativas no scroll ----------
  const pills = $$(".step-pill");
  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) pills.forEach((p) => p.classList.toggle("active", p.dataset.step === en.target.id));
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    ["cliente", "volumes", "precos"].forEach((id) => obs.observe(document.getElementById(id)));
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg, tipo = "") {
    const el = $("#toast");
    el.className = `toast ${tipo}`;
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), tipo === "warn" || tipo === "error" ? 7000 : 4000);
  }

  // Resumo da proposta atual para o registro da versão de demonstração (static/js/demo.js).
  window.__demoResumo = () => {
    const r = calcular();
    return {
      cliente: S.cliente.razao_social, cnpj: S.cliente.cnpj, responsavel: S.proposta.responsavel,
      data_proposta: S.proposta.data, anos: r.anos.map(Number),
      declarado: r.totalDeclarado, compensar: r.totalCompensar, subtotal: r.subtotal, total: r.total,
      regra_preco: r.regime === "plano" ? `Plano até ${r.plano.ate_t} t` : "DRE (acima de 5 t)",
      margem: r.dre.margem,
    };
  };

  // ---------- início ----------
  montarGrade();
  recarregarTela();

  if (hasAnime()) {
    anime({
      targets: ".reveal", opacity: [0, 1], translateY: [14, 0], duration: 600,
      delay: anime.stagger(80), easing: "easeOutCubic",
      complete: () => document.documentElement.classList.remove("js-anim"),
    });
  } else {
    document.documentElement.classList.remove("js-anim");
  }
})();
