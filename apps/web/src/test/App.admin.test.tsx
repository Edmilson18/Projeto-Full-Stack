import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "../App.js";

const { get, post, put, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock("../lib/api.js", () => ({ api: { get, post, put, patch, delete: vi.fn() } }));

describe("entrada administrativa", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("abre o painel quando a sessão autenticada tem papel admin", async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(
        {
          "/sessao": { usuario: { id: "adm1", nome: "Administradora", email: "admin@exemplo.com", role: "admin" } },
          "/dashboard": {
            totalProdutos: 0,
            totalUsuarios: 0,
            totalPedidos: 0,
            totalVendas: 0,
            ticketMedio: 0,
            produtosVendidos: 0,
            vendasRecentes: [],
            vendasPorDia: [],
            vendasPorCategoria: [],
            pedidosPorStatus: {},
            estoqueBaixo: [],
            maisVendidos: [],
          },
          "/admin/produtos": [],
          "/categorias": [],
          "/admin/pedidos": [],
          "/produtos": [],
        }[url] ?? [],
      ),
    );

    render(<App />);
    expect(await screen.findByText("CENTRAL DE CONTROLE")).toBeInTheDocument();
    expect(screen.getByText("admin@exemplo.com")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bem-vindo" })).not.toBeInTheDocument();
  });
});
