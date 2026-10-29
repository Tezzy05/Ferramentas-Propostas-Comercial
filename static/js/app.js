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
        observacoes: "",
      },
      comercial: {
        precos: base ? base.comercial.precos.slice() : CFG.precos.map(Number),
        desconto_percentual: "",
        outro_material_nome: "",
      },
      anos: {},        // modo "estados": {ano: {UF: [10]}}
      nacional: {},    // modo "nacional": {ano: [10]}
      modo: {},        // {ano: "estados" | "nacional"}
      recuperacao: {}, // {ano: "40"} em %
      anoAtivo: ANOS[0],
    };
  }

  const vetor = (vals) => (Array.isArray(vals) && vals.length === NM
    ? vals.map((v) => (Number.isFinite(+v) && +v > 0 ? +v : 0)) : null);

  function carregar() {
    const padrao = estadoInicial();
    try {
      const salvo = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!salvo) return padrao;
      const s = {
        ...padrao,
        cliente: { ...padrao.cliente, ...salvo.cliente },
        proposta: { ...padrao.proposta, ...salvo.proposta },
        comercial: { ...padrao.comercial, ...salvo.comercial },
        anoAtivo: ANOS.includes(salvo.anoAtivo) ? salvo.anoAtivo : padrao.anoAtivo,
      };
      delete s.comercial.metas;
      if (!vetor(s.comercial.precos)) s.comercial.precos = padrao.comercial.precos;
      for (const [y, ufs] of Object.entries(salvo.anos || {})) {
        if (!ANOS.includes(y)) continue;
        for (const [uf, vals] of Object.entries(ufs)) {
          if (ESTADOS.includes(uf) && vetor(vals)) (s.anos[y] ||= {})[uf] = vetor(vals);
        }
      }
      for (const [y, vals] of Object.entries(salvo.nacional || {})) {
        if (ANOS_NACIONAL.includes(y) && vetor(vals)) s.nacional[y] = vetor(vals);
      }
      for (const [y, m] of Object.entries(salvo.modo || {})) {
        if (m === "nacional" && ANOS_NACIONAL.includes(y)) s.modo[y] = m;
      }
      for (const [y, v] of Object.entries(salvo.recuperacao || {})) {
        if (ANOS.includes(y)) s.recuperacao[y] = String(v);
      }
      return s;
    } catch (_) {
      return padrao;
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
  const temDados = (y) => (modo(y) === "nacional"
    ? !!S.nacional[y]?.some((v) => v > 0)
    : Object.keys(S.anos[y] || {}).length > 0);

  const anosComVolume = () => ANOS.filter(temDados);

  function recuperacaoValida(y) {
    const bruto = S.recuperacao[y];
    if (bruto === undefined || bruto === "") return minimo(y);
    const v = num(bruto);
    return Number.isFinite(v) && v >= minimo(y) - 1e-9 && v <= 100 ? v : null;
  }
  const recuperacao = (y) => recuperacaoValida(y) ?? minimo(y);
  const pctUF = (y, uf, rec = recuperacao(y)) => Math.max(rec, metaUF(y, uf)) / 100;

  function distribuir(y, totais) {
    const tabela = CFG.confaz[y];
    if (!tabela) return null;
    const out = {};
    ESTADOS.forEach((uf) => { if (tabela[uf] > 0) out[uf] = totais.map((v) => (v * tabela[uf]) / 100); });
    return out;
  }

  // Calcula um ano isolado; usado pelo resumo, pela tela nacional e pelo assistente.
  function calcAno(y, { totais, rec } = {}) {
    const r = rec ?? recuperacao(y);
    const nacional = totais !== undefined || modo(y) === "nacional";
    const tot = totais ?? S.nacional[y] ?? Array(NM).fill(0);
    const estados = nacional ? distribuir(y, tot) : (S.anos[y] || {});
    const declarado = Array(NM).fill(0);
    const compensar = Array(NM).fill(0);
    const linhas = [];
    if (estados) {
      ESTADOS.forEach((uf) => {
        const vals = estados[uf];
        if (!vals) return;
        const p = pctUF(y, uf, r);
        vals.forEach((v, i) => { declarado[i] += v; compensar[i] += v * p; });
        linhas.push({ uf, p, declarado: soma(vals), compensar: soma(vals) * p, vals });
      });
    } else {
      const p = Math.max(r, minimo(y)) / 100;
      tot.forEach((v, i) => { declarado[i] = v; compensar[i] = v * p; });
    }
    return { nacional, distribuido: !!estados, rec: r, declarado, compensar, linhas };
  }

  function calcular() {
    const declarado = Array(NM).fill(0);
    const compensar = Array(NM).fill(0);
    const estados = new Set();
    const precos = S.comercial.precos.map((p) => (Number.isFinite(+p) ? +p : 0));
    const anos = anosComVolume();
    let semDistribuicao = [];

    for (const y of anos) {
      const c = calcAno(y);
      c.declarado.forEach((v, i) => (declarado[i] += v));
      c.compensar.forEach((v, i) => (compensar[i] += v));
      c.linhas.forEach((l) => estados.add(l.uf));
      if (!c.distribuido) semDistribuicao.push(y);
    }
    const valor = compensar.map((v, i) => v * precos[i]);
    const subtotal = soma(valor);
    const desc = Math.min(Math.max(num(S.comercial.desconto_percentual) || 0, 0), 100) / 100;
    return {
      anos, declarado, compensar, valor, precos, subtotal, semDistribuicao,
      estados: [...estados],
      totalDeclarado: soma(declarado),
      totalCompensar: soma(compensar),
      desconto: subtotal * desc,
      descPct: desc,
      total: subtotal * (1 - desc),
      semPreco: MATERIAIS.map((_, i) => i).filter((i) => compensar[i] > 0 && !precos[i]),
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
    const origem = regra(y).origem === "planilha" ? " (meta da planilha modelo — regra do ano não cadastrada)" : "";
    nota.innerHTML = `Para ${y}: ${textoRegra(y)}${origem}`;
    nota.classList.toggle("warn", regra(y).origem === "planilha");

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
    S.recuperacao[y] = wiz.rec;
    S.anoAtivo = y;
    dlg.close();
    atualizarTudo();
    toast(`Compensação nacional de ${y} confirmada.`, "ok");
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });
  $("#abrirConfaz").addEventListener("click", () => abrirAssistente(ANOS_NACIONAL.includes(S.anoAtivo) && modo(S.anoAtivo) === "nacional" ? S.anoAtivo : null));

  // ---------- recuperação e preços ----------
  function montarPrecos() {
    $("#priceTable").innerHTML = MATERIAIS.map((_, i) => `<div class="price-row" data-price-row="${i}">
      <div class="name"><span data-price-name="${i}"></span><span class="vol" data-price-vol="${i}"></span></div>
      <label class="money"><span>R$/t</span><input type="text" inputmode="decimal" data-preco="${i}" aria-label="Preço por tonelada"></label>
    </div>`).join("");
    $$("[data-preco]").forEach((inp) => (inp.value = fmt(+S.comercial.precos[inp.dataset.preco] || 0, 2)));
  }

  function renderRecuperacao() {
    const anos = anosComVolume();
    const box = $("#recuperacao");
    const atuais = $$("[data-rec-row]", box).map((el) => el.dataset.recRow).join(",");
    if (atuais === anos.join(",") && anos.length) {
      // Só atualiza textos para não perder o foco de quem está digitando.
      anos.forEach((y) => {
        const v = recuperacaoValida(y);
        $(`[data-rec-row="${y}"] .pct-input`, box).classList.toggle("bad", v === null);
        $(`[data-rec-row="${y}"] .rec-year span`, box).textContent = modo(y) === "nacional" ? "Nacional · CONFAZ" : "Por estados";
      });
      return;
    }
    if (!anos.length) {
      box.innerHTML = '<p class="empty-note">Informe volumes em algum ano-base para definir a recuperação.</p>';
      return;
    }
    box.innerHTML = anos.map((y) => `<div class="rec-row" data-rec-row="${y}">
      <div class="rec-year"><b>${y}</b><span>${modo(y) === "nacional" ? "Nacional · CONFAZ" : "Por estados"}</span></div>
      <div class="rec-rule">Mínimo: ${textoRegra(y)}</div>
      <div class="rec-ctl">
        <input type="range" min="${minimo(y)}" max="100" step="0.1" value="${recuperacao(y)}" data-rec-range="${y}" aria-label="Recuperação ${y}">
        <label class="pct-input"><input type="text" inputmode="decimal" data-rec="${y}" value="${fmt(recuperacao(y), 2, 0)}" aria-label="Recuperação ${y} (%)">%</label>
      </div></div>`).join("");
  }

  $("#recuperacao").addEventListener("input", (e) => {
    const txt = e.target.closest("[data-rec]");
    const rng = e.target.closest("[data-rec-range]");
    if (txt) {
      S.recuperacao[txt.dataset.rec] = txt.value;
      const v = recuperacaoValida(txt.dataset.rec);
      if (v !== null) $(`[data-rec-range="${txt.dataset.rec}"]`).value = v;
    }
    if (rng) {
      S.recuperacao[rng.dataset.recRange] = fmt(+rng.value, 2, 0);
      $(`[data-rec="${rng.dataset.recRange}"]`).value = S.recuperacao[rng.dataset.recRange];
    }
    atualizarTudo({ grade: false });
  });

  $("#priceTable").addEventListener("input", (e) => {
    const inp = e.target.closest("[data-preco]");
    if (!inp) return;
    const v = num(inp.value);
    const ok = Number.isFinite(v) && v >= 0;
    inp.closest(".money").style.boxShadow = ok ? "" : "inset 0 0 0 1.5px var(--danger)";
    if (ok) S.comercial.precos[+inp.dataset.preco] = v;
    atualizarTudo({ grade: false });
  });

  $("#priceTable").addEventListener("focusout", (e) => {
    const inp = e.target.closest("[data-preco]");
    if (inp && Number.isFinite(num(inp.value))) inp.value = fmt(num(inp.value), 2);
  });

  function renderPrecos(r) {
    MATERIAIS.forEach((_, i) => {
      $(`[data-price-name="${i}"]`).textContent = nomeMaterial(i);
      $(`[data-price-vol="${i}"]`).textContent = r.compensar[i]
        ? `${ton(r.compensar[i])} a compensar${r.precos[i] ? ` · ${money(r.valor[i])}` : " · sem preço"}`
        : "sem volume";
      $(`[data-price-row="${i}"]`).classList.toggle("missing", r.semPreco.includes(i));
      $(`[data-col-head="${i}"]`, grid.head).textContent = nomeMaterial(i);
    });
  }

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
    $("#sumDesconto").textContent = r.desconto
      ? `Subtotal ${money(r.subtotal)} · desconto ${fmt(r.descPct * 100, 2, 0)}% (− ${money(r.desconto)})` : "";
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
    if (r.semPreco.length) alertas.push(`Sem preço por tonelada: ${r.semPreco.map(nomeMaterial).join(", ")}.`);
    const recInvalidas = r.anos.filter((y) => recuperacaoValida(y) === null);
    if (recInvalidas.length) alertas.push(`Recuperação fora do intervalo (mínimo legal a 100%) em ${recInvalidas.join(", ")}.`);
    if (r.semDistribuicao.length) alertas.push(`Tabela CONFAZ não cadastrada para ${r.semDistribuicao.join(", ")}: sem distribuição por UF e sem planilha desse ano.`);
    const semGuia = r.anos.filter((y) => !CFG.anos_planilha.map(String).includes(y));
    if (semGuia.length) alertas.push(`A planilha modelo não tem a guia ${semGuia.join(", ")}.`);
    if ($$("#gridBody input.bad").length) alertas.push(`Há células com valor inválido em ${S.anoAtivo}; elas não entram no cálculo.`);
    if (!CFG.modelo_ppt) alertas.push("Modelo PowerPoint ainda não está em modelo/Proposta_Comercial.pptx.");
    $("#alerts").innerHTML = alertas.map((a) => `<li>${a}</li>`).join("");

    $('[data-step="cliente"]').classList.toggle("done", !!S.cliente.razao_social.trim());
    $('[data-step="volumes"]').classList.toggle("done", r.anos.length > 0);
    $('[data-step="precos"]').classList.toggle("done", r.anos.length > 0 && !r.semPreco.length && !recInvalidas.length);
  }

  function atualizarTudo({ grade = true } = {}) {
    if (grade) preencherGrade();
    const r = calcular();
    renderAnos();
    renderNacional();
    renderRecuperacao();
    renderPrecos(r);
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
      recuperacaoPayload[y] = S.recuperacao[y] ?? "";
    });
    return {
      cliente: S.cliente,
      proposta: S.proposta,
      comercial: {
        precos: S.comercial.precos.map((p) => (Number.isFinite(+p) ? +p : 0)),
        desconto_percentual: S.comercial.desconto_percentual,
        outro_material_nome: S.comercial.outro_material_nome,
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
    const invalidas = anosComVolume().filter((y) => recuperacaoValida(y) === null);
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
      else toast("Proposta comercial atualizada. O download foi iniciado.", "ok");
    } catch (err) { toast(err.message, "error"); }
  });

  $("#btnPdf").addEventListener("click", async (e) => {
    if (!exigir({ cliente: true })) return;
    try {
      await baixar("/gerar-pdf", payload(), e.currentTarget, "Proposta_Tecnica.pdf");
      toast("PDF da proposta técnica gerado. O download foi iniciado.", "ok");
    } catch (err) { toast(err.message, "error"); }
  });

  $("#novaProposta").addEventListener("click", () => {
    if (!confirm("Começar uma nova proposta? Os dados atuais serão apagados (responsável e preços são mantidos).")) return;
    S = estadoInicial(S);
    preencherCampos();
    montarPrecos();
    atualizarTudo();
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("Nova proposta iniciada.", "ok");
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

  // ---------- início ----------
  montarGrade();
  montarPrecos();
  preencherCampos();
  atualizarTudo();

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
