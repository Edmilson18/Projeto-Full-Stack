import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProductCard } from "../../components/ProductCard.js";
import type { ProdutoResponse } from "@loja/shared";

const produtoMock: ProdutoResponse = {
  id: "prod-1",
  nome: "Teclado Mecânico",
  descricao: "Teclado mecânico RGB",
  preco: 299.9,
  quantidade: 10,
  categoria: "Periféricos",
  imagem: null,
};

describe("ProductCard", () => {
  it("deve renderizar o nome do produto", () => {
    render(<ProductCard produto={produtoMock} onAbrir={vi.fn()} onFavoritar={vi.fn()} onAdicionar={vi.fn()} />);
    expect(screen.getByText("Teclado Mecânico")).toBeInTheDocument();
  });

  it("deve renderizar o preço formatado", () => {
    render(<ProductCard produto={produtoMock} onAbrir={vi.fn()} onFavoritar={vi.fn()} onAdicionar={vi.fn()} />);
    expect(screen.getByText("R$ 299,90")).toBeInTheDocument();
  });

  it("deve chamar onAbrir ao clicar no card", () => {
    const onAbrir = vi.fn();
    render(<ProductCard produto={produtoMock} onAbrir={onAbrir} onFavoritar={vi.fn()} onAdicionar={vi.fn()} />);
    fireEvent.click(screen.getByText("Teclado Mecânico"));
    expect(onAbrir).toHaveBeenCalledWith(produtoMock);
  });

  it("deve chamar onAdicionar ao clicar em Adicionar", () => {
    const onAdicionar = vi.fn();
    render(<ProductCard produto={produtoMock} onAbrir={vi.fn()} onFavoritar={vi.fn()} onAdicionar={onAdicionar} />);
    fireEvent.click(screen.getByText("Adicionar"));
    expect(onAdicionar).toHaveBeenCalledWith(produtoMock);
  });

  it("deve chamar onFavoritar ao clicar no coração", () => {
    const onFavoritar = vi.fn();
    render(<ProductCard produto={produtoMock} onAbrir={vi.fn()} onFavoritar={onFavoritar} onAdicionar={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Adicionar aos favoritos"));
    expect(onFavoritar).toHaveBeenCalledWith("prod-1");
  });
});
