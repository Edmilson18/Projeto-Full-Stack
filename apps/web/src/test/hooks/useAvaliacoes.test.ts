import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AvaliacaoResponse } from "@loja/shared";
import { useAvaliacoes } from "../../hooks/useAvaliacoes.js";
import { respostaPendente } from "../ajuda.js";
const get = vi.fn();
vi.mock("../../lib/api.js", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

describe("avaliações do produto aberto", () => {
  const erro = vi.fn();
  beforeEach(() => {
    get.mockReset();
    erro.mockReset();
  });
  afterEach(() => cleanup());

  it("avaliação atrasada de A não aparece no produto B", async () => {
    const a = respostaPendente<AvaliacaoResponse[]>();
    get.mockReturnValueOnce(a.promise).mockResolvedValue([{ nome: "Compra de B", nota: 4 }]);
    const { result, rerender } = renderHook<ReturnType<typeof useAvaliacoes>, { id: string | null }>(
      ({ id }) => useAvaliacoes(id, erro),
      {
        initialProps: { id: "a" },
      },
    );
    rerender({ id: "b" });
    await waitFor(() => expect(result.current.avaliacoes[0]?.nome).toBe("Compra de B"));
    await act(async () => {
      a.resolver([{ nome: "Compra de A", nota: 1 }]);
    });
    expect(result.current.avaliacoes[0]?.nome).toBe("Compra de B");
  });

  it("erro atrasado de um produto fechado não aparece no próximo", async () => {
    const a = respostaPendente<AvaliacaoResponse[]>();
    get.mockReturnValue(a.promise);
    const { rerender } = renderHook<ReturnType<typeof useAvaliacoes>, { id: string | null }>(
      ({ id }) => useAvaliacoes(id, erro),
      {
        initialProps: { id: "a" },
      },
    );
    rerender({ id: null });
    await act(async () => {
      a.rejeitar(new Error("Falha antiga"));
    });
    expect(erro).not.toHaveBeenCalled();
  });
});
