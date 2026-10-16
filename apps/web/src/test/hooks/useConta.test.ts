import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Conta } from "@loja/shared";
import { useConta } from "../../hooks/useConta.js";
import { renovarEscopoSessao } from "../../lib/sessao.js";
import { respostaPendente } from "../ajuda.js";

const get = vi.fn();
const put = vi.fn();
vi.mock("../../lib/api.js", () => ({
  api: { get: (...args: unknown[]) => get(...args), put: (...args: unknown[]) => put(...args) },
}));

function conta(id: string, rua = `Rua ${id}`): Conta {
  return {
    perfil: { id, nome: id, email: `${id}@exemplo.com`, role: "cliente", rua },
    pedidos: [],
    favoritos: [],
    minhasAvaliacoes: [],
  };
}

describe("isolamento da conta", () => {
  const onFavoritos = vi.fn();
  const onErro = vi.fn();
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    onFavoritos.mockReset();
    onErro.mockReset();
    renovarEscopoSessao();
  });
  afterEach(() => cleanup());
  const montar = (usuarioId: string | null = "a") =>
    renderHook(({ id }: { id: string | null }) => useConta({ usuarioId: id, onFavoritos, onErro }), {
      initialProps: { id: usuarioId },
    });

  it("resposta da conta A não substitui B após a troca de usuário", async () => {
    const a = respostaPendente<Conta>();
    get.mockReturnValueOnce(a.promise).mockResolvedValue(conta("b"));
    const { result, rerender } = montar();
    renovarEscopoSessao();
    rerender({ id: "b" });
    await waitFor(() => expect(result.current.dadosConta?.perfil.id).toBe("b"));
    await act(async () => {
      a.resolver(conta("a"));
    });
    expect(result.current.dadosConta?.perfil.id).toBe("b");
    expect(onFavoritos).toHaveBeenCalledTimes(1);
  });

  it("ignora erro de conta anterior depois de sair", async () => {
    const a = respostaPendente<Conta>();
    get.mockReturnValue(a.promise);
    const { result, rerender } = montar();
    renovarEscopoSessao();
    rerender({ id: null });
    await act(async () => {
      a.rejeitar(new Error("Erro da conta anterior"));
    });
    expect(result.current.dadosConta).toBeNull();
    expect(onErro).not.toHaveBeenCalled();
  });

  it("callback antigo não inicia outra consulta da conta A quando B já entrou", async () => {
    get.mockResolvedValueOnce(conta("a")).mockResolvedValue(conta("b"));
    const { result, rerender } = montar();
    await waitFor(() => expect(result.current.dadosConta?.perfil.id).toBe("a"));
    const antigo = result.current.carregarConta;
    renovarEscopoSessao();
    rerender({ id: "b" });
    await waitFor(() => expect(result.current.dadosConta?.perfil.id).toBe("b"));
    await act(async () => {
      await antigo();
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.dadosConta?.perfil.id).toBe("b");
  });

  it("salvamento atrasado de A não troca o endereço de B", async () => {
    const salvamento = respostaPendente<{ perfil: Conta["perfil"] }>();
    get.mockResolvedValueOnce(conta("a")).mockResolvedValue(conta("b"));
    put.mockReturnValue(salvamento.promise);
    const { result, rerender } = montar();
    await waitFor(() => expect(result.current.dadosConta?.perfil.id).toBe("a"));
    let salvar!: Promise<void>;
    act(() => {
      salvar = result.current.salvarEndereco({ rua: "Nova rua A" });
    });
    renovarEscopoSessao();
    rerender({ id: "b" });
    await waitFor(() => expect(result.current.dadosConta?.perfil.id).toBe("b"));
    await act(async () => {
      salvamento.resolver({ perfil: conta("a", "Nova rua A").perfil });
      await salvar;
    });
    expect(result.current.dadosConta?.perfil.rua).toBe("Rua b");
  });
});
