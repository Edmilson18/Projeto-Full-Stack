-- A mesma intenção de compra pode ser reenviada sem gerar outro pedido.
-- O resumo original é registrado na transação da venda e do débito de estoque.
CREATE TABLE IF NOT EXISTS pedidos_idempotencia (
  usuario_id      TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  chave           TEXT NOT NULL CHECK (char_length(chave) BETWEEN 1 AND 64),
  requisicao_hash TEXT NOT NULL,
  pedido_id       TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  resposta        JSONB NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, chave)
);
