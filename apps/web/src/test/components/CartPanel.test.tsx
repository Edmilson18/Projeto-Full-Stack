import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CartPanel } from "../../components/CartPanel.js";

describe("seleção do carrinho", () => {
  afterEach(() => cleanup());

  it("desconsidera o item selecionado que saiu do carrinho", () => {
    const a = {
      id: "a",
      nome: "Mouse",
      descricao: "",
      categoria: "Acessórios",
      preco: 30,
      quantidade: 5,
      quantidadeCarrinho: 1,
    };
    const b = { ...a, id: "b", nome: "Teclado" };
    const comprar = vi.fn();
    const props = {
      onAlterarQuantidade: vi.fn(),
      onRemoverItem: vi.fn(),
      onLimparCarrinho: vi.fn(),
      onFechar: vi.fn(),
      onComprarSelecionados: comprar,
    };
    const { rerender } = render(<CartPanel {...props} carrinho={[a, b]} />);
    fireEvent.click(screen.getByLabelText("Selecionar Mouse"));
    rerender(<CartPanel {...props} carrinho={[b]} />);
    expect(screen.queryByRole("button", { name: "Comprar selecionados" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Selecionar Teclado")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Selecionar todos" }));
    fireEvent.click(screen.getByRole("button", { name: "Comprar selecionados" }));
    expect(comprar).toHaveBeenCalledWith(["b"]);
  });
});
