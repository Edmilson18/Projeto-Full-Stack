import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useAuth } from "../../hooks/useAuth.js";
import { EVENTO_SESSAO_EXPIRADA } from "../../lib/sessao.js";
import { respostaPendente } from "../ajuda.js";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../lib/api.js", () => ({
  api: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args) },
}));
const usuario = { id: "ana", nome: "Ana", email: "ana@exemplo.com", role: "cliente" };

describe("ciclo da autenticação", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });
  afterEach(() => cleanup());

  it("uma sessão inicial atrasada não apaga um login novo", async () => {
    const pendente = respostaPendente<{ usuario: null }>();
    get.mockReturnValue(pendente.promise);
    post.mockResolvedValue({ usuario });
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.login(usuario.email, "senha123");
    });
    await act(async () => {
      pendente.resolver({ usuario: null });
    });
    expect(result.current.usuario).toEqual(usuario);
    expect(result.current.carregando).toBe(false);
  });

  it("uma consulta inicial não restaura a conta depois do logout", async () => {
    const pendente = respostaPendente<{ usuario: typeof usuario }>();
    get.mockReturnValue(pendente.promise);
    post.mockResolvedValue({ mensagem: "ok" });
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.logout();
    });
    await act(async () => {
      pendente.resolver({ usuario });
    });
    expect(result.current.usuario).toBeNull();
    expect(result.current.carregando).toBe(false);
  });

  it("expiração invalida a sessão visível", async () => {
    get.mockResolvedValue({ usuario });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.usuario).toEqual(usuario));
    act(() => window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA)));
    expect(result.current.usuario).toBeNull();
  });

  it("falha de logout mantém a conta autenticada", async () => {
    get.mockResolvedValue({ usuario });
    post.mockRejectedValue(new Error("Sem conexão"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.usuario).toEqual(usuario));
    await act(async () => {
      await expect(result.current.logout()).rejects.toThrow("Sem conexão");
    });
    expect(result.current.usuario).toEqual(usuario);
  });
});
