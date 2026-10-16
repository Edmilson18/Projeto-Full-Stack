import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginPage } from "../../components/LoginPage.js";

function propriedades() {
  return {
    tema: "claro" as const,
    onToggleTema: vi.fn(),
    onLogin: vi.fn(),
    onCadastrar: vi.fn(),
    onRecuperarSenha: vi.fn(),
    onRedefinirSenha: vi.fn().mockResolvedValue(undefined),
    onFechar: vi.fn(),
    onMensagem: vi.fn(),
  };
}

describe("recuperação de senha", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("abre o token da URL e remove somente esse parâmetro do endereço", async () => {
    window.history.replaceState(null, "", "/?origem=portfolio&resetToken=token-local#conta");
    const props = propriedades();
    render(<LoginPage {...props} />);
    expect(screen.getByRole("dialog", { name: "Definir nova senha" })).toBeInTheDocument();
    expect(window.location.search).toBe("?origem=portfolio");
    expect(window.location.hash).toBe("#conta");
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "senhaNova123" } });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "senhaNova123" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(props.onRedefinirSenha).toHaveBeenCalledWith("token-local", "senhaNova123");
  });

  it("o modo local abre diretamente a redefinição com o token recebido", async () => {
    const props = propriedades();
    props.onRecuperarSenha.mockResolvedValue({ mensagem: "Demonstração local", token: "token-local" });
    render(<LoginPage {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
    fireEvent.change(screen.getByLabelText("E-mail da conta"), { target: { value: "ana@exemplo.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Solicitar recuperação" }));
    expect(await screen.findByRole("dialog", { name: "Definir nova senha" })).toBeInTheDocument();
    expect(props.onMensagem).toHaveBeenCalledWith("Demonstração local");
  });

  it("mostra a indisponibilidade sem prometer um e-mail enviado", async () => {
    const props = propriedades();
    props.onRecuperarSenha.mockRejectedValue(new Error("O envio de e-mail ainda não está disponível."));
    render(<LoginPage {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
    fireEvent.change(screen.getByLabelText("E-mail da conta"), { target: { value: "ana@exemplo.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Solicitar recuperação" }));
    await waitFor(() => expect(props.onMensagem).toHaveBeenCalledWith("O envio de e-mail ainda não está disponível."));
    expect(screen.getByRole("dialog", { name: "Recuperar senha" })).toBeInTheDocument();
    expect(screen.queryByText(/instruções enviadas/i)).not.toBeInTheDocument();
  });
});
