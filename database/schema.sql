CREATE TABLE IF NOT EXISTS categorias (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cliente',
  cep TEXT,
  rua TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS produtos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  preco REAL NOT NULL CHECK (preco >= 0),
  quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
  categoria_id TEXT NOT NULL,
  imagem TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

CREATE TABLE IF NOT EXISTS cupons (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  porcentagem_desconto REAL NOT NULL CHECK (porcentagem_desconto BETWEEN 0 AND 100),
  tipo_desconto TEXT NOT NULL DEFAULT 'porcentagem',
  valor_minimo REAL NOT NULL DEFAULT 0,
  inicio_em DATETIME,
  fim_em DATETIME,
  limite_uso INTEGER,
  usos INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT,
  subtotal REAL NOT NULL,
  desconto REAL NOT NULL DEFAULT 0,
  frete REAL NOT NULL DEFAULT 0,
  total_final REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  metodo_pagamento TEXT,
  status_pagamento TEXT NOT NULL DEFAULT 'pendente',
  cep_entrega TEXT,
  rua_entrega TEXT,
  numero_entrega TEXT,
  complemento_entrega TEXT,
  bairro_entrega TEXT,
  cidade_entrega TEXT,
  estado_entrega TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS favoritos (
  usuario_id TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, produto_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(usuario_id, produto_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
  id TEXT PRIMARY KEY,
  produto_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  motivo TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id TEXT PRIMARY KEY,
  pedido_id TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  preco_unitario REAL NOT NULL,
  subtotal REAL NOT NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

INSERT OR IGNORE INTO categorias (id, nome) VALUES
  ('cat-eletronicos', 'Eletrônicos'),
  ('cat-informatica', 'Informática'),
  ('cat-moveis', 'Móveis'),
  ('cat-vestuario', 'Vestuário'),
  ('cat-outros', 'Outros');

INSERT OR IGNORE INTO usuarios (id, nome, email, senha, role) VALUES
  ('usr-admin', 'Administrador', 'admin@lojaficticia.com', 'admin123', 'admin');

INSERT OR IGNORE INTO produtos (id, nome, descricao, preco, quantidade, categoria_id) VALUES
  ('prod-teclado', 'Teclado Mecânico', 'Teclado gamer com switches azuis', 250.00, 15, 'cat-informatica'),
  ('prod-mouse', 'Mouse Gamer', 'Mouse com 6 botões e sensor 8000 DPI', 180.00, 25, 'cat-informatica'),
  ('prod-monitor', 'Monitor 24"', 'Monitor Full HD com painel IPS', 699.90, 10, 'cat-eletronicos'),
  ('prod-cadeira', 'Cadeira Ergômica', 'Cadeira para escritório com apoio lombar', 899.99, 8, 'cat-moveis');

INSERT OR IGNORE INTO cupons (id, codigo, porcentagem_desconto, tipo_desconto, valor_minimo, ativo) VALUES
  ('cup-boasvindas', 'BEMVINDO10', 10, 'porcentagem', 0, 1),
  ('cup-frete', 'FRETEGRATIS', 0, 'frete_gratis', 0, 1);

INSERT OR IGNORE INTO pedidos (id, usuario_id, subtotal, desconto, frete, total_final, status, criado_em) VALUES
  ('ped-demo-1', 'usr-admin', 430.00, 43.00, 0, 387.00, 'finalizado', '2026-08-28 10:15:00'),
  ('ped-demo-2', 'usr-admin', 699.90, 0, 0, 699.90, 'processando', '2026-08-29 14:30:00'),
  ('ped-demo-3', 'usr-admin', 899.99, 0, 0, 899.99, 'enviado', '2026-08-30 09:20:00'),
  ('ped-demo-4', 'usr-admin', 250.00, 0, 20, 270.00, 'finalizado', '2026-08-31 16:45:00'),
  ('ped-demo-5', 'usr-admin', 879.90, 87.99, 0, 791.91, 'enviado', '2026-09-01 11:05:00'),
  ('ped-demo-6', 'usr-admin', 180.00, 0, 20, 200.00, 'cancelado', '2026-09-02 13:10:00'),
  ('ped-demo-7', 'usr-admin', 1149.99, 0, 0, 1149.99, 'processando', '2026-09-03 18:25:00'),
  ('ped-demo-8', 'usr-admin', 430.00, 0, 0, 430.00, 'finalizado', '2026-09-04 08:40:00');

INSERT OR IGNORE INTO itens_pedido (id, pedido_id, produto_id, quantidade, preco_unitario, subtotal) VALUES
  ('item-demo-1', 'ped-demo-1', 'prod-teclado', 1, 250.00, 250.00),
  ('item-demo-2', 'ped-demo-1', 'prod-mouse', 1, 180.00, 180.00),
  ('item-demo-3', 'ped-demo-2', 'prod-monitor', 1, 699.90, 699.90),
  ('item-demo-4', 'ped-demo-3', 'prod-cadeira', 1, 899.99, 899.99),
  ('item-demo-5', 'ped-demo-4', 'prod-teclado', 1, 250.00, 250.00),
  ('item-demo-6', 'ped-demo-5', 'prod-monitor', 1, 699.90, 699.90),
  ('item-demo-7', 'ped-demo-5', 'prod-mouse', 1, 180.00, 180.00),
  ('item-demo-8', 'ped-demo-6', 'prod-mouse', 1, 180.00, 180.00),
  ('item-demo-9', 'ped-demo-7', 'prod-cadeira', 1, 899.99, 899.99),
  ('item-demo-10', 'ped-demo-7', 'prod-teclado', 1, 250.00, 250.00),
  ('item-demo-11', 'ped-demo-8', 'prod-teclado', 1, 250.00, 250.00),
  ('item-demo-12', 'ped-demo-8', 'prod-mouse', 1, 180.00, 180.00);
