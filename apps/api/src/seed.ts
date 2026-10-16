import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { emTransacao, inicializarBanco } from "./database.js";
import { fecharPool } from "./postgres.js";

/**
 * Popula o banco com dados de demonstração.
 *
 * Registros existentes preservam estoque e edições administrativas. Fotos
 * ausentes podem ser preenchidas, mas o seed não restaura uma loja já usada.
 * Os valores monetários já são passados em centavos.
 *
 * Fotos dos produtos.
 *
 * Ficam em `apps/web/public/imagens/` e são referenciadas por caminho local, e
 * não por URL de fora: a foto é parte do projeto, não depende de serviço de
 * terceiros que pode cair ou bloquear por excesso de requisição.
 *
 * O nome de cada produto descreve a foto que ele carrega. Isso importa porque
 * as fotos disponíveis não batem com o nome de marketing: o fone é com fio, o
 * monitor é de 19 polegadas. Em vez de mostrar um produto e fotografar outro,
 * o nome diz o que a foto mostra.
 */
const PRODUTOS = [
  {
    id: "prod-teclado",
    nome: "Teclado Mecânico RGB Pro",
    descricao: "Teclado mecânico com switches lineares, iluminação RGB e layout compacto para produtividade e games.",
    preco: 59_990,
    quantidade: 15,
    categoria: "cat-informatica",
    imagem: "/imagens/teclado.jpg",
  },
  {
    id: "prod-mouse",
    nome: "Mouse Gamer Razer Naga",
    descricao: "Mouse gamer com doze botões laterais, sensor de 8200 DPI e iluminação verde.",
    preco: 36_990,
    quantidade: 25,
    categoria: "cat-informatica",
    imagem: "/imagens/mouse.jpg",
  },
  {
    id: "prod-monitor",
    nome: "Monitor LCD 19''",
    descricao: "Display LCD com painel de 19 polegadas, base ajustável e conexões VGA e DVI.",
    preco: 189_900,
    quantidade: 10,
    categoria: "cat-eletronicos",
    imagem: "/imagens/monitor.jpg",
  },
  {
    id: "prod-cadeira",
    nome: "Cadeira Ergonômica de Escritório",
    descricao: "Cadeira de escritório com encosto em tela respirável, ajuste de altura e apoio de braços.",
    preco: 149_900,
    quantidade: 8,
    categoria: "cat-moveis",
    imagem: "/imagens/cadeira.jpg",
  },
  {
    id: "prod-headset",
    nome: "Headset Studio",
    descricao: "Fone over-ear com som de referência, almofadas em veludo e cabo destacável.",
    preco: 89_900,
    quantidade: 12,
    categoria: "cat-eletronicos",
    imagem: "/imagens/headset.jpg",
  },
  {
    id: "prod-cam",
    nome: "Câmera de Segurança Wansview",
    descricao: "Câmera de segurança com resolução Full HD, visão noturna e aplicativo para celular.",
    preco: 129_990,
    quantidade: 6,
    categoria: "cat-eletronicos",
    imagem: "/imagens/camera.jpg",
  },
];

// `porcentagem` e `valorFixo` são sempre números, nunca undefined: as colunas
// são NOT NULL, e um cupom de valor fixo tem porcentagem 0, não ausente.
const CUPONS = [
  {
    id: "cup-boasvindas",
    codigo: "BEMVINDO10",
    porcentagem: 10,
    valorFixo: 0,
    tipo: "porcentagem",
    minimo: 0,
    limiteUso: null,
    expirado: false,
  },
  {
    id: "cup-frete",
    codigo: "FRETEGRATIS",
    porcentagem: 0,
    valorFixo: 0,
    tipo: "frete_gratis",
    minimo: 0,
    limiteUso: null,
    expirado: false,
  },
  {
    id: "cup-dez-reais",
    codigo: "DEZREAIS",
    porcentagem: 0,
    valorFixo: 1_000,
    tipo: "valor_fixo",
    minimo: 20_000,
    limiteUso: null,
    expirado: false,
  },
  {
    id: "cup-expirado",
    codigo: "EXPIRADO",
    porcentagem: 50,
    valorFixo: 0,
    tipo: "porcentagem",
    minimo: 0,
    limiteUso: null,
    expirado: true,
  },
  {
    id: "cup-limite",
    codigo: "UNICAUSO",
    porcentagem: 20,
    valorFixo: 0,
    tipo: "porcentagem",
    minimo: 0,
    limiteUso: 1,
    expirado: false,
  },
];

// Tuplas em vez de arrays soltos: o TypeScript infere `number | undefined` em
// cada elemento sem `as const`, e o cálculo de subtotal deixa de compilar.
const PEDIDOS_DEMONSTRACAO = [
  {
    diasAtras: 28,
    status: "finalizado",
    cliente: "usr-admin",
    itens: [
      ["prod-teclado", 1],
      ["prod-mouse", 1],
    ],
  },
  { diasAtras: 27, status: "processando", cliente: "usr-admin", itens: [["prod-monitor", 1]] },
  { diasAtras: 26, status: "enviado", cliente: "usr-admin", itens: [["prod-cadeira", 1]] },
  { diasAtras: 25, status: "finalizado", cliente: "usr-admin", itens: [["prod-headset", 1]] },
  {
    diasAtras: 24,
    status: "enviado",
    cliente: "usr-admin",
    itens: [
      ["prod-monitor", 1],
      ["prod-mouse", 1],
    ],
  },
  { diasAtras: 23, status: "cancelado", cliente: "usr-admin", itens: [["prod-cam", 1]] },
  {
    diasAtras: 22,
    status: "processando",
    cliente: "usr-admin",
    itens: [
      ["prod-cadeira", 1],
      ["prod-teclado", 1],
    ],
  },
  {
    diasAtras: 21,
    status: "finalizado",
    cliente: "usr-admin",
    itens: [
      ["prod-teclado", 1],
      ["prod-mouse", 1],
    ],
  },
] as const;

/**
 * Insere o produto de demonstração ou preenche apenas uma foto ausente.
 * Estoque, preços, status e outras edições existentes pertencem à loja.
 */
async function garantirProduto(client: PoolClient, produto: (typeof PRODUTOS)[number]) {
  await client.query(
    `INSERT INTO produtos (id, nome, descricao, preco_centavos, quantidade, categoria_id, imagem)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       imagem = COALESCE(NULLIF(produtos.imagem, ''), EXCLUDED.imagem)`,
    [
      produto.id,
      produto.nome,
      produto.descricao,
      produto.preco,
      produto.quantidade,
      produto.categoria,
      produto.imagem ?? null,
    ],
  );
}

async function inserirCupomSeFaltar(client: PoolClient, cupom: (typeof CUPONS)[number]) {
  const existe = await client.query("SELECT 1 FROM cupons WHERE id = $1", [cupom.id]);
  if (existe.rowCount) return;
  await client.query(
    `INSERT INTO cupons (id, codigo, porcentagem_desconto, desconto_centavos, tipo_desconto, valor_minimo_centavos, limite_uso, fim_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      cupom.id,
      cupom.codigo,
      cupom.porcentagem,
      cupom.valorFixo,
      cupom.tipo,
      cupom.minimo,
      cupom.limiteUso,
      cupom.expirado ? "2000-01-01 00:00:00" : null,
    ],
  );
}

export async function semear(): Promise<{ produtos: number; cupons: number; pedidos: number }> {
  const resultado = { produtos: 0, cupons: 0, pedidos: 0 };

  await emTransacao(async (client) => {
    for (const produto of PRODUTOS) {
      const antes = await client.query("SELECT 1 FROM produtos WHERE id = $1", [produto.id]);
      await garantirProduto(client, produto);
      if (!antes.rowCount) resultado.produtos++;
    }

    for (const cupom of CUPONS) {
      const antes = await client.query("SELECT 1 FROM cupons WHERE id = $1", [cupom.id]);
      await inserirCupomSeFaltar(client, cupom);
      if (!antes.rowCount) resultado.cupons++;
    }

    for (const [indice, pedido] of PEDIDOS_DEMONSTRACAO.entries()) {
      const id = `ped-demo-${indice + 1}`;
      const existe = await client.query("SELECT 1 FROM pedidos WHERE id = $1", [id]);
      if (existe.rowCount) continue;

      let subtotal = 0;
      for (const [produtoId, quantidade] of pedido.itens) {
        const preco = PRODUTOS.find((p) => p.id === produtoId)?.preco ?? 0;
        subtotal += preco * quantidade;
      }

      const frete = subtotal >= 15_000 ? 0 : 2_000;
      const desconto = 0;
      const criadoEm = new Date(Date.now() - pedido.diasAtras * 86_400_000);

      await client.query(
        `INSERT INTO pedidos (id, usuario_id, subtotal_centavos, desconto_centavos, frete_centavos, total_centavos, status, metodo_pagamento, status_pagamento, criado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pix', 'aprovado', $8)`,
        [id, pedido.cliente, subtotal, desconto, frete, subtotal - desconto + frete, pedido.status, criadoEm],
      );

      for (const [produtoId, quantidade] of pedido.itens) {
        const preco = PRODUTOS.find((p) => p.id === produtoId)?.preco ?? 0;
        await client.query(
          "INSERT INTO itens_pedido (id, pedido_id, produto_id, quantidade, preco_unitario_centavos, subtotal_centavos) VALUES ($1, $2, $3, $4, $5, $6)",
          [randomUUID(), id, produtoId, quantidade, preco, preco * quantidade],
        );
      }
      resultado.pedidos++;
    }
  });

  return resultado;
}

const executadoDiretamente = process.argv.includes("--seed") || process.argv.includes("--init");
if (executadoDiretamente) {
  const migracoes = await inicializarBanco();
  console.log(migracoes.length > 0 ? `Migrações aplicadas: ${migracoes.join(", ")}` : "Nenhuma migração nova.");

  const semeado = await semear();
  const total = semeado.produtos + semeado.cupons + semeado.pedidos;
  console.log(
    total > 0
      ? `Seed concluído — produtos: ${semeado.produtos}, cupons: ${semeado.cupons}, pedidos: ${semeado.pedidos} (novos)`
      : "Seed concluído — nenhum registro novo (todos já existiam)",
  );
  console.log("Administrador: admin@lojaficticia.com (senha definida pelo ambiente na primeira criação).");
  await fecharPool();
}
