import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  Check,
  CircleDollarSign,
  ClipboardList,
  Download,
  Filter,
  LayoutDashboard,
  LogOut,
  Moon,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sun,
  X,
} from "lucide-react";
import {
  TRANSICOES_PEDIDO,
  type CategoriaResponse,
  type Dashboard,
  type PedidoAdmin,
  type ProdutoResponse,
  type RelatorioQuery,
  type RelatorioVendas,
  type StatusPedido,
} from "@loja/shared";
import { api } from "../lib/api.js";
import { formatarMoeda, imagemDe } from "../lib/utils.js";

type SecaoAdmin = "visao-geral" | "relatorios" | "produtos" | "pedidos";
type ProdutoForm = {
  nome: string;
  descricao: string;
  preco: string;
  quantidade: string;
  categoriaId: string;
  imagem: string;
  ativo: boolean;
};
type AdminDashboardProps = {
  tema: "claro" | "escuro";
  nome: string;
  email: string;
  onToggleTema: () => void;
  onSair: () => void;
};

const FORM_VAZIO: ProdutoForm = {
  nome: "",
  descricao: "",
  preco: "",
  quantidade: "0",
  categoriaId: "",
  imagem: "",
  ativo: true,
};
const STATUS_LABEL: Record<StatusPedido, string> = {
  processando: "Processando",
  enviado: "Enviado",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

const BRL = (valor: number) => formatarMoeda(valor);

function baixarCsv(linhas: string[][], nomeArquivo: string) {
  const csv =
    "\uFEFF" + linhas.map((linha) => linha.map((campo) => `"${campo.replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  link.click();
  URL.revokeObjectURL(url);
}

function baixarPdf(linhas: string[][], nomeArquivo: string) {
  const texto = linhas
    .map((linha) => linha.join("  |  "))
    .flatMap((linha) => {
      const simples = linha
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7e]/g, "-");
      if (!simples) return [""];
      const partes: string[] = [];
      for (let inicio = 0; inicio < simples.length; inicio += 92) partes.push(simples.slice(inicio, inicio + 92));
      return partes;
    });
  const paginas: string[][] = [];
  for (let inicio = 0; inicio < texto.length; inicio += 48) paginas.push(texto.slice(inicio, inicio + 48));
  if (!paginas.length) paginas.push(["Relatorio de vendas"]);

  const objetos = new Map<number, string>();
  const idsPaginas = paginas.map((_, indice) => 4 + indice * 2);
  objetos.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objetos.set(
    2,
    `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(" ")}] /Count ${paginas.length} >>`,
  );
  objetos.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  paginas.forEach((pagina, indice) => {
    const idPagina = idsPaginas[indice]!;
    const idStream = idPagina + 1;
    const comandos = ["BT", "/F1 10 Tf", "48 790 Td", "15 TL"];
    pagina.forEach((linha, linhaIndice) => {
      if (linhaIndice > 0) comandos.push("T*");
      const segura = linha.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
      comandos.push(`(${segura}) Tj`);
    });
    comandos.push("ET");
    const stream = comandos.join("\n");
    objetos.set(
      idPagina,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${idStream} 0 R >>`,
    );
    objetos.set(idStream, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const totalObjetos = Math.max(...objetos.keys());
  const deslocamentos = Array<number>(totalObjetos + 1).fill(0);
  for (let id = 1; id <= totalObjetos; id++) {
    deslocamentos[id] = pdf.length;
    pdf += `${id} 0 obj\n${objetos.get(id)}\nendobj\n`;
  }
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${totalObjetos + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= totalObjetos; id++) pdf += `${String(deslocamentos[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${totalObjetos + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  link.click();
  URL.revokeObjectURL(url);
}

function dataLocal(data: Date) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function filtrosIniciais(): RelatorioQuery {
  const fim = new Date();
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - 29);
  return { inicio: dataLocal(inicio), fim: dataLocal(fim) };
}

export function AdminDashboard({ tema, nome, email, onToggleTema, onSair }: AdminDashboardProps) {
  const [secao, setSecao] = useState<SecaoAdmin>("visao-geral");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [produtos, setProdutos] = useState<ProdutoResponse[]>([]);
  const [categorias, setCategorias] = useState<CategoriaResponse[]>([]);
  const [pedidos, setPedidos] = useState<PedidoAdmin[]>([]);
  const [relatorio, setRelatorio] = useState<RelatorioVendas | null>(null);
  const [filtrosRascunho, setFiltrosRascunho] = useState<RelatorioQuery>(filtrosIniciais);
  const [filtrosAplicados, setFiltrosAplicados] = useState<RelatorioQuery>(filtrosIniciais);
  const [filtrosRelatorioCarregado, setFiltrosRelatorioCarregado] = useState<RelatorioQuery | null>(null);
  const [carregandoRelatorio, setCarregandoRelatorio] = useState(false);
  const [downloadConfirmacao, setDownloadConfirmacao] = useState<{
    formato: "csv" | "pdf";
    contexto: "geral" | "filtrado";
  } | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroPedido, setFiltroPedido] = useState("todos");
  const [produtoEditando, setProdutoEditando] = useState<ProdutoResponse | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState<ProdutoForm>(FORM_VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const [resumo, listaProdutos, listaCategorias, listaPedidos] = await Promise.all([
        api.get<Dashboard>("/dashboard"),
        api.get<ProdutoResponse[]>("/admin/produtos"),
        api.get<CategoriaResponse[]>("/categorias"),
        api.get<PedidoAdmin[]>("/admin/pedidos"),
      ]);
      setDashboard(resumo);
      setProdutos(listaProdutos);
      setCategorias(listaCategorias);
      setPedidos(listaPedidos);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível carregar os dados administrativos.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const carregarRelatorio = useCallback(async (filtros: RelatorioQuery) => {
    setCarregandoRelatorio(true);
    setErro("");
    const parametros = new URLSearchParams({ inicio: filtros.inicio, fim: filtros.fim });
    if (filtros.produtoId) parametros.set("produtoId", filtros.produtoId);
    if (filtros.categoriaId) parametros.set("categoriaId", filtros.categoriaId);
    try {
      const resultado = await api.get<RelatorioVendas>(`/admin/relatorios?${parametros.toString()}`);
      setRelatorio(resultado);
      setFiltrosRelatorioCarregado({ ...filtros });
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível carregar os relatórios.");
    } finally {
      setCarregandoRelatorio(false);
    }
  }, []);

  useEffect(() => {
    void carregarRelatorio(filtrosAplicados);
  }, [carregarRelatorio, filtrosAplicados]);

  const produtosVisiveis = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return produtos.filter(
      (produto) => !termo || `${produto.nome} ${produto.categoria}`.toLocaleLowerCase("pt-BR").includes(termo),
    );
  }, [produtos, busca]);
  const pedidosVisiveis = useMemo(
    () =>
      pedidos.filter((pedido) => {
        const termo = busca.trim().toLocaleLowerCase("pt-BR");
        return (
          (filtroPedido === "todos" || pedido.status === filtroPedido) &&
          (!termo || `${pedido.id} ${pedido.cliente ?? ""}`.toLocaleLowerCase("pt-BR").includes(termo))
        );
      }),
    [pedidos, busca, filtroPedido],
  );

  const abrirNovoProduto = () => {
    setProdutoEditando(null);
    setFormAberto(true);
    setForm({ ...FORM_VAZIO, categoriaId: categorias[0]?.id ?? "" });
  };
  const editarProduto = (produto: ProdutoResponse) => {
    setProdutoEditando(produto);
    setFormAberto(true);
    setForm({
      nome: produto.nome,
      descricao: produto.descricao ?? "",
      preco: String(produto.preco),
      quantidade: String(produto.quantidade),
      categoriaId: categorias.find((categoria) => categoria.nome === produto.categoria)?.id ?? "",
      imagem: produto.imagem ?? "",
      ativo: produto.ativo !== false,
    });
  };

  const fecharFormularioProduto = useCallback(() => {
    setForm(FORM_VAZIO);
    setProdutoEditando(null);
    setFormAberto(false);
  }, []);

  useEffect(() => {
    if (!formAberto) return undefined;
    const fecharComEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") fecharFormularioProduto();
    };
    document.addEventListener("keydown", fecharComEscape);
    return () => document.removeEventListener("keydown", fecharComEscape);
  }, [fecharFormularioProduto, formAberto]);

  const salvarProduto = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      const payload = {
        nome: form.nome,
        descricao: form.descricao,
        preco: Number(form.preco),
        quantidade: Number(form.quantidade),
        categoriaId: form.categoriaId,
        imagem: form.imagem,
        ...(produtoEditando ? { ativo: form.ativo } : {}),
      };
      if (produtoEditando) await api.put(`/produtos/${produtoEditando.id}`, payload);
      else await api.post("/produtos", payload);
      setAviso(produtoEditando ? "Produto atualizado." : "Produto cadastrado.");
      setProdutoEditando(null);
      setFormAberto(false);
      setForm(FORM_VAZIO);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar o produto.");
    } finally {
      setSalvando(false);
    }
  };

  const alternarAtivo = async (produto: ProdutoResponse) => {
    const acao = produto.ativo === false ? "reativar" : "inativar";
    if (!window.confirm(`Deseja ${acao} “${produto.nome}”?`)) return;
    const categoriaId = categorias.find((categoria) => categoria.nome === produto.categoria)?.id;
    if (!categoriaId) {
      setErro("A categoria deste produto não foi encontrada.");
      return;
    }
    try {
      await api.put(`/produtos/${produto.id}`, {
        nome: produto.nome,
        descricao: produto.descricao ?? "",
        preco: produto.preco,
        quantidade: produto.quantidade,
        categoriaId,
        imagem: produto.imagem ?? "",
        ativo: produto.ativo === false,
      });
      setAviso(produto.ativo === false ? "Produto reativado." : "Produto inativado.");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível alterar o produto.");
    }
  };

  const mudarStatus = async (pedido: PedidoAdmin, status: StatusPedido) => {
    try {
      await api.patch(`/admin/pedidos/${pedido.id}`, { status });
      setAviso("Status do pedido atualizado.");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível atualizar o pedido.");
    }
  };

  const linhasVisaoGeral = () => [
    ["LOJA TECH - VISÃO GERAL"],
    ["Indicador", "Valor"],
    ["Produtos ativos", String(dashboard?.totalProdutos ?? 0)],
    ["Clientes", String(dashboard?.totalUsuarios ?? 0)],
    ["Pedidos", String(dashboard?.totalPedidos ?? 0)],
    ["Vendas", BRL(dashboard?.totalVendas ?? 0)],
    ["Ticket médio", BRL(dashboard?.ticketMedio ?? 0)],
    [],
    ["Vendas por dia", "Total"],
    ...(dashboard?.vendasPorDia.map((dia) => [dia.dia ?? "", BRL(dia.total)]) ?? []),
    [],
    ["Vendas por categoria", "Unidades"],
    ...(dashboard?.vendasPorCategoria.map((item) => [item.categoria, String(item.quantidade)]) ?? []),
    [],
    ["Produtos mais vendidos", "Unidades", "Preço atual"],
    ...(dashboard?.maisVendidos.map((item) => [item.nome, String(item.vendidos), BRL(item.preco)]) ?? []),
  ];

  const obterLinhasRelatorio = () => {
    if (!relatorio) return [];
    const produtoFiltrado = produtos.find((item) => item.id === filtrosAplicados.produtoId);
    const temFiltroDeCategoria = Boolean(filtrosAplicados.categoriaId || filtrosAplicados.produtoId);
    const categoriaFiltrada = filtrosAplicados.categoriaId
      ? (categorias.find((item) => item.id === filtrosAplicados.categoriaId)?.nome ?? "Categoria selecionada")
      : produtoFiltrado?.categoria;
    return [
      ["LOJA TECH - RELATÓRIO DE VENDAS"],
      ["Período", `${filtrosAplicados.inicio} a ${filtrosAplicados.fim}`],
      ...(temFiltroDeCategoria ? [["Categoria", categoriaFiltrada ?? "Categoria não encontrada"]] : []),
      ["Produto", produtos.find((item) => item.id === filtrosAplicados.produtoId)?.nome ?? "Todos"],
      ["Observação", "Receita bruta dos itens, antes de descontos e frete."],
      [],
      ["Indicador", "Valor"],
      ["Receita bruta dos itens", BRL(relatorio.totalReceita)],
      ["Pedidos no período", String(relatorio.totalPedidos)],
      ["Ticket médio", BRL(relatorio.ticketMedio)],
      ["Itens vendidos", String(relatorio.produtosVendidos)],
      [],
      ["Vendas por dia", "Receita"],
      ...relatorio.vendasPorDia.map((dia) => [dia.dia, BRL(dia.total)]),
      [],
      ["Vendas por categoria", "Unidades", "Receita"],
      ...relatorio.vendasPorCategoria.map((item) => [item.categoria, String(item.quantidade), BRL(item.total)]),
      [],
      ["Produto", "Unidades", "Preço atual", "Receita"],
      ...relatorio.maisVendidos.map((item) => [item.nome, String(item.vendidos), BRL(item.preco), BRL(item.total)]),
      [],
      ["Pedidos por status", "Quantidade"],
      ...Object.entries(relatorio.pedidosPorStatus).map(([status, total]) => [
        STATUS_LABEL[status as StatusPedido] ?? status,
        String(total),
      ]),
    ];
  };

  const confirmarDownload = () => {
    if (!downloadConfirmacao) return;
    const { formato, contexto } = downloadConfirmacao;
    const linhas = contexto === "filtrado" ? obterLinhasRelatorio() : linhasVisaoGeral();
    const nomeBase = contexto === "filtrado" ? "relatorio-vendas-loja-tech" : "relatorio-visao-geral-loja-tech";
    if (contexto === "filtrado" && !relatorio) return;
    if (formato === "csv") baixarCsv(linhas, `${nomeBase}.csv`);
    else baixarPdf(linhas, `${nomeBase}.pdf`);
    setDownloadConfirmacao(null);
  };

  const maxVendas = Math.max(1, ...(dashboard?.vendasPorDia.map((item) => item.total) ?? []));
  const maxCategoria = Math.max(1, ...(dashboard?.vendasPorCategoria.map((item) => item.quantidade) ?? []));
  const menu: { id: SecaoAdmin; label: string; Icon: typeof LayoutDashboard }[] = [
    { id: "visao-geral", label: "Visão geral", Icon: LayoutDashboard },
    { id: "relatorios", label: "Relatórios", Icon: BarChart3 },
    { id: "produtos", label: "Produtos", Icon: Boxes },
    { id: "pedidos", label: "Pedidos", Icon: ClipboardList },
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="#painel" onClick={(event) => event.preventDefault()}>
          <span className="admin-brand-icon">
            <Activity size={21} />
          </span>
          <span>
            LOJA<span className="brand-highlight">TECH</span>
            <small>PAINEL ADMINISTRATIVO</small>
          </span>
        </a>
        <div className="admin-access">
          <ShieldCheck size={16} /> Acesso administrador
        </div>
        <span className="admin-menu-label">GESTÃO</span>
        <nav aria-label="Navegação administrativa" className="admin-nav">
          {menu.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={secao === id ? "active" : ""}
              onClick={() => {
                setSecao(id);
                setBusca("");
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {secao === id && <span className="admin-nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-security-note">
            <ShieldCheck size={17} />
            <span>
              <strong>Ambiente protegido</strong>
              <small>Área restrita a administradores</small>
            </span>
          </div>
          <button className="admin-logout" onClick={onSair}>
            <LogOut size={17} /> Sair da conta
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-breadcrumb">
            Loja Tech <span>/</span> <strong>{menu.find((item) => item.id === secao)?.label}</strong>
          </div>
          <div className="admin-top-actions">
            <span className="admin-live">
              <i /> Sistema online
            </span>
            <button
              className="admin-icon-button"
              aria-label={tema === "claro" ? "Ativar tema escuro" : "Ativar tema claro"}
              onClick={onToggleTema}
            >
              {tema === "claro" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <div className="admin-identity" title={`${nome} · ${email}`}>
              <div className="admin-avatar">{nome.slice(0, 1).toUpperCase()}</div>
              <span>
                <strong>{nome}</strong>
                <small>{email}</small>
              </span>
            </div>
          </div>
        </header>
        <div className="admin-content">
          <div className="admin-page-heading">
            <div>
              <span className="eyebrow">CENTRAL DE CONTROLE</span>
              <h1>
                {secao === "visao-geral"
                  ? "Visão geral"
                  : secao === "relatorios"
                    ? "Relatórios"
                    : secao === "produtos"
                      ? "Produtos"
                      : "Pedidos"}
              </h1>
              <p>
                {secao === "visao-geral"
                  ? "Acompanhe o desempenho da sua loja em tempo real."
                  : secao === "relatorios"
                    ? "Analise vendas, pedidos e desempenho dos produtos."
                    : secao === "produtos"
                      ? "Gerencie o catálogo e os níveis de estoque."
                      : "Acompanhe e atualize os pedidos dos clientes."}
              </p>
            </div>
            {(secao === "visao-geral" || secao === "relatorios") && (
              <div className="admin-heading-actions">
                {secao === "relatorios" ? (
                  <>
                    <button
                      className="admin-secondary-btn"
                      type="button"
                      onClick={() => setDownloadConfirmacao({ formato: "csv", contexto: "filtrado" })}
                      disabled={!relatorio || carregandoRelatorio}
                    >
                      <Download size={16} /> Baixar planilha CSV
                    </button>
                    <button
                      className="admin-primary-btn"
                      type="button"
                      onClick={() => setDownloadConfirmacao({ formato: "pdf", contexto: "filtrado" })}
                      disabled={!relatorio || carregandoRelatorio}
                    >
                      <Download size={16} /> Baixar PDF
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="admin-secondary-btn"
                      type="button"
                      onClick={() => setDownloadConfirmacao({ formato: "csv", contexto: "geral" })}
                    >
                      <Download size={16} /> Baixar planilha CSV
                    </button>
                    <button
                      className="admin-primary-btn"
                      type="button"
                      onClick={() => setDownloadConfirmacao({ formato: "pdf", contexto: "geral" })}
                    >
                      <Download size={16} /> Baixar PDF
                    </button>
                    <button className="admin-secondary-btn" type="button" onClick={() => setSecao("relatorios")}>
                      <Filter size={16} /> Filtrar relatórios
                    </button>
                  </>
                )}
              </div>
            )}
            {secao === "produtos" && (
              <button className="admin-primary-btn" onClick={abrirNovoProduto}>
                <Plus size={17} /> Novo produto
              </button>
            )}
          </div>
          {erro && (
            <div className="admin-alert error" role="alert">
              <AlertTriangle size={17} />
              {erro}
              <button aria-label="Fechar aviso" onClick={() => setErro("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {aviso && (
            <div className="admin-alert success" role="status">
              <Check size={17} />
              {aviso}
              <button aria-label="Fechar aviso" onClick={() => setAviso("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {carregando && !dashboard ? (
            <div className="admin-loading">
              <span className="admin-spinner" />
              Carregando dados da loja...
            </div>
          ) : secao === "visao-geral" ? (
            <Overview dashboard={dashboard} pedidos={pedidos} maxVendas={maxVendas} maxCategoria={maxCategoria} />
          ) : secao === "relatorios" ? (
            <Reports
              relatorio={relatorio}
              categorias={categorias}
              produtos={produtos}
              filtros={filtrosRascunho}
              filtrosAplicados={filtrosAplicados}
              filtrosCarregados={filtrosRelatorioCarregado}
              carregando={carregandoRelatorio}
              onFiltrosChange={setFiltrosRascunho}
              onAplicar={() => setFiltrosAplicados({ ...filtrosRascunho })}
              onLimpar={() => {
                const padrao = filtrosIniciais();
                setFiltrosRascunho(padrao);
                setFiltrosAplicados(padrao);
              }}
              maxVendas={Math.max(1, ...(relatorio?.vendasPorDia.map((item) => item.total) ?? []))}
              maxCategoria={Math.max(1, ...(relatorio?.vendasPorCategoria.map((item) => item.quantidade) ?? []))}
            />
          ) : secao === "produtos" ? (
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Catálogo de produtos</h2>
                  <p>{produtosVisiveis.length} produto(s) encontrados</p>
                </div>
                <label className="admin-search">
                  <Search size={17} />
                  <input
                    aria-label="Buscar produtos"
                    placeholder="Buscar por nome ou categoria"
                    value={busca}
                    onChange={(event) => setBusca(event.target.value)}
                  />
                  {busca && (
                    <button aria-label="Limpar busca" onClick={() => setBusca("")}>
                      <X size={15} />
                    </button>
                  )}
                </label>
              </div>
              {formAberto && (
                <div className="admin-modal-backdrop" onClick={fecharFormularioProduto}>
                  <form
                    className="admin-product-form"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="titulo-produto-modal"
                    onClick={(event) => event.stopPropagation()}
                    onSubmit={salvarProduto}
                  >
                    <div className="admin-form-title">
                      <div>
                        <span className="admin-form-icon">
                          <PackagePlus size={18} />
                        </span>
                        <div>
                          <h3 id="titulo-produto-modal">{produtoEditando ? "Editar produto" : "Cadastrar produto"}</h3>
                          <p>Preencha os dados do catálogo</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="admin-icon-button"
                        aria-label="Fechar formulário"
                        onClick={fecharFormularioProduto}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <div className="admin-form-grid">
                      <label>
                        Nome
                        <input
                          required
                          minLength={2}
                          maxLength={160}
                          value={form.nome}
                          onChange={(event) => setForm({ ...form, nome: event.target.value })}
                        />
                      </label>
                      <label>
                        Categoria
                        <select
                          required
                          value={form.categoriaId}
                          onChange={(event) => setForm({ ...form, categoriaId: event.target.value })}
                        >
                          <option value="">Selecione</option>
                          {categorias.map((categoria) => (
                            <option key={categoria.id} value={categoria.id}>
                              {categoria.nome}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Preço (R$)
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.preco}
                          onChange={(event) => setForm({ ...form, preco: event.target.value })}
                        />
                      </label>
                      <label>
                        Estoque
                        <input
                          required
                          type="number"
                          min="0"
                          step="1"
                          value={form.quantidade}
                          onChange={(event) => setForm({ ...form, quantidade: event.target.value })}
                        />
                      </label>
                      <label className="span-two">
                        Imagem (URL ou caminho local)
                        <input
                          placeholder="https://... ou /imagens/produto.jpg"
                          value={form.imagem}
                          onChange={(event) => setForm({ ...form, imagem: event.target.value })}
                        />
                      </label>
                      <label className="span-two">
                        Descrição
                        <textarea
                          maxLength={800}
                          rows={3}
                          value={form.descricao}
                          onChange={(event) => setForm({ ...form, descricao: event.target.value })}
                        />
                      </label>
                      {produtoEditando && (
                        <label className="admin-checkbox">
                          <input
                            type="checkbox"
                            checked={form.ativo}
                            onChange={(event) => setForm({ ...form, ativo: event.target.checked })}
                          />{" "}
                          Produto ativo na loja
                        </label>
                      )}
                    </div>
                    <div className="admin-form-actions">
                      <button type="button" className="admin-secondary-btn" onClick={fecharFormularioProduto}>
                        Cancelar
                      </button>
                      <button disabled={salvando} className="admin-primary-btn">
                        {salvando ? "Salvando..." : produtoEditando ? "Salvar alterações" : "Cadastrar produto"}
                      </button>
                    </div>
                  </form>
                </div>
              )}
              {produtosVisiveis.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Categoria</th>
                        <th>Preço</th>
                        <th>Estoque</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {produtosVisiveis.map((produto) => (
                        <tr key={produto.id}>
                          <td>
                            <div className="admin-product-cell">
                              <img src={imagemDe(produto)} alt="" />
                              <span>
                                <strong>{produto.nome}</strong>
                                <small>{produto.id.slice(0, 8)}</small>
                              </span>
                            </div>
                          </td>
                          <td>{produto.categoria}</td>
                          <td className="admin-money">{BRL(produto.preco)}</td>
                          <td>
                            <span className={produto.quantidade <= 5 ? "stock-low" : ""}>{produto.quantidade} un.</span>
                          </td>
                          <td>
                            <span className={`admin-status ${produto.ativo === false ? "inactive" : "active"}`}>
                              {produto.ativo === false ? "Inativo" : "Ativo"}
                            </span>
                          </td>
                          <td>
                            <div className="admin-row-actions">
                              <button
                                className="admin-icon-button"
                                aria-label={`Editar ${produto.nome}`}
                                onClick={() => editarProduto(produto)}
                              >
                                <Pencil size={16} />
                              </button>
                              <button className="admin-text-action" onClick={() => void alternarAtivo(produto)}>
                                {produto.ativo === false ? "Reativar" : "Inativar"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState texto="Nenhum produto encontrado." />
              )}
            </section>
          ) : (
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Todos os pedidos</h2>
                  <p>{pedidosVisiveis.length} pedido(s) encontrados</p>
                </div>
                <div className="admin-order-tools">
                  <label className="admin-search">
                    <Search size={17} />
                    <input
                      aria-label="Buscar pedidos"
                      placeholder="Buscar pedido ou cliente"
                      value={busca}
                      onChange={(event) => setBusca(event.target.value)}
                    />
                    {busca && (
                      <button aria-label="Limpar busca" onClick={() => setBusca("")}>
                        <X size={15} />
                      </button>
                    )}
                  </label>
                  <select
                    aria-label="Filtrar pedidos por status"
                    className="admin-filter"
                    value={filtroPedido}
                    onChange={(event) => setFiltroPedido(event.target.value)}
                  >
                    <option value="todos">Todos os status</option>
                    {Object.entries(STATUS_LABEL).map(([status, label]) => (
                      <option key={status} value={status}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {pedidosVisiveis.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Cliente</th>
                        <th>Data</th>
                        <th>Pagamento</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th>Atualizar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidosVisiveis.map((pedido) => (
                        <tr key={pedido.id}>
                          <td>
                            <strong>#{pedido.id.slice(0, 8)}</strong>
                          </td>
                          <td>{pedido.cliente ?? "Cliente"}</td>
                          <td>{pedido.criado_em ? new Date(pedido.criado_em).toLocaleDateString("pt-BR") : "—"}</td>
                          <td>
                            {pedido.metodo_pagamento?.toUpperCase() ?? "—"}
                            <small className="admin-subcell">{pedido.status_pagamento ?? ""}</small>
                          </td>
                          <td className="admin-money">{BRL(pedido.total_final)}</td>
                          <td>
                            <span className={`admin-status ${pedido.status}`}>{STATUS_LABEL[pedido.status]}</span>
                          </td>
                          <td>
                            {TRANSICOES_PEDIDO[pedido.status].length ? (
                              <select
                                aria-label={`Atualizar pedido ${pedido.id.slice(0, 8)}`}
                                className="admin-status-select"
                                value=""
                                onChange={(event) => {
                                  if (event.target.value) void mudarStatus(pedido, event.target.value as StatusPedido);
                                }}
                              >
                                <option value="">Alterar para...</option>
                                {TRANSICOES_PEDIDO[pedido.status].map((status) => (
                                  <option key={status} value={status}>
                                    {STATUS_LABEL[status]}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="admin-muted">Concluído</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState texto="Nenhum pedido corresponde a esta busca." />
              )}
            </section>
          )}
        </div>
        {downloadConfirmacao && (
          <div className="admin-modal-backdrop" onClick={() => setDownloadConfirmacao(null)}>
            <section
              className="admin-download-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="titulo-download-relatorio"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="admin-download-icon">
                <Download size={20} />
              </span>
              <h2 id="titulo-download-relatorio">Confirmar download</h2>
              <p>
                Você quer baixar o arquivo{" "}
                <strong>
                  {downloadConfirmacao.contexto === "filtrado"
                    ? "relatorio-vendas-loja-tech"
                    : "relatorio-visao-geral-loja-tech"}
                  .{downloadConfirmacao.formato}
                </strong>
                {downloadConfirmacao.contexto === "filtrado" ? " com os filtros selecionados?" : "?"}
              </p>
              <div className="admin-form-actions">
                <button className="admin-secondary-btn" type="button" onClick={() => setDownloadConfirmacao(null)}>
                  Cancelar
                </button>
                <button className="admin-primary-btn" type="button" onClick={confirmarDownload}>
                  Sim, baixar arquivo
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Reports({
  relatorio,
  categorias,
  produtos,
  filtros,
  filtrosAplicados,
  filtrosCarregados,
  carregando,
  onFiltrosChange,
  onAplicar,
  onLimpar,
  maxVendas,
  maxCategoria,
}: {
  relatorio: RelatorioVendas | null;
  categorias: CategoriaResponse[];
  produtos: ProdutoResponse[];
  filtros: RelatorioQuery;
  filtrosAplicados: RelatorioQuery;
  filtrosCarregados: RelatorioQuery | null;
  carregando: boolean;
  onFiltrosChange: (filtros: RelatorioQuery) => void;
  onAplicar: () => void;
  onLimpar: () => void;
  maxVendas: number;
  maxCategoria: number;
}) {
  const statusComPedidos = Object.entries(relatorio?.pedidosPorStatus ?? {}).filter(([, quantidade]) => quantidade > 0);
  const produtosDisponiveis = produtos.filter(
    (produto) =>
      !filtros.categoriaId ||
      categorias.find((categoria) => categoria.id === filtros.categoriaId)?.nome === produto.categoria,
  );
  const periodoMudou =
    filtros.inicio !== filtrosAplicados.inicio ||
    filtros.fim !== filtrosAplicados.fim ||
    filtros.produtoId !== filtrosAplicados.produtoId ||
    filtros.categoriaId !== filtrosAplicados.categoriaId;
  const filtrosForamCarregados =
    filtrosCarregados !== null &&
    filtrosCarregados.inicio === filtrosAplicados.inicio &&
    filtrosCarregados.fim === filtrosAplicados.fim &&
    filtrosCarregados.produtoId === filtrosAplicados.produtoId &&
    filtrosCarregados.categoriaId === filtrosAplicados.categoriaId;
  const resumoFiltrosAplicados = [
    `${new Date(`${filtrosAplicados.inicio}T12:00:00`).toLocaleDateString("pt-BR")} a ${new Date(`${filtrosAplicados.fim}T12:00:00`).toLocaleDateString("pt-BR")}`,
    filtrosAplicados.categoriaId
      ? `Categoria: ${categorias.find((item) => item.id === filtrosAplicados.categoriaId)?.nome ?? "selecionada"}`
      : null,
    filtrosAplicados.produtoId
      ? `Produto: ${produtos.find((item) => item.id === filtrosAplicados.produtoId)?.nome ?? "selecionado"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <section className="admin-report-filters" aria-label="Filtros dos relatórios">
        <div className="admin-report-filter-heading">
          <div>
            <span className="admin-filter-kicker">ANÁLISE PERSONALIZADA</span>
            <h2>Filtrar relatório</h2>
          </div>
          <p>Escolha o período e refine por produto ou categoria.</p>
        </div>
        <div className="admin-report-filter-grid">
          <label className="admin-report-field">
            <span>De</span>
            <input
              aria-label="Data inicial"
              type="date"
              value={filtros.inicio}
              max={filtros.fim}
              onChange={(event) => onFiltrosChange({ ...filtros, inicio: event.target.value })}
            />
          </label>
          <label className="admin-report-field">
            <span>Até</span>
            <input
              aria-label="Data final"
              type="date"
              value={filtros.fim}
              min={filtros.inicio}
              onChange={(event) => onFiltrosChange({ ...filtros, fim: event.target.value })}
            />
          </label>
          <label className="admin-report-field">
            <span>Categoria</span>
            <select
              aria-label="Categoria do produto"
              value={filtros.categoriaId ?? ""}
              onChange={(event) =>
                onFiltrosChange({ ...filtros, categoriaId: event.target.value || undefined, produtoId: undefined })
              }
            >
              <option value="">Todas as categorias</option>
              {categorias.map((categoria) => (
                <option value={categoria.id} key={categoria.id}>
                  {categoria.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-report-field">
            <span>Produto</span>
            <select
              aria-label="Produto"
              value={filtros.produtoId ?? ""}
              onChange={(event) => {
                const produtoId = event.target.value || undefined;
                const produto = produtos.find((item) => item.id === produtoId);
                const categoriaId = produto
                  ? categorias.find((item) => item.nome === produto.categoria)?.id
                  : filtros.categoriaId;
                onFiltrosChange({ ...filtros, produtoId, categoriaId });
              }}
            >
              <option value="">Todos os produtos</option>
              {produtosDisponiveis.map((produto) => (
                <option value={produto.id} key={produto.id}>
                  {produto.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="admin-report-filter-footer">
          <span>Os valores consideram o subtotal dos itens antes de descontos e frete.</span>
          <div>
            <button className="admin-secondary-btn" type="button" onClick={onLimpar}>
              Limpar filtros
            </button>
            <button
              className="admin-primary-btn"
              type="button"
              onClick={onAplicar}
              disabled={carregando || !filtros.inicio || !filtros.fim || filtros.inicio > filtros.fim}
            >
              <Search size={16} /> {carregando ? "Atualizando..." : "Aplicar filtros"}
            </button>
          </div>
        </div>
        <div
          className={`admin-report-feedback ${carregando ? "is-loading" : filtrosForamCarregados ? "is-success" : periodoMudou ? "is-pending" : "is-error"}`}
          role="status"
          aria-live="polite"
        >
          {carregando ? (
            <span className="admin-report-feedback-spinner" aria-hidden="true" />
          ) : filtrosForamCarregados ? (
            <Check size={17} aria-hidden="true" />
          ) : periodoMudou ? (
            <Filter size={17} aria-hidden="true" />
          ) : (
            <AlertTriangle size={17} aria-hidden="true" />
          )}
          <span>
            <strong>
              {carregando
                ? "Atualizando gráficos"
                : filtrosForamCarregados
                  ? "Relatório atualizado"
                  : periodoMudou
                    ? "Filtros alterados"
                    : "Não foi possível atualizar o relatório"}
            </strong>
            <small>
              {carregando
                ? `Aplicando: ${resumoFiltrosAplicados}`
                : filtrosForamCarregados
                  ? `Os gráficos abaixo mostram: ${resumoFiltrosAplicados}`
                  : periodoMudou
                    ? "Clique em “Aplicar filtros” para atualizar os gráficos."
                    : "Tente aplicar os filtros novamente."}
            </small>
          </span>
        </div>
      </section>
      {carregando && !relatorio ? (
        <div className="admin-loading">
          <span className="admin-spinner" /> Preparando relatório...
        </div>
      ) : !relatorio ? (
        <EmptyState texto="Não foi possível carregar os relatórios." />
      ) : (
        <>
          <div className="admin-report-summary">
            <article>
              <span>Receita bruta dos itens</span>
              <strong>{BRL(relatorio.totalReceita)}</strong>
            </article>
            <article>
              <span>Pedidos no período</span>
              <strong>{relatorio.totalPedidos}</strong>
            </article>
            <article>
              <span>Itens vendidos</span>
              <strong>{relatorio.produtosVendidos}</strong>
            </article>
          </div>
          <div className="admin-report-average">
            Ticket médio dos pedidos filtrados: <strong>{BRL(relatorio.ticketMedio)}</strong>
          </div>
          <div className="admin-overview-grid">
            <section className="admin-panel admin-chart-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Receita por dia</h2>
                  <p>Subtotal dos itens vendidos por dia</p>
                </div>
                <span className="admin-chart-badge">
                  <BarChart3 size={16} /> {relatorio.vendasPorDia.length} dias
                </span>
              </div>
              {relatorio.vendasPorDia.length ? (
                <div className="admin-bars" aria-label="Relatório de vendas por dia">
                  {relatorio.vendasPorDia.map((dia, index) => (
                    <div
                      className="admin-bar-column"
                      key={dia.dia ?? `total-${dia.total}`}
                      title={`${dia.dia ?? "Dia"}: ${BRL(dia.total)}`}
                    >
                      <span className="admin-bar-value">{dia.total ? BRL(dia.total) : ""}</span>
                      <div className="admin-bar-track">
                        <i style={{ height: `${Math.max(4, (dia.total / maxVendas) * 100)}%` }} />
                      </div>
                      <small>
                        {dia.dia
                          ? new Date(`${dia.dia}T12:00:00`).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "short",
                            })
                          : `Dia ${index + 1}`}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState texto="Ainda não há vendas no período." />
              )}
            </section>
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Distribuição por categoria</h2>
                  <p>Unidades vendidas</p>
                </div>
              </div>
              <div className="admin-category-bars">
                {relatorio.vendasPorCategoria.length ? (
                  relatorio.vendasPorCategoria.map((item) => (
                    <div className="admin-category-row" key={item.categoria}>
                      <div>
                        <span>{item.categoria}</span>
                        <strong>
                          {item.quantidade} un. · {BRL(item.total)}
                        </strong>
                      </div>
                      <div className="admin-progress">
                        <i style={{ width: `${Math.max(3, (item.quantidade / maxCategoria) * 100)}%` }} />
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState texto="Sem vendas por categoria." />
                )}
              </div>
            </section>
          </div>
          <div className="admin-overview-grid">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Desempenho de produtos</h2>
                  <p>Produtos ordenados por unidades vendidas</p>
                </div>
              </div>
              {relatorio.maisVendidos.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Unidades</th>
                        <th>Receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatorio.maisVendidos.map((produto) => (
                        <tr key={produto.id}>
                          <td>
                            <strong>{produto.nome}</strong>
                          </td>
                          <td>{produto.vendidos}</td>
                          <td className="admin-money">{BRL(produto.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState texto="Ainda não há produtos vendidos." />
              )}
            </section>
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Status dos pedidos</h2>
                  <p>Quantidade por etapa</p>
                </div>
              </div>
              {statusComPedidos.length ? (
                <div className="admin-report-statuses">
                  {statusComPedidos.map(([status, quantidade]) => (
                    <div key={status}>
                      <span className={`admin-status ${status}`}>{STATUS_LABEL[status as StatusPedido] ?? status}</span>
                      <strong>{quantidade}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState texto="Nenhum pedido registrado." />
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function Overview({
  dashboard,
  pedidos,
  maxVendas,
  maxCategoria,
}: {
  dashboard: Dashboard | null;
  pedidos: PedidoAdmin[];
  maxVendas: number;
  maxCategoria: number;
}) {
  if (!dashboard) return <EmptyState texto="Não foi possível carregar os indicadores." />;
  const indicadores = [
    {
      nome: "Vendas totais",
      valor: BRL(dashboard.totalVendas),
      detalhe: `${dashboard.produtosVendidos} produtos vendidos`,
      Icon: CircleDollarSign,
      cor: "blue",
    },
    {
      nome: "Pedidos",
      valor: String(dashboard.totalPedidos),
      detalhe: "Pedidos registrados",
      Icon: ShoppingBag,
      cor: "violet",
    },
    {
      nome: "Produtos ativos",
      valor: String(dashboard.totalProdutos),
      detalhe: "Itens no catálogo",
      Icon: Boxes,
      cor: "cyan",
    },
    {
      nome: "Clientes",
      valor: String(dashboard.totalUsuarios),
      detalhe: `Ticket médio ${BRL(dashboard.ticketMedio)}`,
      Icon: Activity,
      cor: "green",
    },
  ];
  return (
    <>
      <div className="admin-stats">
        {indicadores.map(({ nome, valor, detalhe, Icon, cor }) => (
          <article className="admin-stat-card" key={nome}>
            <div className={`admin-stat-icon ${cor}`}>
              <Icon size={20} />
            </div>
            <span>{nome}</span>
            <strong>{valor}</strong>
            <small>{detalhe}</small>
          </article>
        ))}
      </div>
      <div className="admin-overview-grid">
        <section className="admin-panel admin-chart-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Vendas recentes</h2>
              <p>Receita por dia</p>
            </div>
            <span className="admin-chart-badge">
              <BarChart3 size={16} /> Últimos dias
            </span>
          </div>
          {dashboard.vendasPorDia.length ? (
            <div className="admin-bars" aria-label="Gráfico de vendas por dia">
              {dashboard.vendasPorDia.map((dia, index) => (
                <div
                  className="admin-bar-column"
                  key={dia.dia ?? `total-${dia.total}`}
                  title={`${dia.dia ?? "Dia"}: ${BRL(dia.total)}`}
                >
                  <span className="admin-bar-value">{dia.total ? BRL(dia.total) : ""}</span>
                  <div className="admin-bar-track">
                    <i style={{ height: `${Math.max(4, (dia.total / maxVendas) * 100)}%` }} />
                  </div>
                  <small>
                    {dia.dia
                      ? new Date(`${dia.dia}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
                      : `Dia ${index + 1}`}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState texto="Ainda não há vendas neste período." />
          )}
        </section>
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Vendas por categoria</h2>
              <p>Produtos vendidos</p>
            </div>
          </div>
          <div className="admin-category-bars">
            {dashboard.vendasPorCategoria.length ? (
              dashboard.vendasPorCategoria.slice(0, 6).map((item) => (
                <div className="admin-category-row" key={item.categoria}>
                  <div>
                    <span>{item.categoria}</span>
                    <strong>{item.quantidade}</strong>
                  </div>
                  <div className="admin-progress">
                    <i style={{ width: `${Math.max(3, (item.quantidade / maxCategoria) * 100)}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <EmptyState texto="Sem vendas por categoria." />
            )}
          </div>
        </section>
      </div>
      <div className="admin-overview-grid">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Pedidos recentes</h2>
              <p>Últimas movimentações</p>
            </div>
            <span className="admin-small-count">{pedidos.length} total</span>
          </div>
          {dashboard.vendasRecentes.length ? (
            <div className="admin-recent-list">
              {dashboard.vendasRecentes.slice(0, 5).map((pedido) => (
                <article key={pedido.id}>
                  <span className="admin-recent-icon">
                    <ShoppingBag size={16} />
                  </span>
                  <span className="admin-recent-info">
                    <strong>{pedido.cliente ?? "Cliente"}</strong>
                    <small>
                      #{pedido.id.slice(0, 8)} ·{" "}
                      {pedido.criado_em ? new Date(pedido.criado_em).toLocaleDateString("pt-BR") : "Data indisponível"}
                    </small>
                  </span>
                  <span className="admin-recent-value">
                    <strong>{BRL(pedido.valor)}</strong>
                    <small>{STATUS_LABEL[pedido.status]}</small>
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState texto="Nenhum pedido cadastrado." />
          )}
        </section>
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Estoque e desempenho</h2>
              <p>Atenção e destaques da loja</p>
            </div>
          </div>
          {dashboard.estoqueBaixo.length ? (
            <div className="admin-low-stock">
              {dashboard.estoqueBaixo.slice(0, 4).map((item) => (
                <div key={item.id}>
                  <span className="admin-warning-icon">
                    <AlertTriangle size={16} />
                  </span>
                  <span>
                    <strong>{item.nome}</strong>
                    <small>Estoque baixo</small>
                  </span>
                  <b>{item.quantidade} un.</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="admin-all-good">
              <Check size={17} /> Todos os produtos estão com estoque suficiente.
            </p>
          )}
          {dashboard.maisVendidos[0] && (
            <div className="admin-top-products">
              <span>MAIS VENDIDO</span>
              <strong>{dashboard.maisVendidos[0].nome}</strong>
              <small>
                {dashboard.maisVendidos[0].vendidos} unidades · {BRL(dashboard.maisVendidos[0].preco)}
              </small>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function EmptyState({ texto }: { texto: string }) {
  return (
    <div className="admin-empty">
      <span>
        <ClipboardList size={21} />
      </span>
      <p>{texto}</p>
    </div>
  );
}
