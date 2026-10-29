(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const MATERIAIS = CFG.materiais;
  const ESTADOS = CFG.estados;
  const NM = MATERIAIS.length;
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
  const cellText = (v) => (v ? fmt(v, 3, 0) : "");
  const normaliza = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const titulo = (t) => t.toLowerCase().replace(/(^|[\s/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

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
        metas: Object.fromEntries(Object.entries(CFG.metas).map(([y, v]) => [y, fmt(v, 2, 0)])),
        desconto_percentual: "",
        outro_material_nome: "",
      },
      anos: {},
      anoAtivo: String(CFG.anos[0]),
    };
  }

  function carregar() {
    const padrao = estadoInicial();
    try {
      const salvo = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!salvo) return padrao;
      const s = {
        cliente: { ...padrao.cliente, ...salvo.cliente },
        proposta: { ...padrao.proposta, ...salvo.proposta },
        comercial: { ...padrao.comercial, ...salvo.comercial },
        anos: {},
        anoAtivo: CFG.anos.map(String).includes(salvo.anoAtivo) ? salvo.anoAtivo : padrao.anoAtivo,
      };
      s.comercial.metas = { ...padrao.comercial.metas, ...(salvo.comercial?.metas || {}) };
      if (!Array.isArray(s.comercial.precos) || s.comercial.precos.length !== NM) s.comercial.precos = padrao.comercial.precos;
      for (const [y, ufs] of Object.entries(salvo.anos || {})) {
        if (!CFG.anos.map(String).includes(y)) continue;
        for (const [uf, vals] of Object.entries(ufs)) {
          if (ESTADOS.includes(uf) && Array.isArray(vals) && vals.length === NM) {
            (s.anos[y] ||= {})[uf] = vals.map((v) => (Number.isFinite(+v) && +v > 0 ? +v : 0));
          }
        }
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
  function anosComVolume() {
    return Object.keys(S.anos).filter((y) => Object.keys(S.anos[y]).length).sort((a, b) => b - a);
  }

  function calcular() {
    const declarado = Array(NM).fill(0);
    const compensar = Array(NM).fill(0);
    const valor = Array(NM).fill(0);
    const estados = new Set();
    const precos = S.comercial.precos.map((p) => (Number.isFinite(+p) ? +p : 0));
    const anos = anosComVolume();

    for (const y of anos) {
      const meta = (num(S.comercial.metas[y]) || 0) / 100;
      for (const [uf, vals] of Object.entries(S.anos[y])) {
        estados.add(uf);
        vals.forEach((v, i) => {
          declarado[i] += v;
          compensar[i] += v * meta;
          valor[i] += v * meta * precos[i];
        });
      }
    }
    const subtotal = valor.reduce((a, b) => a + b, 0);
    const desc = Math.min(Math.max(num(S.comercial.desconto_percentual) || 0, 0), 100) / 100;
    return {
      anos, declarado, compensar, valor, precos, subtotal,
      estados: [...estados],
      totalDeclarado: declarado.reduce((a, b) => a + b, 0),
      totalCompensar: compensar.reduce((a, b) => a + b, 0),
      desconto: subtotal * desc,
      descPct: desc,
      total: subtotal * (1 - desc),
      semPreco: MATERIAIS.map((_, i) => i).filter((i) => compensar[i] > 0 && !precos[i]),
    };
  }

  // ---------- grade de volumes ----------
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
      const total = vals ? vals.reduce((a, b) => a + b, 0) : 0;
      if (vals) vals.forEach((v, i) => (col[i] += v));
      $("[data-row-total]", tr).textContent = total ? fmt(total, 3, 0) : "–";
      tr.classList.toggle("filled", total > 0);
    });
    col.forEach((v, i) => ($(`[data-col-total="${i}"]`, grid.foot).textContent = fmt(v, 3, 0)));
    $("[data-grand-total]", grid.foot).textContent = ton(col.reduce((a, b) => a + b, 0));
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

  // ---------- anos ----------
  function renderAnos() {
    $("#yearTabs").innerHTML = CFG.anos.map((y) => {
      const n = Object.keys(S.anos[y] || {}).length;
      const ativo = String(y) === S.anoAtivo;
      return `<button type="button" role="tab" aria-selected="${ativo}" class="${ativo ? "active" : ""}" data-ano="${y}">
        ${y}${n ? `<span class="dot">${n}</span>` : ""}</button>`;
    }).join("");

    const dados = S.anos[S.anoAtivo] || {};
    const n = Object.keys(dados).length;
    const total = Object.values(dados).reduce((s, v) => s + v.reduce((a, b) => a + b, 0), 0);
    $("#yearMeta").innerHTML = `Meta <b>${S.comercial.metas[S.anoAtivo] || 0}%</b> · ${n} estado${n === 1 ? "" : "s"} · ${ton(total)}`;
  }

  $("#yearTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-ano]");
    if (!btn) return;
    S.anoAtivo = btn.dataset.ano;
    preencherGrade();
    renderAnos();
    salvar();
    if (hasAnime()) anime({ targets: "#gridBody tr:not(.hidden)", opacity: [0.3, 1], duration: 300, delay: anime.stagger(8), easing: "easeOutQuad" });
  });

  $("#soPreenchidos").addEventListener("change", filtrarGrade);

  $("#limparAno").addEventListener("click", () => {
    if (!S.anos[S.anoAtivo]) return toast(`Nada para limpar em ${S.anoAtivo}.`, "warn");
    if (!confirm(`Apagar todos os volumes de ${S.anoAtivo}?`)) return;
    delete S.anos[S.anoAtivo];
    preencherGrade();
    atualizarTudo();
  });

  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (anosComVolume().length && !confirm("Substituir os volumes atuais pelos da planilha importada?")) return;
    const fd = new FormData();
    fd.append("arquivo", file);
    try {
      const res = await fetch("/importar-excel", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.sucesso) throw new Error(data.erro || "Não foi possível importar.");
      S.anos = data.anos;
      S.anoAtivo = anosComVolume()[0] || S.anoAtivo;
      preencherGrade();
      atualizarTudo();
      const n = Object.values(S.anos).reduce((s, a) => s + Object.keys(a).length, 0);
      toast(`Planilha importada: ${n} estado(s) em ${anosComVolume().join(", ")}.`, "ok");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  // ---------- metas e preços ----------
  function montarPrecos() {
    $("#metas").innerHTML = CFG.anos.map((y) => `<div class="meta-chip" data-meta-chip="${y}">
      <b>${y}</b><label><input type="text" inputmode="decimal" data-meta="${y}" aria-label="Meta ${y} (%)">%</label></div>`).join("");

    $("#priceTable").innerHTML = MATERIAIS.map((_, i) => `<div class="price-row" data-price-row="${i}">
      <div class="name"><span data-price-name="${i}"></span><span class="vol" data-price-vol="${i}"></span></div>
      <label class="money"><span>R$/t</span><input type="text" inputmode="decimal" data-preco="${i}" aria-label="Preço por tonelada"></label>
    </div>`).join("");

    $$("[data-meta]").forEach((inp) => (inp.value = S.comercial.metas[inp.dataset.meta] ?? ""));
    $$("[data-preco]").forEach((inp) => (inp.value = fmt(+S.comercial.precos[inp.dataset.preco] || 0, 2)));
  }

  $("#metas").addEventListener("input", (e) => {
    const inp = e.target.closest("[data-meta]");
    if (!inp) return;
    const v = num(inp.value);
    inp.closest("label").style.boxShadow = Number.isFinite(v) && v >= 0 && v <= 100 ? "" : "inset 0 0 0 1.5px var(--danger)";
    S.comercial.metas[inp.dataset.meta] = inp.value;
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
    const usados = new Set(r.anos);
    $$("[data-meta-chip]").forEach((el) => el.classList.toggle("used", usados.has(el.dataset.metaChip)));
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
    $("#sumEstados").textContent = r.estados.length;
    $("#sumAnos").textContent = r.anos.length ? r.anos.join(", ") : "—";
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
    if ($$("#gridBody input.bad").length) alertas.push(`Há células com valor inválido em ${S.anoAtivo}; elas não entram no cálculo.`);
    if (!CFG.modelo_ppt) alertas.push("Modelo PowerPoint ainda não está em modelo/Proposta_Comercial.pptx.");
    $("#alerts").innerHTML = alertas.map((a) => `<li>${a}</li>`).join("");

    $('[data-step="cliente"]').classList.toggle("done", !!S.cliente.razao_social.trim());
    $('[data-step="volumes"]').classList.toggle("done", r.anos.length > 0);
    $('[data-step="precos"]').classList.toggle("done", r.anos.length > 0 && !r.semPreco.length);
  }

  function atualizarTudo({ grade = true } = {}) {
    if (grade) preencherGrade();
    const r = calcular();
    renderAnos();
    renderPrecos(r);
    renderResumo(r);
    salvar();
  }

  // ---------- ações ----------
  function payload() {
    return {
      cliente: S.cliente,
      proposta: S.proposta,
      comercial: {
        precos: S.comercial.precos.map((p) => (Number.isFinite(+p) ? +p : 0)),
        metas: S.comercial.metas,
        desconto_percentual: S.comercial.desconto_percentual,
        outro_material_nome: S.comercial.outro_material_nome,
      },
      anos: S.anos,
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
      toast("Informe o volume de pelo menos um estado.", "error");
      location.hash = "#volumes";
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
      await baixar("/gerar-excel", { anos: S.anos }, e.currentTarget, "Autodeclaracao_volume_embalagens_preenchida.xlsx");
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
