import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
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
 * Os favoritos ficam no servidor, mas a versão anterior do app também os
 * espelhava no `localStorage`. Esses testes travam as duas propriedades que
 * quebraram: o navegador não pode semear a lista, e perder a sessão tem de
 * limpá-la — senão o coração continua marcado para quem não entrou em conta
 * nenhuma.
 */
describe("useFavoritos", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    del.mockReset();
    put.mockResolvedValue({ favorito: true });
    del.mockResolvedValue({ favorito: false });
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("ignora o que estiver salvo no navegador", () => {
    localStorage.setItem("favoritosLoja", JSON.stringify(["prod-headset", "prod-cam"]));

    const { result } = renderHook(() => useFavoritos({ usuarioLogado: false }));

    expect(result.current.favoritos).toEqual([]);
  });

  it("apaga a chave antiga do navegador", () => {
    localStorage.setItem("favoritosLoja", JSON.stringify(["prod-headset"]));

    renderHook(() => useFavoritos({ usuarioLogado: false }));

    expect(localStorage.getItem("favoritosLoja")).toBeNull();
  });

  it("não grava favoritos no navegador", async () => {
    const { result } = renderHook(() => useFavoritos({ usuarioLogado: true }));

    await act(async () => {
      await result.current.alternarFavorito("prod-headset");
    });

    expect(localStorage.getItem("favoritosLoja")).toBeNull();
  });

  it("marca o favorito e chama a API quando há sessão", async () => {
    const { result } = renderHook(() => useFavoritos({ usuarioLogado: true }));

    await act(async () => {
      await result.current.alternarFavorito("prod-headset");
    });

    expect(result.current.favoritos).toEqual(["prod-headset"]);
    // A rota de escrita é `PUT`: grava o estado desejado em vez de alternar.
    expect(put).toHaveBeenCalledWith("/favoritos/prod-headset", {});
  });

  it("não marca nada nem chama a API quando não há sessão", async () => {
    const { result } = renderHook(() => useFavoritos({ usuarioLogado: false }));

    await act(async () => {
      await result.current.alternarFavorito("prod-headset");
    });

    expect(result.current.favoritos).toEqual([]);
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("limpa a lista ao encerrar a sessão", async () => {
    const { result, rerender } = renderHook(
      ({ usuarioLogado }: { usuarioLogado: boolean }) => useFavoritos({ usuarioLogado }),
      { initialProps: { usuarioLogado: true } },
    );

    await act(async () => {
      await result.current.alternarFavorito("prod-headset");
    });
    expect(result.current.favoritos).toEqual(["prod-headset"]);

    rerender({ usuarioLogado: false });

    expect(result.current.favoritos).toEqual([]);
  });

  it("reverte o favorito quando a API falha", async () => {
    put.mockRejectedValueOnce(new Error("falhou"));
    const { result } = renderHook(() => useFavoritos({ usuarioLogado: true }));

    await act(async () => {
      await result.current.alternarFavorito("prod-headset");
    });

    expect(result.current.favoritos).toEqual([]);
  });
});
