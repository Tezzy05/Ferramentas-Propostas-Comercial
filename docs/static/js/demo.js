/*
 * Modo demonstração (GitHub Pages).
 *
 * O GitHub Pages só serve arquivos estáticos, então aqui o navegador faz o papel do
 * servidor Python: todos os cálculos do painel são os reais (app.js), o registro de
 * propostas fica no navegador (localStorage) e os botões de planilha/PPT/PDF baixam
 * arquivos de exemplo gerados pela ferramenta de verdade (scripts/gerar_demo_pages.py).
 */
(() => {
  "use strict";

  const D = window.DEMO;
  if (!D) return;
  const CHAVE = "ambipar-demo-registro-v1";
  const fetchOriginal = window.fetch.bind(window);

  // ---------- registro no navegador ----------
  function ler() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE) || "null");
      if (Array.isArray(salvo)) return salvo;
    } catch (_) { /* navegador sem acesso ao armazenamento */ }
    return JSON.parse(JSON.stringify(D.registro || []));
  }
  let registro = ler();
  function gravar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(registro)); } catch (_) { /* só em memória */ }
  }
  gravar();

  const agora = () => new Date().toISOString().slice(0, 19);
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

  function registrar(payload) {
    const numero = payload?.proposta?.numero || `DEMO-${Date.now()}`;
    const resumo = typeof window.__demoResumo === "function" ? window.__demoResumo() : {};
    const atual = registro.find((d) => d.numero === numero);
    const item = {
      numero,
      criada_em: atual?.criada_em || agora(),
      atualizada_em: agora(),
      payload,
      resumo,
      registro: atual?.registro || { status: "Enviada", valor_negociado: null, data_venda: "", observacao: "" },
    };
    registro = [item, ...registro.filter((d) => d.numero !== numero)];
    gravar();
    return item;
  }

  // ---------- avisos ----------
  const avisados = new Set();
  function avisar(chave, texto) {
    if (avisados.has(chave)) return;
    avisados.add(chave);
    const el = document.createElement("div");
    el.className = "demo-aviso";
    el.textContent = texto;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("show"), 50);
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 6500);
  }

  async function arquivo(caminho, nome, extras = {}) {
    const resposta = await fetchOriginal(caminho);
    const blob = await resposta.blob();
    return new Response(blob, {
      status: 200,
      headers: { "Content-Disposition": `attachment; filename="${nome}"`, ...extras },
    });
  }

  // ---------- "servidor" da demonstração ----------
  window.fetch = async (entrada, opcoes = {}) => {
    const url = typeof entrada === "string" ? entrada : entrada.url;
    if (!url.startsWith("/")) return fetchOriginal(entrada, opcoes);
    const metodo = (opcoes.method || "GET").toUpperCase();
    const caminho = url.split("?")[0];
    const corpo = () => { try { return JSON.parse(opcoes.body || "{}"); } catch (_) { return {}; } };
    const ex = D.exemplos;

    if (caminho === "/gerar-excel" && metodo === "POST") {
      avisar("xls", "Demonstração: baixando a planilha de exemplo. No app instalado ela sai com os volumes preenchidos.");
      return arquivo(ex.excel, "Autodeclaracao_volume_embalagens_EXEMPLO.xlsx");
    }
    if ((caminho === "/atualizar-proposta" || caminho === "/gerar-pdf") && metodo === "POST") {
      registrar(corpo());
      const pdf = caminho === "/gerar-pdf";
      avisar(pdf ? "pdf" : "ppt", `Demonstração: baixando o ${pdf ? "PDF" : "PPT"} de exemplo (proposta "Indústria Exemplo Ltda"). A proposta foi salva no registro.`);
      return arquivo(pdf ? ex.pdf : ex.ppt, pdf ? "Proposta_Comercial_EXEMPLO.pdf" : "Proposta_Comercial_EXEMPLO.pptx",
        { "X-Registro": "ok" });
    }
    if (caminho === "/importar-excel") {
      return json({ sucesso: false, erro: "Importar planilha está disponível no app instalado (não na demonstração)." }, 400);
    }
    if (caminho === "/propostas" && metodo === "GET") {
      return json({ sucesso: true, propostas: registro.map(({ payload, ...resto }) => resto) });
    }
    if (caminho === "/propostas" && metodo === "POST") {
      const item = registrar(corpo());
      return json({ sucesso: true, numero: item.numero, aviso: null });
    }
    const m = caminho.match(/^\/propostas\/(.+)$/);
    if (m) {
      const numero = decodeURIComponent(m[1]);
      const item = registro.find((d) => d.numero === numero);
      if (!item) return json({ sucesso: false, erro: `Proposta ${numero} não encontrada no registro.` }, 404);
      if (metodo === "GET") return json({ sucesso: true, proposta: item });
      if (metodo === "DELETE") {
        registro = registro.filter((d) => d.numero !== numero);
        gravar();
        return json({ sucesso: true, aviso: null });
      }
      if (metodo === "PATCH") {
        const campos = corpo();
        Object.assign(item.registro, campos);
        if ("valor_negociado" in campos) {
          item.registro.valor_negociado = campos.valor_negociado === "" ? null : Number(campos.valor_negociado);
        }
        item.atualizada_em = agora();
        gravar();
        return json({ sucesso: true, registro: item.registro, aviso: null });
      }
    }
    return fetchOriginal(entrada, opcoes);
  };

  // ---------- faixa da demonstração ----------
  document.addEventListener("DOMContentLoaded", () => {
    const faixa = document.createElement("div");
    faixa.className = "demo-faixa";
    faixa.innerHTML = `<b>Versão de demonstração</b> · cálculos, regras e registro funcionam de verdade;
      os botões de planilha, PPT e PDF baixam arquivos de exemplo.
      <button type="button" id="demoReset">Reiniciar demonstração</button>`;
    document.body.prepend(faixa);
    document.getElementById("demoReset").addEventListener("click", () => {
      if (!confirm("Apagar o que foi preenchido e voltar ao registro de exemplo?")) return;
      try {
        localStorage.removeItem(CHAVE);
        localStorage.removeItem("ambipar-propostas-rascunho-v1");
      } catch (_) { /* nada a limpar */ }
      location.reload();
    });
    const relatorio = document.getElementById("baixarRelatorio");
    if (relatorio) {
      relatorio.href = D.exemplos.relatorio;
      relatorio.setAttribute("download", "Registro_propostas_EXEMPLO.xlsx");
    }
  });
})();
