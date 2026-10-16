import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Conta } from "@loja/shared";
import { AccountModal } from "../../components/AccountModal.js";

const usuario = { id: "a", nome: "Ana", email: "ana@exemplo.com", role: "cliente" as const };
const conta: Conta = {
  perfil: { ...usuario, rua: "Rua Salva", numero: "25", cidade: "Recife", estado: "PE" },
  pedidos: [],
  favoritos: [],
  minhasAvaliacoes: [],
};
const props = {
  usuario,
  onFechar: vi.fn(),
  onSalvarEndereco: vi.fn(),
  onDesfavoritar: vi.fn(),
  onAbrirProduto: vi.fn(),
  onMensagem: vi.fn(),
};

describe("endereço da conta", () => {
  afterEach(() => cleanup());

  it("preenche o endereço que chega depois da abertura", () => {
    const { rerender } = render(<AccountModal {...props} dadosConta={null} />);
    rerender(<AccountModal {...props} dadosConta={conta} />);
    expect(screen.getByLabelText("Rua")).toHaveValue("Rua Salva");
    expect(screen.getByLabelText("Número")).toHaveValue("25");
  });

  it("recarga e sugestão não apagam o que a pessoa editou ou limpou", () => {
    const { rerender } = render(<AccountModal {...props} dadosConta={conta} />);
    fireEvent.change(screen.getByLabelText("Rua"), { target: { value: "Rua digitada" } });
    fireEvent.change(screen.getByLabelText("Número"), { target: { value: "" } });
    rerender(
      <AccountModal
        {...props}
        dadosConta={{ ...conta, perfil: { ...conta.perfil, rua: "Rua recarregada", numero: "90" } }}
        enderecoSugerido={{ cep: "50000-000", rua: "Rua sugerida", bairro: "Centro", cidade: "Olinda", estado: "PE" }}
      />,
    );
    expect(screen.getByLabelText("Rua")).toHaveValue("Rua digitada");
    expect(screen.getByLabelText("Número")).toHaveValue("");
    expect(screen.getByLabelText("Cidade")).toHaveValue("Recife");
    expect(screen.getByLabelText("CEP")).toHaveValue("50000-000");
  });
});
