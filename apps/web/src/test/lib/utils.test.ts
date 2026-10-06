import { describe, it, expect } from "vitest";
import type { MinhaAvaliacao, PedidoResponse } from "@loja/shared";
import { normalizar, podeAvaliar } from "../../lib/utils.js";

/**
 * A busca do catálogo compara com `includes`, que é literal. Se a normalização
 * não tirar acento e caixa, o usuário precisa digitar o nome exatamente como está
 * cadastrado — "Cadeira Ergonômica" com maiúsculas e acento.
 */
describe("normalizar", () => {
  it("tira o acento", () => {
    expect(normalizar("Ergonômica")).toBe("ergonomica");
    expect(normalizar("Cadeira Ergonômica")).toBe("cadeira ergonomica");
  });

  it("baixa a caixa", () => {
    expect(normalizar("CADEIRA ERGONÔMICA")).toBe("cadeira ergonomica");
  });

  it("resolve o caso real: busca sem acento acha o nome com acento", () => {
    const nome = "Cadeira Ergonômica";
    const digitado = "cadeira ergonomica";
    expect(nome.includes(digitado)).toBe(false);
    expect(normalizar(nome).includes(normalizar(digitado))).toBe(true);
  });

  it("trata os outros acentos do português", () => {
    // Ç, ã, é, í, ó, ú e â aparecem nos produtos da loja.
    expect(normalizar("Câmera de Segurança 4K")).toBe("camera de seguranca 4k");
    expect(normalizar("Mouse Gamer")).toBe("mouse gamer");
    expect(normalizar("Informática")).toBe("informatica");
    expect(normalizar("Eletrônicos")).toBe("eletronicos");
  });

  it("resolve a trema do ç, que não é diacrítico combinante", () => {
    // `NFD` não decompõe o cedilha; vem de `latin1`. Sem este caso, "coracao"
    // continuaria sem achar "Coração".
    expect(normalizar("Coração")).toBe("coracao");
  });

  it("não altera texto sem acento", () => {
    expect(normalizar("Mouse Gamer HyperX")).toBe("mouse gamer hyperx");
  });

  it("mantém o texto vazio e o espaço", () => {
    expect(normalizar("")).toBe("");
    expect(normalizar("   ")).toBe("   ");
  });
});

/** Pedido no formato de `/api/conta`, só com o que esta regra olha. */
function pedido(status: PedidoResponse["status"], produtoIds: string[], criadoEm: string): PedidoResponse {
  return {
    id: `ped-${criadoEm}-${status}-${produtoIds.join("-")}`,
    subtotal: 100,
    desconto: 0,
    frete: 0,
    total_final: 100,
    status,
    metodo_pagamento: "pix",
    status_pagamento: null,
    criado_em: criadoEm,
    itens: produtoIds.map((produto_id) => ({
      produto_id,
      nome: produto_id,
      quantidade: 1,
      preco_unitario: 100,
      subtotal: 100,
    })),
  };
}

/** Avaliação da pessoa, com a data que a regra compara com a da compra. */
function avaliacao(produtoId: string, criadoEm: string): MinhaAvaliacao {
  return { produto_id: produtoId, nota: 5, comentario: null, criado_em: criadoEm };
}

/**
 * Avaliar é uma janela que abre a cada compra e fecha ao enviar a nota. Estes
 * casos travam os três estados possíveis e, principalmente, a reabertura: sem
 * a comparação de datas, "já comprou" valeria para sempre e o mesmo produto
 * aceitaria nota nova a cada recarga da página.
 */
describe("podeAvaliar", () => {
  const COMPRA = "2026-10-01T12:00:00.000Z";
  const APOS_COMPRA = "2026-10-01T13:00:00.000Z";

  it("libera quem comprou e ainda não avaliou", () => {
    expect(podeAvaliar([pedido("processando", ["prod-cam"], COMPRA)], [], "prod-cam")).toBe(true);
    expect(podeAvaliar([pedido("enviado", ["prod-cam"], COMPRA)], [], "prod-cam")).toBe(true);
    expect(podeAvaliar([pedido("finalizado", ["prod-cam"], COMPRA)], [], "prod-cam")).toBe(true);
  });

  it("bloqueia quem nunca comprou", () => {
    expect(podeAvaliar([], [], "prod-cam")).toBe(false);
    expect(podeAvaliar([pedido("finalizado", ["prod-mouse"], COMPRA)], [], "prod-cam")).toBe(false);
  });

  it("bloqueia logo depois de avaliar, mesmo mantendo a compra antiga", () => {
    const pedidos = [pedido("finalizado", ["prod-cam"], COMPRA)];
    const minhas = [avaliacao("prod-cam", APOS_COMPRA)];

    expect(podeAvaliar(pedidos, minhas, "prod-cam")).toBe(false);
  });

  it("reabre a janela quando a pessoa compra de novo depois de avaliar", () => {
    const pedidos = [
      pedido("finalizado", ["prod-cam"], COMPRA),
      pedido("finalizado", ["prod-cam"], "2026-11-01T12:00:00.000Z"),
    ];
    const minhas = [avaliacao("prod-cam", APOS_COMPRA)];

    // Esta é a via da atualização: comprar de novo reabre o formulário, que
    // aparece preenchido com a nota anterior.
    expect(podeAvaliar(pedidos, minhas, "prod-cam")).toBe(true);
  });

  it("ignora pedido cancelado", () => {
    expect(podeAvaliar([pedido("cancelado", ["prod-cam"], COMPRA)], [], "prod-cam")).toBe(false);
  });

  it("ignora avaliação de pedido cancelado", () => {
    // Cancelado significa que não houve compra, mesmo com o produto no pedido.
    const pedidos = [pedido("cancelado", ["prod-cam"], COMPRA)];
    const minhas = [avaliacao("prod-cam", "2026-10-01T11:00:00.000Z")];
    expect(podeAvaliar(pedidos, minhas, "prod-cam")).toBe(false);
  });

  it("não confunde avaliação de outro produto", () => {
    const pedidos = [pedido("finalizado", ["prod-cam"], COMPRA)];
    const minhas = [avaliacao("prod-mouse", APOS_COMPRA)];
    expect(podeAvaliar(pedidos, minhas, "prod-cam")).toBe(true);
  });

  it("não quebra com pedido sem itens ou sem data", () => {
    // `itens` e `criado_em` são `nullish` no contrato: nenhum dos dois pode
    // virar erro em produção.
    const semItens = { ...pedido("processando", ["prod-cam"], COMPRA), itens: null };
    const semData = { ...pedido("processando", ["prod-cam"], COMPRA), criado_em: null };
    expect(podeAvaliar([semItens], [], "prod-cam")).toBe(false);
    expect(podeAvaliar([semData], [], "prod-cam")).toBe(false);
  });
});
