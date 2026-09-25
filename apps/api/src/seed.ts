import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { emTransacao, inicializarBanco } from "./database.js";
import { fecharPool } from "./postgres.js";

/**
 * Popula o banco com dados de demonstração.
 *
 * Idempotente: cada inserção verifica se o registro já existe, então rodar
 * duas vezes não duplica nada. Os valores monetários já são passados em
 * centavos, porque é assim que ficam no banco.
 */
const PRODUTOS = [
  {
    id: "prod-teclado",
    nome: "Teclado Mecânico RGB Pro",
    descricao: "Teclado mecânico com switches lineares, iluminação RGB e layout compacto para produtividade e games.",
    preco: 59_990,
    quantidade: 15,
    categoria: "cat-informatica",
  },
  {
    id: "prod-mouse",
    nome: "Mouse Gamer HyperX Pulsefire",
    descricao: "Mouse ergonômico com sensor preciso, ajuste de DPI e superfície antiderrapante.",
    preco: 36_990,
    quantidade: 25,
    categoria: "cat-informatica",
  },
  {
    id: "prod-monitor",
    nome: "Monitor Gamer 27'' 165Hz",
    descricao: "Display Full HD com taxa de atualização de 165 Hz, painel IPS e baixo tempo de resposta.",
    preco: 189_900,
    quantidade: 10,
    categoria: "cat-eletronicos",
  },
  {
    id: "prod-cadeira",
    nome: "Cadeira Ergonômica Flexform",
    descricao: "Cadeira de escritório com apoio lombar, ajuste de altura e design moderno para uso diário.",
    preco: 149_900,
    quantidade: 8,
    categoria: "cat-moveis",
  },
  {
    id: "prod-headset",
    nome: "Headset Wireless Studio",
    descricao: "Fone com cancelamento de ruído, bateria de longa duração e som equilibrado para trabalho e lazer.",
    preco: 89_900,
    quantidade: 12,
    categoria: "cat-eletronicos",
  },
  {
    id: "prod-cam",
    nome: "Câmera de Segurança 4K",
    descricao: "Sistema de monitoramento com resolução 4K, visão noturna e armazenamento em nuvem.",
    preco: 129_990,
    quantidade: 6,
    categoria: "cat-eletronicos",
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

async function inserirProdutoSeFaltar(client: PoolClient, produto: (typeof PRODUTOS)[number]) {
  const existe = await client.query("SELECT 1 FROM produtos WHERE id = $1", [produto.id]);
  if (existe.rowCount) return;
  await client.query(
    "INSERT INTO produtos (id, nome, descricao, preco_centavos, quantidade, categoria_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [produto.id, produto.nome, produto.descricao, produto.preco, produto.quantidade, produto.categoria],
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
      await inserirProdutoSeFaltar(client, produto);
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
  console.log(
    `Seed concluído — produtos: ${semeado.produtos}, cupons: ${semeado.cupons}, pedidos: ${semeado.pedidos} (novos de ${semeado.produtos + semeado.cupons + semeado.pedidos === 0 ? "nenhum" : "cada tabela"})`,
  );
  console.log("Admin: admin@lojaficticia.com / admin123");
  await fecharPool();
}
