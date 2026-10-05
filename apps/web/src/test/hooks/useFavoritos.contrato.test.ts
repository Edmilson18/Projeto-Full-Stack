import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useFavoritos } from "../../hooks/useFavoritos.js";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock("../../lib/api.js", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }

  return {
    api: {
      get: (...args: unknown[]) => get(...args),
      post: (...args: unknown[]) => post(...args),
      put: (...args: unknown[]) => put(...args),
      delete: (...args: unknown[]) => del(...args),
    },
    ApiError,
  };
});

/**
 * O servidor grava o estado desejado (`PUT`/`DELETE`) em vez de alternar. O
 * cliente continua calculando o estado novo para responder na hora, mas duas
 * chamadas com a mesma intenção precisam produzir o mesmo resultado no banco.
 */
describe("useFavoritos — contrato com o servidor", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    del.mockReset();
    put.mockResolvedValue({ favorito: true });
    del.mockResolvedValue({ favorito: false });
    localStorage.clear();
  });

  afterEach(() => localStorage.clear());

  it("marca com PUT, sem POST", async () => {
    const { result } = renderHook(() => useFavoritos({ usuarioLogado: true }));

    await act(async () => {
      await result.current.alternarFavorito("prod-mouse");
    });

    expect(put).toHaveBeenCalledWith("/favoritos/prod-mouse", {});
    // POST era a rota do toggle, a fonte da inversão silenciosa.
    expect(post).not.toHaveBeenCalled();
  });

  it("desmarca com DELETE", async () => {
    const { result } = renderHook(() => useFavoritos({ usuarioLogado: true }));

    await act(async () => {
      await result.current.alternarFavorito("prod-mouse");
    });
    await waitFor(() => expect(result.current.favoritos).toEqual(["prod-mouse"]));

    await act(async () => {
      await result.current.alternarFavorito("prod-mouse");
    });

    expect(del).toHaveBeenCalledWith("/favoritos/prod-mouse");
    expect(result.current.favoritos).toEqual([]);
  });

  it("reverte o estado local quando o servidor recusa", async () => {
    put.mockRejectedValueOnce(new Error("recusado"));
    const { result } = renderHook(() => useFavoritos({ usuarioLogado: true }));

    await act(async () => {
      await result.current.alternarFavorito("prod-mouse");
    });

    expect(result.current.favoritos).toEqual([]);
  });

  it("envia a mesma intenção em cliques repetidos sobre o mesmo produto", async () => {
    // Duas chamadas concorrentes partindo do mesmo estado lido enviariam o mesmo
    // verbo e o mesmo corpo. O servidor não pode invertê-las.
    const { result } = renderHook(() => useFavoritos({ usuarioLogado: true }));

    await act(async () => {
      await Promise.all([result.current.alternarFavorito("prod-mouse"), result.current.alternarFavorito("prod-mouse")]);
    });

    // Ambas viram PUT (nenhuma tinha visto o estado novo ainda), e nenhuma é
    // POST/toggle.
    expect(put).toHaveBeenCalledTimes(2);
    expect(del).not.toHaveBeenCalled();
    for (const chamada of put.mock.calls) {
      expect(chamada).toEqual(["/favoritos/prod-mouse", {}]);
    }
  });
});
