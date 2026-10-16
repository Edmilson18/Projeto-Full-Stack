import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ProdutoResponse } from "@loja/shared";
import { useRecentes } from "../../hooks/useRecentes.js";

/**
 * O que estes testes travam.
 *
 * O histórico de vistos recentemente guardava o produto inteiro, foto e preço
 * incluídos, e por isso mostrava a foto da primeira visita para sempre — o
 * contrário da vitrine, que lia o catálogo novo. Agora o `localStorage` guarda
 * só ids, e a lista se resolve contra o catálogo vivo a cada render.
 */

const teclado: ProdutoResponse = {
  id: "prod-teclado",
  nome: "Teclado Mecânico RGB",
  descricao: "Switch azul.",
  preco: 299.9,
  quantidade: 10,
  categoria: "Informática",
  imagem: "/imagens/teclado.jpg",
};

const mouse: ProdutoResponse = {
  id: "prod-mouse",
  nome: "Mouse Gamer",
  descricao: "Sensor de 8200 DPI.",
  preco: 150,
  quantidade: 2,
  categoria: "Informática",
  imagem: null,
};

const cadeira: ProdutoResponse = {
  id: "prod-cadeira",
  nome: "Cadeira Ergonômica",
  descricao: "Apoio lombar.",
  preco: 1499,
  quantidade: 5,
  categoria: "Móveis",
  imagem: "/imagens/cadeira.jpg",
};

const monitor: ProdutoResponse = {
  id: "prod-monitor",
  nome: "Monitor LCD 19''",
  descricao: "Painel TN.",
  preco: 899,
  quantidade: 3,
  categoria: "Eletrônicos",
  imagem: "/imagens/monitor.jpg",
};

const catalogo = [teclado, mouse, cadeira, monitor];

function lerRecentes(): unknown[] {
  return JSON.parse(localStorage.getItem("recentesLoja") || "[]");
}

describe("useRecentes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("guarda só o id do produto, nunca o produto inteiro", () => {
    const { result } = renderHook(() => useRecentes(catalogo));

    act(() => {
      result.current.adicionarRecente("prod-teclado");
    });

    expect(lerRecentes()).toEqual(["prod-teclado"]);
    expect(localStorage.getItem("recentesLoja")).toBe('["prod-teclado"]');
  });

  it("lê o formato antigo, que gravava o produto inteiro", () => {
    localStorage.setItem("recentesLoja", JSON.stringify([{ ...teclado, preco: 999 }]));

    const { result } = renderHook(() => useRecentes(catalogo));

    // O item continua aparecendo na lista...
    expect(result.current.recentes.map((produto) => produto.id)).toEqual(["prod-teclado"]);
    // ...mas o que passou a ficar gravado é o id.
    expect(lerRecentes()).toEqual(["prod-teclado"]);
  });

  it("mostra a foto e o preço de hoje, não os da primeira visita", () => {
    localStorage.setItem(
      "recentesLoja",
      JSON.stringify([{ ...teclado, preco: 999, imagem: "https://exemplo.com/foto-velha.jpg" }]),
    );

    const { result } = renderHook(() => useRecentes(catalogo));

    expect(result.current.recentes[0]).toMatchObject({
      preco: teclado.preco,
      imagem: teclado.imagem,
    });
  });

  it("tira da lista o produto que saiu do catálogo", () => {
    localStorage.setItem("recentesLoja", JSON.stringify(["prod-teclado", "prod-descontinuado"]));

    const { result } = renderHook(() => useRecentes(catalogo));

    expect(result.current.recentes.map((produto) => produto.id)).toEqual(["prod-teclado"]);
  });

  it("refaz a lista quando o catálogo muda", () => {
    localStorage.setItem("recentesLoja", JSON.stringify(["prod-teclado"]));

    const { result, rerender } = renderHook(({ produtos }: { produtos: ProdutoResponse[] }) => useRecentes(produtos), {
      initialProps: { produtos: catalogo },
    });
    expect(result.current.recentes[0]?.preco).toBe(teclado.preco);

    // Reajuste no servidor: a mesma entrada, com o número de hoje.
    rerender({ produtos: [{ ...teclado, preco: 100 }] });

    expect(result.current.recentes[0]?.preco).toBe(100);
  });

  it("move o produto visto para o topo sem duplicar", () => {
    const { result } = renderHook(() => useRecentes(catalogo));

    act(() => {
      result.current.adicionarRecente("prod-teclado");
    });
    act(() => {
      result.current.adicionarRecente("prod-mouse");
    });
    act(() => {
      result.current.adicionarRecente("prod-teclado");
    });

    expect(result.current.recentes.map((produto) => produto.id)).toEqual(["prod-teclado", "prod-mouse"]);
    expect(lerRecentes()).toEqual(["prod-teclado", "prod-mouse"]);
  });

  it("guarda no máximo quatro", () => {
    const { result } = renderHook(() => useRecentes(catalogo));

    act(() => {
      ["prod-teclado", "prod-mouse", "prod-cadeira", "prod-monitor", "prod-teclado"].forEach((id) =>
        result.current.adicionarRecente(id),
      );
    });

    expect(result.current.recentes).toHaveLength(4);
    expect(lerRecentes()).toHaveLength(4);
  });

  it("começa vazio quando o que está salvo não é lista", () => {
    localStorage.setItem("recentesLoja", "não é json");

    const { result } = renderHook(() => useRecentes(catalogo));

    expect(result.current.recentes).toEqual([]);
  });
});
