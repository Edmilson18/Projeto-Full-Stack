-- Migração 001: schema inicial em PostgreSQL.
--
-- Diferenças em relação ao schema SQLite anterior, e o motivo de cada uma:
--
--   Valores monetários viram INTEGER em centavos. REAL é ponto flutuante, e
--   ponto flutuante não fecha: 19,90 + 19,90 + 19,90 dá 59,699999999999996.
--   Ver docs/adr/004-dinheiro-em-centavos.md.
--
--   Datas viram TIMESTAMPTZ, não DATETIME. TIMESTAMP sem fuso perde a
--   informação de qual horário era, e a conversão no cliente usa o fuso do
--   navegador, o que faz a mesma data aparecer diferente para cada pessoa.
--
--   Os ids continuam TEXT, e não UUID. O seed usa ids legíveis como
--   'prod-teclado' e os pedidos usam 'PED-20260925-A1B2C3', que não são UUID.
--   Trocar o formato forçaria a migrar os dados do usuário.
--
--   Os CHECK de money viram checks de >= 0, que o PostgreSQL já garante.

CREATE TABLE IF NOT EXISTS categorias (
  id    TEXT PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS usuarios (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senha         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'cliente' CHECK (role IN ('cliente', 'admin')),
  cep           TEXT,
  rua           TEXT,
  numero        TEXT,
  complemento   TEXT,
  bairro        TEXT,
  cidade        TEXT,
  estado        TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_estado_tamanho CHECK (estado IS NULL OR char_length(estado) = 2)
);

CREATE TABLE IF NOT EXISTS tokens_redefinicao_senha (
  token_hash  TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   TIMESTAMPTZ NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS produtos (
  id             TEXT PRIMARY KEY,
  nome           TEXT NOT NULL,
  descricao      TEXT,
  -- Centavos. Dividir por 100 só na formatação, nunca no cálculo.
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  quantidade     INTEGER NOT NULL CHECK (quantidade >= 0),
  categoria_id   TEXT NOT NULL REFERENCES categorias(id),
  imagem         TEXT,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cupons (
  id                  TEXT PRIMARY KEY,
  codigo              TEXT NOT NULL UNIQUE,
  -- Em cupom de frete grátis o valor é 0 e o que vale é tipo_desconto.
  desconto_centavos   INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  porcentagem_desconto INTEGER NOT NULL DEFAULT 0 CHECK (porcentagem_desconto BETWEEN 0 AND 100),
  tipo_desconto       TEXT NOT NULL DEFAULT 'porcentagem'
                        CHECK (tipo_desconto IN ('porcentagem', 'valor_fixo', 'frete_gratis')),
  valor_minimo_centavos INTEGER NOT NULL DEFAULT 0 CHECK (valor_minimo_centavos >= 0),
  inicio_em           TIMESTAMPTZ,
  fim_em              TIMESTAMPTZ,
  limite_uso          INTEGER,
  usos                INTEGER NOT NULL DEFAULT 0,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedidos (
  id                TEXT PRIMARY KEY,
  usuario_id        TEXT REFERENCES usuarios(id),
  subtotal_centavos INTEGER NOT NULL CHECK (subtotal_centavos >= 0),
  desconto_centavos INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  frete_centavos    INTEGER NOT NULL DEFAULT 0 CHECK (frete_centavos >= 0),
  total_centavos    INTEGER NOT NULL CHECK (total_centavos >= 0),
  status            TEXT NOT NULL DEFAULT 'processando'
                      CHECK (status IN ('processando', 'enviado', 'finalizado', 'cancelado')),
  metodo_pagamento  TEXT,
  status_pagamento  TEXT NOT NULL DEFAULT 'pendente',
  cep_entrega       TEXT,
  rua_entrega       TEXT,
  numero_entrega    TEXT,
  complemento_entrega TEXT,
  bairro_entrega    TEXT,
  cidade_entrega    TEXT,
  estado_entrega    TEXT,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favoritos (
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  produto_id  TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, produto_id)
);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  produto_id  TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nota        INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario  TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, produto_id)
);

CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
  id          TEXT PRIMARY KEY,
  produto_id  TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  quantidade  INTEGER NOT NULL,
  motivo      TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id               TEXT PRIMARY KEY,
  pedido_id        TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id       TEXT NOT NULL REFERENCES produtos(id),
  quantidade       INTEGER NOT NULL CHECK (quantidade > 0),
  -- Preço congelado no momento da compra, em centavos. Se o preço do produto
  -- mudar depois, o histórico do pedido não pode mudar junto.
  preco_unitario_centavos INTEGER NOT NULL CHECK (preco_unitario_centavos >= 0),
  subtotal_centavos        INTEGER NOT NULL CHECK (subtotal_centavos >= 0)
);

-- Índices para as consultas que existem de fato, não para o schema em geral.
CREATE INDEX IF NOT EXISTS idx_pedidos_usuario      ON pedidos (usuario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_criado_em     ON pedidos (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_status        ON pedidos (status);
CREATE INDEX IF NOT EXISTS idx_itens_pedido_pedido   ON itens_pedido (pedido_id);
CREATE INDEX IF NOT EXISTS idx_itens_pedido_produto  ON itens_pedido (produto_id);
CREATE INDEX IF NOT EXISTS idx_produtos_categoria    ON produtos (categoria_id);
CREATE INDEX IF NOT EXISTS idx_produtos_ativo        ON produtos (ativo) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_avaliacoes_produto   ON avaliacoes (produto_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_produto ON movimentacoes_estoque (produto_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_usuario       ON tokens_redefinicao_senha (usuario_id);
CREATE INDEX IF NOT EXISTS idx_tokens_expira         ON tokens_redefinicao_senha (expira_em);

INSERT INTO categorias (id, nome) VALUES
  ('cat-eletronicos', 'Eletrônicos'),
  ('cat-informatica', 'Informática'),
  ('cat-moveis', 'Móveis'),
  ('cat-vestuario', 'Vestuário'),
  ('cat-outros', 'Outros')
ON CONFLICT (id) DO NOTHING;
