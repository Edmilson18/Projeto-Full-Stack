import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App.js";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();

vi.mock("../lib/api.js", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: vi.fn(),
  },
}));

const USUARIO = { id: "u1", nome: "Cliente", email: "cliente@exemplo.com", role: "cliente" };

const PRODUTOS = [
  {
    id: "prod-headset",
    nome: "Headset Wireless Studio",
    descricao: "Audio estereo",
    preco: 899,
    quantidade: 10,
    categoria: "cat-eletronicos",
  },
];

describe("entrada e catálogo", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("link de redefinição abre o formulário mesmo com sessão existente", async () => {
    mockApi(USUARIO);
    window.history.replaceState(null, "", "/?resetToken=token-teste&origem=portfolio#conta");
    render(<App />);
    expect(await screen.findByRole("dialog", { name: "Definir nova senha" })).toBeInTheDocument();
    expect(window.location.search).toBe("?origem=portfolio");
    expect(window.location.hash).toBe("#conta");
  });

  it("erro de catálogo oferece nova tentativa e mostra os produtos ao recuperar", async () => {
    mockApi(null);
    let falhar = true;
    get.mockImplementation((url: string) => {
      if (url === "/sessao") return Promise.resolve({ usuario: null });
      if (url === "/produtos")
        return falhar ? Promise.reject(new Error("Conexão indisponível")) : Promise.resolve(PRODUTOS);
      return Promise.resolve([]);
    });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar o catálogo");
    falhar = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findAllByText("Headset Wireless Studio");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adicionar pelo modal também exige login", async () => {
    mockApi(null);
    render(<App />);
    const nomes = await screen.findAllByText("Headset Wireless Studio");
    fireEvent.click(nomes[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar ao carrinho" }));
    expect(await screen.findByText("Faça login para comprar")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("carrinho") ?? "[]")).toEqual([]);
  });
});

function mockApi(usuario: unknown) {
  get.mockReset();
  post.mockReset();
  put.mockReset();

  get.mockImplementation((url: string) => {
    if (url === "/sessao") return Promise.resolve({ usuario });
    if (url === "/produtos") return Promise.resolve(PRODUTOS);
    if (url === "/conta") return Promise.resolve({ perfil: { nome: "Cliente" }, pedidos: [], favoritos: [] });
    return Promise.resolve([]);
  });
  localStorage.clear();
}

async function entrarNaApp() {
  render(<App />);
  await screen.findByLabelText("Sair da conta");
}

async function tentarLogin() {
  render(<App />);
  await screen.findByRole("button", { name: "Entrar" });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

  fireEvent.change(await screen.findByLabelText("E-mail"), {
    target: { value: "ninguem@exemplo.com" },
  });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senhaErrada1" } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar", hidden: false }));
}

describe("logout", () => {
  beforeEach(() => {
    mockApi(USUARIO);
    post.mockResolvedValue({ mensagem: "Sessão encerrada." });
  });

  afterEach(() => cleanup());

  it("pede confirmação antes de encerrar a sessão", async () => {
    await entrarNaApp();

    fireEvent.click(screen.getByLabelText("Sair da conta"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Você realmente deseja sair?")).toBeInTheDocument();
    // Nada foi enviado ao servidor: a sessão continua ativa enquanto a pessoa
    // não confirmar.
    expect(post).not.toHaveBeenCalledWith("/logout", expect.anything());
  });

  it("mantém a sessão quando a confirmação é cancelada", async () => {
    await entrarNaApp();

    fireEvent.click(screen.getByLabelText("Sair da conta"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalledWith("/logout", expect.anything());
    expect(screen.getByLabelText("Sair da conta")).toBeInTheDocument();
  });

  it("encerra a sessão e redireciona para a tela de login ao confirmar", async () => {
    await entrarNaApp();

    fireEvent.click(screen.getByLabelText("Sair da conta"));
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    expect(post).toHaveBeenCalledWith("/logout", {});
    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByText(/você saiu da sua conta/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Sair da conta")).not.toBeInTheDocument();
  });
});

describe("login com e-mail inexistente", () => {
  beforeEach(() => {
    mockApi(null);
  });

  afterEach(() => cleanup());

  it("mostra o aviso de credencial inválida como pop-up flutuante", async () => {
    post.mockRejectedValue(new Error("E-mail ou senha inválidos."));

    await tentarLogin();

    // Antes o aviso era escrito no estado do `App` e nunca renderizado, porque
    // a tela de login ocupa a tela inteira: o botão parecia não fazer nada.
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent(/e-mail ou senha inválidos/i);
    expect(aviso).toHaveClass("toast-message");
  });

  it("mantém o e-mail digitado ao seguir para a criação de conta", async () => {
    post.mockRejectedValue(new Error("E-mail ou senha inválidos."));

    await tentarLogin();
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "Criar uma nova conta" }));

    // Quem não tem conta não deveria ter que redigitar o endereço.
    expect(screen.getByLabelText("E-mail")).toHaveValue("ninguem@exemplo.com");
    // E o erro de login não pode ficar pendurado sobre o formulário de cadastro.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
