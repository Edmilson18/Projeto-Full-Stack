import { describe, it, expect } from "vitest";
import type { MinhaAvaliacao, PedidoResponse } from "@loja/shared";
import { imagemDe, normalizar, podeAvaliar } from "../../lib/utils.js";

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

/**
 * A imagem do produto.
 *
 * O defeito que estes casos travam: a foto era escolhida pela **posição** do
 * produto na lista, e a posição muda com o filtro de busca, com a ordenação e
 * com a seção da tela. O mesmo produto saía com imagens diferentes em cada uma,
 * e nenhuma era dele — a cadeira aparecia com a foto de uma placa-mãe.
 */

/** Desenho já decodificado, que é como se lê o SVG nos testes. */
function svgDe(nome: string): string {
  return decodeURIComponent(imagemDe({ nome, imagem: null }));
}
describe("imagemDe", () => {
  it("usa a foto do produto quando ele tem uma", () => {
    const url = "https://exemplo.com/cadeira.jpg";
    expect(imagemDe({ nome: "Cadeira Ergonômica", imagem: url })).toBe(url);
  });

  it("usa o caminho local da foto como veio, sem reescrever", () => {
    // O formato das fotos do seed: `/imagens/teclado.jpg`, servida pelo
    // próprio site. Reescrever o caminho (por exemplo, prefixando a API)
    // quebraria a foto, porque ela não vem da API.
    const local = "/imagens/teclado.jpg";
    expect(imagemDe({ nome: "Teclado Mecânico RGB Pro", imagem: local })).toBe(local);
  });

  it("não inventa foto para produto sem imagem, e sim desenha o produto", () => {
    const desenho = imagemDe({ nome: "Cadeira Ergonômica Flexform", imagem: null });

    // A garantia que importa: nenhum produto pode sair com a imagem de outro.
    expect(desenho).not.toContain("images.unsplash.com");
    expect(desenho.startsWith("data:image/svg+xml")).toBe(true);
    // "sem foto" no lugar do desenho deixava a vitrine com cara de defeito.
    expect(svgDe("Cadeira Ergonômica Flexform")).not.toContain("sem foto");
  });

  it("desenha um ícone por produto, e não a sigla", () => {
    // Cada produto ganha o ícone do que ele é. É o que substitui a foto que
    // nunca esteve disponível.
    // Cadeira: base em pé. Teclado: moldura com teclas.
    expect(svgDe("Cadeira Ergonômica Flexform")).toContain("M12 16.5v3");
    expect(svgDe("Teclado Mecânico RGB Pro")).toContain('<rect x="2" y="5" width="20" height="14"');

    // Cadeira e câmera saem diferentes, apesar de as duas terem inicial "C".
    expect(svgDe("Cadeira Ergonômica Flexform")).not.toBe(svgDe("Câmera de Segurança 4K"));
  });

  it("reconhece o produto mesmo com adjetivo antes do nome", () => {
    // O nome vem do cadastro, e quem cadastrou escolhe como escreve: "Mouse
    // Gamer", "Teclado Mecânico". A regra não pode depender da palavra estar
    // no começo do nome.
    expect(svgDe("Mouse Gamer Pulsefire")).toContain("M12 2.5v6");
    expect(svgDe("Monitor Gamer 27'' 165Hz")).toContain("M9 20.5h6");
  });

  it("cai na sigla quando o nome não descreve nenhum produto conhecido", () => {
    // "Cadeira" e "Câmera" têm ícone próprio, então a sigla fica para o que
    // sobrar. Precisa do elemento `<text>`: texto solto dentro do grupo do
    // ícone não desenha nada e o cartão sairia em branco.
    const svg = svgDe("Kit Desk Auxiliar");

    expect(svg).toContain("<text");
    expect(svg).toContain(">KT<");
  });

  it("trata imagem vazia ou só com espaço como ausente", () => {
    // `produtoInput` transforma `""` em ausente, mas dado vindo do banco ou de
    // uma edição antiga pode sobrar espaço em branco.
    expect(imagemDe({ nome: "Teclado", imagem: "" })).toContain("data:image/svg+xml");
    expect(imagemDe({ nome: "Teclado", imagem: "   " })).toContain("data:image/svg+xml");
  });

  it("mantém o desenho estável para o mesmo produto", () => {
    const nome = { nome: "Monitor Gamer 27'' 165Hz", imagem: null };
    expect(imagemDe(nome)).toBe(imagemDe(nome));
  });

  it("dá desenhos diferentes a produtos diferentes", () => {
    // Se todos caíssem no mesmo desenho, a vitrine ficaria com cópias
    // iguais — o que é a mesma falha da foto genérica, só menos confusa.
    const nomes = [
      "Cadeira Ergonômica Flexform",
      "Teclado Mecânico RGB Pro",
      "Câmera de Segurança 4K",
      "Mouse Gamer Pulsefire",
      "Monitor Gamer 27'' 165Hz",
      "Headset Wireless Studio",
    ];
    const desenhos = nomes.map((nome) => imagemDe({ nome, imagem: null }));

    expect(new Set(desenhos).size).toBe(nomes.length);
  });

  it("escapa o SVG para não quebrar quando o nome traz caracteres especiais", () => {
    // `viewBox="0 0 400 300"` usa aspas e `#` nas cores; sem escape o atributo
    // seria lido só até o primeiro espaço e o desenho viraria lixo.
    const desenho = decodeURIComponent(imagemDe({ nome: 'Monitor 27" & <teste>', imagem: null }));

    expect(desenho).toContain('viewBox="0 0 400 300"');
    expect(desenho).toContain('fill="#e');
  });
});
