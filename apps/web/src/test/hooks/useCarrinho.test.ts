import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ProdutoResponse } from "@loja/shared";
import { useCarrinho } from "../../hooks/useCarrinho.js";

/**
 * O que estes testes travam.
 *
 * O carrinho deixou de gravar o produto inteiro no `localStorage` e passou a
 * gravar só `id` + quantidade, remontando o item contra o catálogo de hoje.
 * O defeito que essa mudança mata: o item congelava nome, preço e foto no
 * momento em que entrou, e uma semana depois o carrinho discordava da vitrine
 * — cobrando um preço que o produto já não tinha.
 */

const teclado: ProdutoResponse = {
  id: "prod-teclado",
  nome: "Teclado Mecânico RGB",
  descricao: "Switch azul e iluminação por tecla.",
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
  // Estoque baixo de propósito: é ele que prova que o limite vem do catálogo.
  quantidade: 2,
  categoria: "Informática",
  imagem: null,
};

/** Formato gravado hoje: `{ id, quantidadeCarrinho }`, sem mais nada. */
function gravarCarrinho(entradas: Array<{ id: string; quantidadeCarrinho: number }>) {
  localStorage.setItem("carrinho", JSON.stringify(entradas));
}

function lerCarrinho(): Array<Record<string, unknown>> {
  return JSON.parse(localStorage.getItem("carrinho") || "[]");
}

describe("useCarrinho", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("guarda só o id e a quantidade, nunca o produto inteiro", () => {
    const { result } = renderHook(() => useCarrinho([teclado]));

    act(() => {
      result.current.adicionarAoCarrinho(teclado);
    });

    expect(lerCarrinho()).toEqual([{ id: "prod-teclado", quantidadeCarrinho: 1 }]);
  });

  it("lê o formato antigo, que gravava o produto inteiro", () => {
    localStorage.setItem(
      "carrinho",
      JSON.stringify([
        {
          ...teclado,
          preco: 999,
          quantidadeCarrinho: 2,
        },
      ]),
    );

    const { result } = renderHook(() => useCarrinho([teclado]));

    // O item volta para a lista, com o id e a quantidade que interessam.
    expect(result.current.carrinho).toHaveLength(1);
    expect(result.current.carrinho[0]).toMatchObject({ id: "prod-teclado", quantidadeCarrinho: 2 });
    // E o que fica gravado é o formato novo: na próxima leitura não há mais
    // produto inteiro para separar.
    expect(lerCarrinho()).toEqual([{ id: "prod-teclado", quantidadeCarrinho: 2 }]);
  });

  it("mostra o preço de hoje, não o que estava salvo", () => {
    localStorage.setItem(
      "carrinho",
      JSON.stringify([{ ...teclado, preco: 999, quantidade: 99, quantidadeCarrinho: 1 }]),
    );

    const { result } = renderHook(() => useCarrinho([teclado]));

    expect(result.current.carrinho[0]?.preco).toBe(teclado.preco);
    expect(result.current.totalCarrinho).toBeCloseTo(teclado.preco);
  });

  it("tira da lista o produto que saiu do catálogo", () => {
    gravarCarrinho([
      { id: "prod-teclado", quantidadeCarrinho: 1 },
      { id: "prod-descontinuado", quantidadeCarrinho: 3 },
    ]);

    const { result } = renderHook(() => useCarrinho([teclado]));

    // Sem o item fantasma, que apareceria com preço e foto congelados.
    expect(result.current.carrinho.map((item) => item.id)).toEqual(["prod-teclado"]);
    expect(result.current.quantidadeCarrinho).toBe(1);
  });

  it("refaz a conta quando o catálogo muda", () => {
    gravarCarrinho([{ id: "prod-teclado", quantidadeCarrinho: 2 }]);

    const { result, rerender } = renderHook(({ catalogo }: { catalogo: ProdutoResponse[] }) => useCarrinho(catalogo), {
      initialProps: { catalogo: [teclado] },
    });
    expect(result.current.totalCarrinho).toBeCloseTo(teclado.preco * 2);

    // Reajuste de preço no servidor: o mesmo carrinho, com o número de hoje.
    rerender({ catalogo: [{ ...teclado, preco: 100 }] });

    expect(result.current.totalCarrinho).toBe(200);
  });

  it("não ultrapassa o estoque atual do catálogo", () => {
    const { result } = renderHook(() => useCarrinho([mouse]));

    act(() => {
      result.current.adicionarAoCarrinho(mouse);
    });
    act(() => {
      result.current.adicionarAoCarrinho(mouse);
    });
    act(() => {
      result.current.adicionarAoCarrinho(mouse);
    });

    // O estoque é 2: a terceira tentativa não pode virar a terceira unidade.
    expect(result.current.quantidadeCarrinho).toBe(2);
  });

  it("não adiciona produto sem estoque", () => {
    const { result } = renderHook(() => useCarrinho([{ ...mouse, quantidade: 0 }]));

    act(() => {
      result.current.adicionarAoCarrinho({ ...mouse, quantidade: 0 });
    });

    expect(result.current.carrinho).toEqual([]);
    expect(lerCarrinho()).toEqual([]);
  });

  it("respeita o estoque de hoje ao alterar a quantidade", () => {
    // Cinco unidades gravadas, mas o catálogo de hoje diz que só há duas.
    gravarCarrinho([{ id: "prod-mouse", quantidadeCarrinho: 5 }]);

    const { result } = renderHook(() => useCarrinho([mouse]));

    act(() => {
      result.current.alterarQuantidade("prod-mouse", 1);
    });

    expect(result.current.quantidadeCarrinho).toBe(2);
  });

  it("remove o item quando a quantidade chega a zero", () => {
    gravarCarrinho([{ id: "prod-teclado", quantidadeCarrinho: 1 }]);

    const { result } = renderHook(() => useCarrinho([teclado]));

    act(() => {
      result.current.alterarQuantidade("prod-teclado", -1);
    });

    expect(result.current.carrinho).toEqual([]);
    expect(lerCarrinho()).toEqual([]);
  });

  it("limpa o carrinho inteiro", () => {
    gravarCarrinho([
      { id: "prod-teclado", quantidadeCarrinho: 1 },
      { id: "prod-mouse", quantidadeCarrinho: 1 },
    ]);

    const { result } = renderHook(() => useCarrinho([teclado, mouse]));

    act(() => {
      result.current.limparCarrinho();
    });

    expect(result.current.carrinho).toEqual([]);
    expect(lerCarrinho()).toEqual([]);
  });

  it("setCarrinho aceita lista pronta e função, como o setState", () => {
    gravarCarrinho([{ id: "prod-teclado", quantidadeCarrinho: 1 }]);

    const { result } = renderHook(() => useCarrinho([teclado, mouse]));

    // Forma de função: é como o App desliga a entrada do pedido que já passou.
    act(() => {
      result.current.setCarrinho((atual) => atual.filter((item) => item.id !== "prod-teclado"));
    });
    expect(result.current.carrinho).toEqual([]);

    act(() => {
      result.current.setCarrinho([{ ...mouse, quantidadeCarrinho: 1 }]);
    });
    // Grava só o id: a lista recebida é de produto completo, a saída não.
    expect(lerCarrinho()).toEqual([{ id: "prod-mouse", quantidadeCarrinho: 1 }]);
    expect(result.current.carrinho[0]?.id).toBe("prod-mouse");
  });

  it("uma resposta atrasada preserva produtos adicionados depois do início da compra", () => {
    gravarCarrinho([{ id: teclado.id, quantidadeCarrinho: 1 }]);
    const { result } = renderHook(() => useCarrinho([teclado, mouse]));
    const atualizarAoConcluirCompra = result.current.setCarrinho;
    act(() => result.current.adicionarAoCarrinho(mouse));
    act(() => atualizarAoConcluirCompra((atual) => atual.filter((item) => item.id !== teclado.id)));
    expect(result.current.carrinho.map((item) => item.id)).toEqual([mouse.id]);
    expect(lerCarrinho()).toEqual([{ id: mouse.id, quantidadeCarrinho: 1 }]);
  });

  it("começa vazio quando o que está salvo não é lista", () => {
    localStorage.setItem("carrinho", "não é json");

    const { result } = renderHook(() => useCarrinho([teclado]));

    expect(result.current.carrinho).toEqual([]);
    expect(result.current.totalCarrinho).toBe(0);
  });
});
