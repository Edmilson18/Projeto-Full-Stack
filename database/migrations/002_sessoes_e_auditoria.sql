-- Migração 002: sessões persistidas e auditoria.
--
-- Separada da 001 de propósito. Quem já rodou a 001 tem o schema aplicado e
-- registrado na tabela `migracoes`; alterar a 001 não faria nada para essas
-- instalações, porque o arquivo já está marcado como aplicado. Migrations
-- aplicadas não se editam.

CREATE TABLE IF NOT EXISTS sessoes (
  -- Guarda-se o hash do token, não o token. Quem ler o banco não consegue
  -- forjar uma sessão sem o valor original, que só existe no cookie do
  -- cliente.
  token_hash  TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   TIMESTAMPTZ NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes (usuario_id);
CREATE INDEX IF NOT EXISTS idx_sessoes_expira   ON sessoes (expira_em);

-- Auditoria de mudanças. A 001 não tinha registro de quem mudou o quê, e o
-- histórico de estoque é sobrescrito a cada edição.
CREATE TABLE IF NOT EXISTS auditoria (
  id           TEXT PRIMARY KEY,
  entidade     TEXT NOT NULL,
  entidade_id  TEXT NOT NULL,
  acao         TEXT NOT NULL,
  antes        JSONB,
  depois       JSONB,
  usuario_id   TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria (entidade, entidade_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_criado   ON auditoria (criado_em DESC);
