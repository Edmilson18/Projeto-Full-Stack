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
    vi.clearAllMocks();
  });

  it("carrega os indicadores e abre o formulário de produto", async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(
        {
          "/dashboard": dashboard,
          "/admin/produtos": [produto],
          "/categorias": [{ id: "c1", nome: "Eletrônicos" }],
          "/admin/pedidos": [],
        }[url],
      ),
    );

    render(
      <AdminDashboard tema="claro" nome="Admin" email="admin@exemplo.com" onToggleTema={vi.fn()} onSair={vi.fn()} />,
    );
    expect(await screen.findByText("Vendas totais")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/dashboard");
    expect(get).toHaveBeenCalledWith("/admin/produtos");

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
    expect(screen.getByText("Desempenho de produtos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeInTheDocument();
  });
});
