import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminDashboard } from "../../components/AdminDashboard.js";

const { get, post, put, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock("../../lib/api.js", () => ({ api: { get, post, put, patch, delete: vi.fn() } }));

const dashboard = {
  totalProdutos: 1,
  totalUsuarios: 2,
  totalPedidos: 1,
  totalVendas: 299.9,
  ticketMedio: 299.9,
  produtosVendidos: 1,
  vendasRecentes: [],
  vendasPorDia: [{ dia: "2026-10-15", total: 299.9 }],
  vendasPorCategoria: [{ categoria: "Eletrônicos", quantidade: 1 }],
  pedidosPorStatus: { processando: 1 },
  estoqueBaixo: [],
  maisVendidos: [],
};
const relatorio = {
  totalReceita: 299.9,
  totalPedidos: 1,
  ticketMedio: 299.9,
  produtosVendidos: 1,
  vendasPorDia: [{ dia: "2026-10-15", total: 299.9 }],
  vendasPorCategoria: [{ categoria: "Eletrônicos", quantidade: 1, total: 299.9 }],
  maisVendidos: [{ id: "p1", nome: "Teclado", preco: 299.9, vendidos: 1, total: 299.9 }],
  pedidosPorStatus: { processando: 1 },
};
const produto = {
  id: "p1",
  nome: "Teclado",
  descricao: "Mecânico",
  preco: 299.9,
  quantidade: 8,
  categoria: "Eletrônicos",
  imagem: null,
  ativo: true,
};

describe("painel administrativo", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("carrega os indicadores e abre o formulário de produto", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const URLOriginal = globalThis.URL;
    const criarObjetoUrl = vi.fn().mockReturnValue("blob:relatorio-teste");
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URLOriginal {}, { createObjectURL: criarObjetoUrl, revokeObjectURL: vi.fn() }),
    );
    get.mockImplementation((url: string) =>
      Promise.resolve(
        {
          "/dashboard": dashboard,
          "/admin/produtos": [produto],
          "/categorias": [{ id: "c1", nome: "Eletrônicos" }],
          "/admin/pedidos": [],
        }[url] ?? (url.startsWith("/admin/relatorios?") ? relatorio : undefined),
      ),
    );

    render(
      <AdminDashboard tema="claro" nome="Admin" email="admin@exemplo.com" onToggleTema={vi.fn()} onSair={vi.fn()} />,
    );
    expect(await screen.findByText("Vendas totais")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/dashboard");
    expect(get).toHaveBeenCalledWith("/admin/produtos");
    fireEvent.click(screen.getByRole("button", { name: "Baixar planilha CSV" }));
    expect(screen.getByRole("dialog", { name: "Confirmar download" })).toHaveTextContent(
      "relatorio-visao-geral-loja-tech.csv",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));
    expect(screen.getByRole("dialog", { name: "Confirmar download" })).toHaveTextContent(
      "relatorio-visao-geral-loja-tech.pdf",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Filtrar relatórios" }));
    expect(await screen.findByRole("region", { name: "Filtros dos relatórios" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Produtos" }));
    expect(await screen.findByText("Teclado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    const formulario = screen.getByRole("dialog", { name: "Cadastrar produto" });
    expect(formulario.parentElement).toHaveClass("admin-modal-backdrop");
    expect(screen.getByRole("heading", { name: "Cadastrar produto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Categoria")).toHaveValue("c1");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Relatórios" }));
    expect(screen.getByRole("heading", { name: "Relatórios" })).toBeInTheDocument();
    expect(await screen.findByText("Desempenho de produtos")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Categoria do produto" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Produto" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/admin\/relatorios\?inicio=\d{4}-\d{2}-\d{2}&fim=\d{4}-\d{2}-\d{2}$/),
    );
    expect(await screen.findByText("Relatório atualizado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Baixar planilha CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, baixar arquivo" }));
    const csvSemCategoria = criarObjetoUrl.mock.calls.at(-1)?.[0] as Blob;
    expect(await csvSemCategoria.text()).not.toContain('\r\n"Categoria";');

    const filtroCategoria = screen.getByRole("combobox", { name: "Categoria do produto" });
    fireEvent.change(filtroCategoria, { target: { value: "" } });
    const filtroProduto = screen.getByRole("combobox", { name: "Produto" });
    fireEvent.change(filtroProduto, { target: { value: "p1" } });
    expect(filtroProduto).toHaveValue("p1");
    expect(filtroCategoria).toHaveValue("c1");
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(
      await screen.findByText(/Os gráficos abaixo mostram:.*Categoria: Eletrônicos.*Produto: Teclado/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Atualizar painel" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Baixar planilha CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, baixar arquivo" }));
    const csvComCategoriaDoProduto = criarObjetoUrl.mock.calls.at(-1)?.[0] as Blob;
    expect(await csvComCategoriaDoProduto.text()).toContain('\r\n"Categoria";"Eletrônicos"');
    expect(await csvComCategoriaDoProduto.text()).toContain('\r\n"Produto";"Teclado"');

    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, baixar arquivo" }));
    const pdfComCategoriaDoProduto = criarObjetoUrl.mock.calls.at(-1)?.[0] as Blob;
    expect(await pdfComCategoriaDoProduto.text()).toContain("Categoria  |  Eletronicos");
    expect(await pdfComCategoriaDoProduto.text()).toContain("Produto  |  Teclado");
  });
});
