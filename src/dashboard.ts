type UsuarioSessao = {
  id: string;
  nome: string;
  email: string;
  role: "admin" | "cliente";
};

const totalProdutos = document.querySelector<HTMLSpanElement>("#totalProdutos");
const totalUsuarios = document.querySelector<HTMLSpanElement>("#totalUsuarios");
const totalPedidos = document.querySelector<HTMLSpanElement>("#totalPedidos");
const totalVendas = document.querySelector<HTMLSpanElement>("#totalVendas");
const ticketMedio = document.querySelector<HTMLSpanElement>("#ticketMedio");
const produtosVendidos = document.querySelector<HTMLSpanElement>("#produtosVendidos");
const listaVendas = document.querySelector<HTMLDivElement>("#listaVendas");
const btnLogout = document.querySelector<HTMLButtonElement>("#btnLogout");
const btnTema = document.querySelector<HTMLButtonElement>("#btnTema");
const confirmacaoSaida = document.querySelector<HTMLDivElement>("#confirmacaoSaida");
const btnCancelarSaida = document.querySelector<HTMLButtonElement>("#btnCancelarSaida");
const btnConfirmarSaida = document.querySelector<HTMLButtonElement>("#btnConfirmarSaida");
const btnRelatorioPlanilha = document.querySelector<HTMLButtonElement>("#btnRelatorioPlanilha");
const btnRelatorioPdf = document.querySelector<HTMLButtonElement>("#btnRelatorioPdf");
const graficoVendasDia = document.querySelector<HTMLDivElement>("#graficoVendasDia");
const graficoCategorias = document.querySelector<HTMLDivElement>("#graficoCategorias");
const graficoStatus = document.querySelector<HTMLDivElement>("#graficoStatus");
const listaEstoqueBaixo = document.querySelector<HTMLDivElement>("#listaEstoqueBaixo");

type DadosDashboard = {
  totalProdutos: number;
  totalUsuarios: number;
  totalPedidos: number;
  totalVendas: number;
  ticketMedio: number;
  produtosVendidos: number;
  vendasRecentes: Array<Record<string, unknown>>;
  vendasPorCategoria: Array<Record<string, unknown>>;
  vendasPorDia: Array<Record<string, unknown>>;
  estoqueBaixo: Array<Record<string, unknown>>;
  pedidosPorStatus: Array<Record<string, unknown>>;
};

let dadosAtuais: DadosDashboard | null = null;

const obterUsuario = (): UsuarioSessao | null => {
  const usuario = localStorage.getItem("usuarioLogado");
  if (!usuario) return null;

  try {
    return JSON.parse(usuario) as UsuarioSessao;
  } catch {
    return null;
  }
};

const iconeSol = '<svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
const iconeLua = '<svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
const atualizarIconeTema = (tema: string) => { if (btnTema) btnTema.innerHTML = tema === "claro" ? iconeLua : iconeSol; };
const temaInicial = localStorage.getItem("temaLoja") === "escuro" ? "escuro" : "claro";
document.documentElement.dataset.tema = temaInicial;
atualizarIconeTema(temaInicial);
btnTema?.addEventListener("click", () => {
  const tema = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
  document.documentElement.dataset.tema = tema;
  localStorage.setItem("temaLoja", tema);
  atualizarIconeTema(tema);
});

const validarAcessoAdmin = () => {
  const usuario = obterUsuario();
  if (!usuario || usuario.role !== "admin") {
    window.location.href = "/";
    return false;
  }

  return true;
};

const formatarMoeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

const textoSeguro = (valor: unknown) => String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[caractere] ?? caractere);

const renderizarGraficos = (dados: DadosDashboard) => {
  const dias = dados.vendasPorDia ?? [];
  const maiorVenda = Math.max(...dias.map((item) => Number(item.total ?? 0)), 1);
  if (graficoVendasDia) graficoVendasDia.innerHTML = dias.length ? dias.map((item) => `<div class="bar-column"><span>${formatarMoeda(Number(item.total ?? 0))}</span><i style="height:${Math.max(8, Number(item.total ?? 0) / maiorVenda * 100)}%"></i><small>${textoSeguro(String(item.data ?? "").slice(5))}</small></div>`).join("") : '<p class="empty">Sem dados de vendas.</p>';

  const categorias = dados.vendasPorCategoria ?? [];
  const maiorCategoria = Math.max(...categorias.map((item) => Number(item.total ?? 0)), 1);
  if (graficoCategorias) graficoCategorias.innerHTML = categorias.length ? categorias.map((item) => `<div class="metric-line"><div><span>${textoSeguro(item.categoria)}</span><b>${formatarMoeda(Number(item.total ?? 0))}</b></div><i><em style="width:${Number(item.total ?? 0) / maiorCategoria * 100}%"></em></i></div>`).join("") : '<p class="empty">Sem dados por categoria.</p>';

  const status = dados.pedidosPorStatus ?? [];
  if (graficoStatus) graficoStatus.innerHTML = status.length ? status.map((item) => {
    const nomeStatus = String(item.status ?? "pendente").toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return `<div class="status-line status-${nomeStatus}"><span class="status-dot"></span><strong>${textoSeguro(item.status)}</strong><b>${Number(item.total ?? 0)}</b></div>`;
  }).join("") : '<p class="empty">Sem pedidos.</p>';

  const estoque = dados.estoqueBaixo ?? [];
  if (listaEstoqueBaixo) listaEstoqueBaixo.innerHTML = estoque.length ? estoque.map((item) => `<div class="stock-line"><span>${textoSeguro(item.nome)}</span><b>${Number(item.quantidade ?? 0)} un.</b></div>`).join("") : '<p class="empty">Estoque saudável.</p>';
};

const baixarPlanilha = () => {
  if (!dadosAtuais) return;
  const linhas = [["Indicador", "Valor"], ["Produtos", dadosAtuais.totalProdutos], ["Usuários", dadosAtuais.totalUsuarios], ["Pedidos", dadosAtuais.totalPedidos], ["Vendas", dadosAtuais.totalVendas], [], ["Pedido", "Cliente", "Status", "Valor", "Data"], ...dadosAtuais.vendasRecentes.map((pedido) => [String(pedido.id ?? ""), String(pedido.cliente ?? "Cliente"), String(pedido.status ?? "pendente"), Number(pedido.valor ?? 0).toFixed(2).replace(".", ","), String(pedido.criado_em ?? "")])];
  const csv = linhas.map((linha) => linha.map((celula) => `"${String(celula).replace(/"/g, '""')}"`).join(";")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  link.download = `relatorio-loja-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
};

const gerarPdf = () => {
  if (!dadosAtuais) return;
  const janela = window.open("", "_blank", "width=900,height=700");
  if (!janela) return;
  const pedidos = dadosAtuais.vendasRecentes.map((pedido) => `<tr><td>${textoSeguro(String(pedido.id ?? "").slice(0, 8))}</td><td>${textoSeguro(pedido.cliente)}</td><td>${textoSeguro(pedido.status)}</td><td>${formatarMoeda(Number(pedido.valor ?? 0))}</td></tr>`).join("");
  janela.document.write(`<html><head><title>Relatório Loja Tech</title><style>body{font-family:Arial;color:#17202b;padding:35px}h1{margin-bottom:4px}p{color:#64748b}.grid{display:flex;gap:12px;margin:25px 0}.card{border:1px solid #dbe4f0;padding:16px;flex:1}.card b{display:block;font-size:25px;margin-top:8px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{text-align:left;padding:12px;border-bottom:1px solid #dbe4f0}th{color:#64748b;font-size:12px;text-transform:uppercase}@media print{button{display:none}}</style></head><body><h1>Loja Tech</h1><p>Relatório gerencial · ${new Date().toLocaleDateString("pt-BR")}</p><div class="grid"><div class="card">Produtos<b>${dadosAtuais.totalProdutos}</b></div><div class="card">Usuários<b>${dadosAtuais.totalUsuarios}</b></div><div class="card">Pedidos<b>${dadosAtuais.totalPedidos}</b></div><div class="card">Vendas<b>${formatarMoeda(dadosAtuais.totalVendas)}</b></div></div><h2>Pedidos recentes</h2><table><tr><th>Pedido</th><th>Cliente</th><th>Status</th><th>Valor</th></tr>${pedidos || '<tr><td colspan="4">Nenhum pedido</td></tr>'}</table><script>window.onload=()=>window.print();</script></body></html>`);
  janela.document.close();
};

const carregarDashboard = async () => {
  if (!validarAcessoAdmin()) return;

  try {
    const resposta = await fetch("/api/dashboard", {
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.erro ?? "Erro ao carregar dashboard.");
    }

    if (totalProdutos) totalProdutos.textContent = String(dados.totalProdutos ?? 0);
    if (totalUsuarios) totalUsuarios.textContent = String(dados.totalUsuarios ?? 0);
    if (totalPedidos) totalPedidos.textContent = String(dados.totalPedidos ?? 0);
    if (totalVendas) totalVendas.textContent = formatarMoeda(Number(dados.totalVendas ?? 0));
    if (ticketMedio) ticketMedio.textContent = formatarMoeda(Number(dados.ticketMedio ?? 0));
    if (produtosVendidos) produtosVendidos.textContent = String(dados.produtosVendidos ?? 0);
    dadosAtuais = dados as DadosDashboard;
    renderizarGraficos(dadosAtuais);

    if (listaVendas) {
      const itens = Array.isArray(dados.vendasRecentes) ? dados.vendasRecentes : [];

      listaVendas.innerHTML = itens.length
        ? itens
            .map(
              (pedido: Record<string, unknown>) => `
                <div class="pedido-item">
                  <div>
                    <strong>${String(pedido.cliente ?? "Cliente" )}</strong>
                    <small>${String(pedido.status ?? "pendente")}</small>
                  </div>
                  <span>${formatarMoeda(Number(pedido.valor ?? 0))}</span>
                </div>
              `
            )
            .join("")
        : '<p class="empty">Nenhum pedido registrado.</p>';
    }
  } catch (erro) {
    console.error(erro);
  }
};

btnRelatorioPlanilha?.addEventListener("click", baixarPlanilha);
btnRelatorioPdf?.addEventListener("click", gerarPdf);

btnLogout?.addEventListener("click", () => {
  if (confirmacaoSaida) confirmacaoSaida.hidden = false;
});
btnCancelarSaida?.addEventListener("click", () => {
  if (confirmacaoSaida) confirmacaoSaida.hidden = true;
});
confirmacaoSaida?.addEventListener("click", (evento) => {
  if (evento.target === confirmacaoSaida) confirmacaoSaida.hidden = true;
});
btnConfirmarSaida?.addEventListener("click", () => {
  localStorage.removeItem("usuarioLogado");
  fetch("/api/logout", { method: "POST" });
  window.location.href = "/";
});

window.addEventListener("DOMContentLoaded", carregarDashboard);
