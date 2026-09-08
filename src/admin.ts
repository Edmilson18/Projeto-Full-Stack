type ProdutoFormulario = {
  nome: string;
  preco: number;
  quantidade: number;
  categoria: string;
  descricao: string;
};

type UsuarioSessao = {
  id: string;
  nome: string;
  email: string;
  role: "admin" | "cliente";
};

const obterUsuario = (): UsuarioSessao | null => {
  const usuario = localStorage.getItem("usuarioLogado");
  if (!usuario) return null;

  try {
    return JSON.parse(usuario) as UsuarioSessao;
  } catch {
    return null;
  }
};

const validarAcessoAdmin = () => {
  const usuario = obterUsuario();
  if (!usuario || usuario.role !== "admin") {
    window.location.href = "/";
    return false;
  }

  return true;
};

const formulario = document.querySelector<HTMLFormElement>("#formProduto");
const mensagem = document.querySelector<HTMLDivElement>("#mensagem");
const btnTema = document.querySelector<HTMLButtonElement>("#btnTema");
const btnLogout = document.querySelector<HTMLButtonElement>("#btnLogout");
const confirmacaoSaida = document.querySelector<HTMLDivElement>("#confirmacaoSaida");
const btnCancelarSaida = document.querySelector<HTMLButtonElement>("#btnCancelarSaida");
const btnConfirmarSaida = document.querySelector<HTMLButtonElement>("#btnConfirmarSaida");
const imagemInput = document.querySelector<HTMLInputElement>("#imagem");
const imagemPreview = document.querySelector<HTMLDivElement>("#imagemPreview");
const nomePreview = document.querySelector<HTMLElement>("#nomePreview");
const descricaoPreview = document.querySelector<HTMLElement>("#descricaoPreview");
const produtoIdInput = document.querySelector<HTMLInputElement>("#produtoId");
const listaProdutosAdmin = document.querySelector<HTMLDivElement>("#listaProdutosAdmin");
const listaPedidosAdmin = document.querySelector<HTMLDivElement>("#listaPedidosAdmin");
const buscaProdutosAdmin = document.querySelector<HTMLInputElement>("#buscaProdutosAdmin");
const tituloPagina = document.querySelector<HTMLHeadingElement>(".admin-heading h1");
const botaoSalvar = formulario?.querySelector<HTMLButtonElement>('button[type="submit"]');
let produtosAdmin: Array<Record<string, unknown>> = [];

const escaparHtml = (valor: unknown) => String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[caractere] ?? caractere);
const formatarMoeda = (valor: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor ?? 0));

const atualizarPreview = () => {
  const imagem = imagemInput?.value.trim() ?? "";
  const nome = document.querySelector<HTMLInputElement>("#nome")?.value.trim() ?? "";
  const descricao = document.querySelector<HTMLTextAreaElement>("#descricao")?.value.trim() ?? "";
  if (imagemPreview) {
    imagemPreview.style.backgroundImage = imagem ? `url("${imagem.replace(/"/g, "")}")` : "";
    imagemPreview.classList.toggle("has-image", Boolean(imagem));
  }
  if (nomePreview) nomePreview.textContent = nome || "Seu produto";
  if (descricaoPreview) descricaoPreview.textContent = descricao || "Adicione nome, descrição e imagem para visualizar o resultado.";
};

const iconeSol = '<svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
const iconeLua = '<svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
const atualizarIconeTema = (tema: string) => {
  if (btnTema) btnTema.innerHTML = tema === "claro" ? iconeLua : iconeSol;
};
const temaAtual = localStorage.getItem("temaLoja") === "escuro" ? "escuro" : "claro";
document.documentElement.dataset.tema = temaAtual;
atualizarIconeTema(temaAtual);

btnTema?.addEventListener("click", () => {
  const tema = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
  document.documentElement.dataset.tema = tema;
  localStorage.setItem("temaLoja", tema);
  atualizarIconeTema(tema);
});

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

imagemInput?.addEventListener("input", atualizarPreview);
document.querySelector<HTMLInputElement>("#nome")?.addEventListener("input", atualizarPreview);
document.querySelector<HTMLTextAreaElement>("#descricao")?.addEventListener("input", atualizarPreview);

const mostrarMensagem = (texto: string, sucesso: boolean) => {
  if (!mensagem) return;
  mensagem.textContent = texto;
  mensagem.className = `mensagem ${sucesso ? "sucesso" : "erro"}`;
};

if (!validarAcessoAdmin()) {
  throw new Error("Acesso não autorizado.");
}

formulario?.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const nome = (document.querySelector<HTMLInputElement>("#nome")?.value ?? "").trim();
  const preco = Number(document.querySelector<HTMLInputElement>("#preco")?.value ?? 0);
  const quantidade = Number(document.querySelector<HTMLInputElement>("#quantidade")?.value ?? 0);
  const categoria = document.querySelector<HTMLSelectElement>("#categoria")?.value ?? "";
  const descricao = (document.querySelector<HTMLTextAreaElement>("#descricao")?.value ?? "").trim();
  const imagem = (document.querySelector<HTMLInputElement>("#imagem")?.value ?? "").trim();

  if (!nome || !categoria || Number.isNaN(preco) || preco < 0 || !Number.isInteger(quantidade) || quantidade < 0) {
    mostrarMensagem("Preencha todos os campos corretamente.", false);
    return;
  }

  try {
    const editando = Boolean(produtoIdInput?.value);
    const resposta = await fetch(editando ? `/api/produtos/${encodeURIComponent(produtoIdInput?.value ?? "")}` : "/api/produtos", {
      method: editando ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nome,
        preco,
        quantidade,
        categoriaId: categoria,
        descricao,
        imagem,
      }),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      mostrarMensagem(dados.erro ?? "Erro ao cadastrar produto.", false);
      return;
    }

    mostrarMensagem(editando ? `Produto atualizado: ${nome}` : `Produto cadastrado com sucesso: ${nome}`, true);
    formulario.reset();
    if (produtoIdInput) produtoIdInput.value = "";
    if (tituloPagina) tituloPagina.textContent = "Novo produto";
    if (botaoSalvar) botaoSalvar.textContent = "Salvar produto";
    atualizarPreview();
    carregarGerenciamento();
  } catch (erro) {
    mostrarMensagem("Não foi possível conectar ao servidor.", false);
    console.error(erro);
  }
});

const renderizarProdutos = () => {
  if (!listaProdutosAdmin) return;
  const termo = buscaProdutosAdmin?.value.trim().toLocaleLowerCase("pt-BR") ?? "";
  const itens = produtosAdmin.filter((produto) => `${produto.nome} ${produto.categoria}`.toLocaleLowerCase("pt-BR").includes(termo));
  listaProdutosAdmin.innerHTML = itens.length ? itens.map((produto) => `<article class="management-row"><div><strong>${escaparHtml(produto.nome)}</strong><small>${escaparHtml(produto.categoria)}</small></div><span>${formatarMoeda(produto.preco)}</span><span>${Number(produto.quantidade)} un.</span><span class="${Number(produto.ativo) ? "status-active" : "status-inactive"}">${Number(produto.ativo) ? "Ativo" : "Inativo"}</span><div class="management-actions"><button data-editar="${escaparHtml(produto.id)}" type="button">Editar</button>${Number(produto.ativo) ? `<button class="danger" data-inativar="${escaparHtml(produto.id)}" type="button">Inativar</button>` : ""}</div></article>`).join("") : '<p class="empty">Nenhum produto encontrado.</p>';
};

const carregarGerenciamento = async () => {
  try {
    const [produtosResposta, pedidosResposta] = await Promise.all([fetch("/api/admin/produtos"), fetch("/api/admin/pedidos")]);
    if (produtosResposta.ok) { produtosAdmin = await produtosResposta.json(); renderizarProdutos(); }
    if (pedidosResposta.ok && listaPedidosAdmin) {
      const pedidos = await pedidosResposta.json();
      listaPedidosAdmin.innerHTML = pedidos.length ? pedidos.map((pedido: Record<string, unknown>) => `<article class="management-row"><div><strong>#${escaparHtml(String(pedido.id).slice(0, 8))}</strong><small>${escaparHtml(pedido.cliente ?? "Cliente")}</small></div><span>${formatarMoeda(pedido.total_final)}</span><span>${escaparHtml(pedido.metodo_pagamento ?? "pix")}</span><select class="status-select" data-pedido="${escaparHtml(pedido.id)}"><option ${pedido.status === "processando" ? "selected" : ""}>processando</option><option ${pedido.status === "enviado" ? "selected" : ""}>enviado</option><option ${pedido.status === "finalizado" ? "selected" : ""}>finalizado</option><option ${pedido.status === "cancelado" ? "selected" : ""}>cancelado</option></select><small>${escaparHtml(pedido.status_pagamento ?? "pendente")}</small></article>`).join("") : '<p class="empty">Nenhum pedido registrado.</p>';
    }
  } catch { mostrarMensagem("Não foi possível carregar o gerenciamento.", false); }
};

listaProdutosAdmin?.addEventListener("click", (evento) => {
  const botao = (evento.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!botao) return;
  const id = botao.dataset.editar ?? botao.dataset.inativar; const produto = produtosAdmin.find((item) => item.id === id); if (!id || !produto) return;
  if (botao.dataset.editar) {
    if (produtoIdInput) produtoIdInput.value = id;
    (document.querySelector<HTMLInputElement>("#nome")!).value = String(produto.nome ?? "");
    (document.querySelector<HTMLInputElement>("#preco")!).value = String(produto.preco ?? "");
    (document.querySelector<HTMLInputElement>("#quantidade")!).value = String(produto.quantidade ?? "");
    (document.querySelector<HTMLSelectElement>("#categoria")!).value = String(produto.categoriaId ?? "");
    (document.querySelector<HTMLTextAreaElement>("#descricao")!).value = String(produto.descricao ?? "");
    (document.querySelector<HTMLInputElement>("#imagem")!).value = String(produto.imagem ?? "");
    if (tituloPagina) tituloPagina.textContent = "Editar produto"; if (botaoSalvar) botaoSalvar.textContent = "Salvar alterações"; atualizarPreview(); window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (window.confirm(`Inativar ${produto.nome}? O item deixará de aparecer na vitrine, mas o histórico será preservado.`)) {
    fetch(`/api/produtos/${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => carregarGerenciamento());
  }
});
listaPedidosAdmin?.addEventListener("change", (evento) => { const seletor = evento.target as HTMLSelectElement; const id = seletor.dataset.pedido; if (id) fetch(`/api/admin/pedidos/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: seletor.value }) }).then(() => carregarGerenciamento()); });
buscaProdutosAdmin?.addEventListener("input", renderizarProdutos);
carregarGerenciamento();
