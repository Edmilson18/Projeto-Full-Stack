# Loja Tech

Aplicação full-stack de e-commerce desenvolvida como projeto de portfólio. A Loja Tech reúne uma vitrine de produtos, carrinho, checkout demonstrativo e área do cliente, com frontend em React e backend em Node.js. Administradores acessam um painel próprio para acompanhar indicadores, gerenciar produtos e atualizar pedidos.

> Projeto demonstrativo: pagamentos, frete e envio de pedidos não usam serviços externos reais.

## Índice

- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Como executar](#como-executar)
- [Credenciais de demonstração](#credenciais-de-demonstração)
- [Estrutura do projeto](#estrutura-do-projeto)
- [API](#api)
- [Segurança e limitações](#segurança-e-limitações)
- [Próximos passos](#próximos-passos)

## Convenções

- Valores monetários circulam em **centavos** entre banco, domínio e API. Só a
  resposta HTTP usa reais. Ver a [ADR 004](docs/adr/004-dinheiro-em-centavos.md).
- O contrato HTTP fica em `packages/shared`. Entradas em `schemas.ts`, saídas em
  `respostas.ts`. O servidor valida a própria saída com `parse()`, então um campo
  renomeado vira falha de teste em vez de `undefined` na tela.
- Erro de regra de negócio é `ErroApp` (`apps/api/src/erros.ts`), com status e
  mensagem próprios. Qualquer outra exceção é falha inesperada e vira 500 sem
  detalhe interno.

## Funcionalidades

### Cliente

- Cadastro, login e logout.
- Catálogo com busca e filtro por categoria.
- Carrinho persistido no navegador, com atualização de quantidade e validação de estoque.
- Checkout com Pix em modo demonstrativo.
- Área "Minha conta" com endereço de entrega, favoritos e pedidos detalhados.
- Favoritos por conta (persistidos no servidor) e avaliação de produtos.
- Tema claro e escuro.

### Administração

Contas com papel `admin` são direcionadas ao painel administrativo após o login.
O painel reúne indicadores e relatórios, cadastro e manutenção de produtos,
alertas de estoque, busca e atualização de pedidos.

- Cadastro, busca, edição e inativação de produtos (`POST`/`PUT`/`DELETE /api/produtos`).
- Preservação de histórico ao inativar produtos.
- Gestão do status dos pedidos: processando, enviado, finalizado e cancelado.
- Dashboard com produtos, usuários, pedidos, receita, ticket médio, produtos vendidos, gráficos e alertas de estoque baixo.
- Auditoria de alterações de pedido, com o valor anterior e o novo.

### Cupons

A API aceita cupom de **percentual**, **valor fixo** e **frete grátis**, com
valor mínimo, limite de uso e janela de validade. Também aplica
automaticamente frete grátis acima de R$ 150,00.

O cupom **não tem interface**: o `App.tsx` envia `cupomCodigo` fixo como
`"Nenhum"`, e o hook `useCoupon` existe mas não é importado por nenhum
componente.

## Tecnologias

- React 19 + Vite
- Fastify 5
- Node.js 24
- PostgreSQL 17 (via Docker), acesso com `pg`
- Zod, compartilhado entre api e web
- CSS responsivo
- Lucide React

### Qualidade de código

- **oxlint** com suporte *type-aware* via `oxlint-tsgolint`
- **Prettier**
- **Vitest**
- **Husky** + **lint-staged**
- Git hooks: `pre-commit` roda lint e formatação; `pre-push` roda `verify` completo.

## Como executar

### Pré-requisitos

- [Node.js](https://nodejs.org/) 24 ou superior (a versão está fixada em `.nvmrc`).
- [Docker](https://docs.docker.com/desktop/) — necessário para o PostgreSQL.
- npm.

### Subir o banco

O projeto usa PostgreSQL 17, em container:

```bash
docker compose up -d postgres
```

### Criar o schema e popular

```bash
npm run db:setup
```

Aplica as migrações de `database/migrations/`, cria o administrador e insere
os dados de demonstração. Rodar de novo preserva estoque, preços e edições dos produtos
existentes; apenas fotos ausentes são preenchidas. Instale as dependências com `npm ci`
e copie `.env.example` para `.env` antes de executar os comandos da aplicação.

Esse comando sobe somente o banco. Para executar também a API pela imagem Docker,
defina uma `ADMIN_PASSWORD` própria no `.env` e use `docker compose up --build -d api`.
Não execute a API do Docker e `npm run dev` na mesma porta ao mesmo tempo.

| Comando | O que faz |
| --- | --- |
| `npm run db:setup` | Migra, cria o admin e semeia |
| `npm run db:migrate` | Só aplica as migrações pendentes |
| `npm run db:seed` | Só insere os dados de demonstração |
| `npm run db:reset` | **Apaga o schema inteiro.** Só em desenvolvimento local |

Para recomeçar do zero: `npm run db:reset && npm run db:setup`

Dentro do contêiner de produção, `npm run db:migrate` **não funciona**: ele roda
`tsx`, que é dependência de desenvolvimento e não existe na imagem. Use
`npm run db:migrate:dist -w @loja/api`, que roda o `migrar.js` já compilado.

Na prática não é preciso: `npm start` chama `inicializarBanco()`, que aplica as
migrações pendentes ao subir.

### Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Compila shared e sobe API (3000) e Vite (5173) juntos. |
| `npm run build` | Compila `packages/shared`, o servidor e o frontend. |
| `npm start` | Sobe o servidor já compilado (aplica as migrações antes). |
| `npm run typecheck` | `tsc --noEmit` em todos os pacotes. |
| `npm run lint` | oxlint com análise de tipos. |
| `npm run lint:fix` | Aplica as correções automáticas do linter. |
| `npm run format` | Prettier em modo escrita. |
| `npm run format:check` | Verifica a formatação sem escrever. |
| `npm test` | Roda a suíte da API e a do frontend, uma vez. |
| `npm run test:watch` | Suítes API e web em modo interativo, simultaneamente. |
| `npm run test:coverage` | Relatório de cobertura da API. |
| `npm run verify` | Tipos, lint, formatação, testes e build. Roda no `pre-push` e no CI. |

`typecheck` e `test` compilam o `packages/shared` antes de delegar aos pacotes,
porque `apps/api` e `apps/web` importam os tipos do `dist/` dele. Sem essa
ordem, os dois comandos falham em uma instalação nova.

### Variáveis de ambiente

Copie `.env.example` para `.env`. Ele lista todas as variáveis que o código lê,
com o motivo de cada uma.

Duas obrigatórias em produção:

- **`NODE_ENV`** precisa ser definido como `production` na publicação para ativar
  os controles de produção, inclusive o cookie `Secure`. O servidor avisa no console quando falta.
- **`ADMIN_PASSWORD`** é obrigatória em produção: é a senha do administrador
  criado por `db:setup`/`db:seed`. Em desenvolvimento o padrão é `admin123`.

Não há `COOKIE_SECRET`: a sessão não assina cookie. O valor é um token aleatório
de 32 bytes, e a validação é feita contra o SHA-256 guardado no banco. Uma
chave de assinatura não fecharia nenhuma brecha além disso.

A recuperação está desabilitada por padrão e responde 503 com a indisponibilidade
do envio de e-mail. Para exercitar a redefinição **somente no ambiente local**, defina
`NODE_ENV=development` e `ALLOW_LOCAL_PASSWORD_RESET=true`: nesse modo o token volta
na resposta e a interface abre a definição da nova senha. A opção não habilita envio
de e-mail e não funciona em produção, teste ou quando `NODE_ENV` está ausente.

### Instalação

```bash
git clone <URL-DO-SEU-REPOSITORIO>
cd "Projeto - FullStack"
npm ci
npm run db:setup
npm run dev
```

Com o ambiente iniciado:

- Loja: `http://localhost:5173`
- API: `http://localhost:3000`

### Build de produção

```bash
npm run build
npm start
```

O banco de dados é gerenciado pelas migrações em `database/migrations/`. O arquivo `.env` contém as configurações locais e não deve ser versionado.

Há também uma imagem Docker:

```bash
docker build -t loja-tech .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgresql://...@host.docker.internal:5432/loja" \
  -e ADMIN_PASSWORD="$(openssl rand -base64 18)" \
  loja-tech
```

`ADMIN_PASSWORD` é obrigatória na imagem: `NODE_ENV=production` está definido
nela, e sem a senha o `db:setup` não cria o administrador.

## Credenciais de demonstração

| Perfil | E-mail | Senha |
| --- | --- | --- |
| Administrador | `admin@lojaficticia.com` | `admin123` |

Use essas credenciais somente no ambiente local de demonstração. Antes de publicar uma aplicação real, crie uma conta administrativa própria e remova qualquer senha de exemplo.

## Estrutura do projeto

Monorepo com npm workspaces. As decisões de arquitetura estão em
[`docs/adr/`](docs/adr/README.md).

```text
.
├── apps/
│   ├── api/                  API HTTP, regras de dados e testes
│   │   ├── src/
│   │   │   ├── server.ts       # Ponto de entrada do processo
│   │   │   ├── app.ts          # Configuração do Fastify e rotas
│   │   │   ├── database.ts     # Acesso ao PostgreSQL e transações
│   │   │   ├── config.ts       # Env, caminhos e porta
│   │   │   ├── erros.ts       # Classes de erro da aplicação
│   │   │   ├── seed.ts         # Dados de demonstração
│   │   │   ├── migrar.ts       # Aplica migrações e encerra
│   │   │   ├── resetar.ts      # Apaga o schema (só local)
│   │   │   ├── rotas/          # Rotas da API
│   │   │   └── testes/         # Testes de integração e unidade
│   │   └── vitest.config.ts
│   └── web/                  Loja em React
│       ├── src/
│       │   ├── App.tsx         # Vitrine, carrinho, conta e checkout
│       │   ├── main.tsx        # Ponto de entrada
│       │   ├── components/     # Modais da loja
│       │   ├── hooks/          # Leitura de produtos, carrinho, conta
│       │   ├── lib/            # Cliente HTTP
│       │   └── styles.css
│       ├── vite.config.ts
│       └── vitest.config.ts
├── packages/
│   ├── shared/              Contratos tipados entre api e web
│   └── config/              tsconfig.base.json compartilhado
├── database/
│   └── migrations/          Migrações do PostgreSQL
├── docs/adr/                Decisões de arquitetura
├── .oxlintrc.jsonc          Linter, com justificativa por regra
├── .prettierrc.json         Formatação
├── docker-compose.yml       PostgreSQL local
├── package.json
└── README.md
```

### Comandos

Os scripts rodam da raiz e delegam para o pacote correspondente.

| Comando | Onde executa |
| --- | --- |
| `npm run dev` | Sobe api (3000) e web (5173) juntos |
| `npm run build` | Compila shared, api e web |
| `npm test` | Suítes de integração da API e de componentes/hooks do frontend |
| `npm run verify` | Tipos, lint, formatação, testes e build |
| `npm run typecheck -w @loja/web` | Só o typecheck do frontend |
| `npm run test -w @loja/api` | Só a suíte da API |

### Suíte de testes

A suíte da API sobe um schema PostgreSQL exclusivo, aplica as migrações dentro
dele, semeia e apaga no fim — o banco de desenvolvimento nunca é tocado. Por
isso ela precisa de um PostgreSQL acessível, e falha com erro de conexão se não
houver um.

### Gerenciador de pacotes

O projeto usa **npm workspaces**. O `package.json` declara `"packageManager": "npm@12.0.2"`.
A decisão original previa pnpm workspaces com Turborepo; só a estrutura de
três pacotes foi mantida. Ver a [ADR 003](docs/adr/003-monorepo-pnpm-turborepo.md).

As versões declaradas de TypeScript, Vitest, jsdom e jest-dom estão alinhadas
entre raiz e workspaces. O lockfile deve acompanhar qualquer alteração de manifesto;
`npm ci` reproduz a instalação e `npm ls --depth=0` verifica sua coerência.

O workflow `.github/workflows/verify.yml` executa a verificação com PostgreSQL 17
em um serviço isolado. A execução no GitHub acontece quando o código é enviado ao repositório.

## API

### Sessão

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/cadastro` | Cria uma conta de cliente. |
| `POST` | `/api/login` | Autentica e cria a sessão. |
| `POST` | `/api/logout` | Encerra a sessão. |
| `GET` | `/api/sessao` | Retorna o usuário autenticado, ou `usuario: null`. |
| `POST` | `/api/recuperar-senha` | Retorna indisponibilidade; token somente no modo local explícito. |
| `POST` | `/api/redefinir-senha` | Troca a senha pelo token. |

### Catálogo e conta

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/produtos` | Lista os produtos ativos. |
| `GET` | `/api/produtos/mais-vendidos` | Os 3 mais vendidos, ignorando pedidos cancelados. |
| `GET` | `/api/categorias` | Lista as categorias. |
| `GET` | `/api/avaliacoes/:id` | Avaliações de um produto. |
| `POST` | `/api/avaliacoes/:id` | Registra a avaliação do usuário logado. |
| `GET` | `/api/conta` | Perfil, favoritos e pedidos do cliente. |
| `PUT` | `/api/conta/endereco` | Atualiza o endereço de entrega. |
| `PUT` | `/api/favoritos/:id` | Marca o produto como favorito. Idempotente. |
| `DELETE` | `/api/favoritos/:id` | Remove o produto dos favoritos. Idempotente. |

### Cupons

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/cupons` | Lista os cupons ativos. |
| `POST` | `/api/cupons/validar` | Valida um código. |

`POST /api/cupons/validar` responde **200 mesmo quando recusa o cupom**; o
resultado está no corpo, discriminado por `valido`:

```jsonc
{ "valido": true,  "codigo": "BEMVINDO10", "tipoDesconto": "porcentagem", ... }
{ "valido": false, "erro": "Cupom inválido ou expirado." }
```

### Pedidos

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/pedidos` | Cria um pedido a partir do carrinho. |

O checkout web envia `chaveIdempotencia` (UUID) por tentativa de compra. Reenviar
os mesmos itens, pagamento e cupom com a mesma chave e conta devolve o resumo
original, sem criar outro pedido ou debitar novamente estoque/cupom. Alterar a
compra mantendo a chave responde 409. Sem chave, cada requisição é uma compra
distinta; clientes externos devem gerar e reutilizar uma chave nos seus retries.
A migração 003 adiciona o registro dessas tentativas sem alterar pedidos existentes.

O ciclo demonstrativo começa em `processando`. As transições permitidas são
`processando → enviado → finalizado`, `processando → cancelado` e
`cancelado → processando`. Reativar exige produto ativo e estoque suficiente;
repetir o estado atual não movimenta estoque nem duplica auditoria. Pedidos enviados
não podem ser cancelados por essa rota: devoluções e estornos ainda não foram implementados.

Enviar exige endereço brasileiro completo e UF válida. O endereço completo salvo
na compra é preservado; se estava incompleto, o envio captura o endereço válido do
perfil e o mantém no pedido. Alterar o perfil depois não altera esse registro.
O checkout ainda pode criar a compra sem endereço no modo demonstrativo, e o pagamento
continua sendo uma aprovação simulada, sem cobrança nem estorno reais.

A avaliação fica disponível após uma compra não cancelada e fecha depois do envio.
Uma nova compra permite atualizar a nota existente. A permissão e a gravação são
atômicas: duas tentativas simultâneas não consomem a mesma janela duas vezes.

As migrações são serializadas por banco e schema entre instâncias. Transações de
negócio repetem até três tentativas somente para deadlock (`40P01`) e falha de
serialização (`40001`), após rollback. Erros de negócio e falhas de conexão não são
repetidos automaticamente. Os callbacks transacionais devem conter apenas operações
no banco; entregas externas futuras exigirão um mecanismo próprio.

Na validação, entrada inválida responde 400; violação do contrato de saída é falha
interna, responde 500 e registra detalhes somente no log do servidor. A listagem de
cupons inclui `desconto` em reais para cupons de valor fixo; a validação mantém os
campos explicitamente nomeados em centavos.

### Localização

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/cep/:cep` | Busca endereço por CEP. |
| `GET` | `/api/localizacao/reversa` | Coordenadas por endereço. |

### Administração

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/admin/produtos` | Lista produtos, inclusive inativos. |
| `POST` | `/api/produtos` | Cria produto. Devolve `{ mensagem, produto }`. |
| `PUT` | `/api/produtos/:id` | Edita produto. |
| `DELETE` | `/api/produtos/:id` | Inativa produto (não apaga). |
| `GET` | `/api/admin/pedidos` | Lista todos os pedidos. |
| `PATCH` | `/api/admin/pedidos/:id` | Atualiza o status do pedido. |
| `GET` | `/api/admin/pedidos/:id/auditoria` | Histórico de alterações do pedido. |
| `GET` | `/api/dashboard` | Métricas administrativas. |

### Dinheiro

O banco guarda **centavos** em `INTEGER` e é isso que o PostgreSQL soma. A
conversão para reais acontece só na fronteira da resposta. O subtotal, o
desconto, o frete e o total são recalculados pelo servidor a partir dos preços
do banco: nenhum valor monetário vindo do frontend é usado no cálculo.

## Segurança e limitações

- Senhas são armazenadas com hash `scrypt` e comparação segura.
- A autorização no backend é feita por sessão identificada em cookie `HttpOnly`; dados no `localStorage` são usados somente para personalizar a interface, não para autorizar ações.
- A sessão é mantida no banco de dados PostgreSQL, permitindo múltiplas instâncias.
- A redefinição de senha consome o token atomicamente e revoga as sessões anteriores.
- `X-Forwarded-For` só é considerado quando `TRUSTED_PROXIES` lista proxies controlados pela implantação.
- Com `DATABASE_SSL=true`, o certificado do banco é verificado e a URL recebe `sslmode=verify-full`.
- O token de redefinição só é retornado com `NODE_ENV=development` e `ALLOW_LOCAL_PASSWORD_RESET=true`. Ele não é registrado nos logs. Links com `resetToken` abrem a redefinição e o parâmetro é removido do endereço sem apagar os demais parâmetros ou fragmentos.
- O cookie recebe `Secure` automaticamente quando `NODE_ENV=production`.
- A sessão não assina cookie e não usa `COOKIE_SECRET`: o token é aleatório de 32 bytes e a checagem é contra o SHA-256 no banco. Assinar acrescentaria uma chave a proteger sem fechar brecha adicional.
- Pagamento e frete são simulados. **E-mail e upload de imagens não existem**: `MAILTRAP_API_KEY` e `MAIL_FROM` estão no `.env.example`, mas nenhum módulo as lê.
- Rate limiting, cabeçalhos de segurança (CSP/HSTS) e verificação de `Origin` estão implementados.
- Arquivos estáticos são servidos só a partir de `apps/web/dist`, com checagem de contenção de caminho. A raiz do repositório não é servida.

### Limitações conhecidas

- **Não há interface de cupom.** O hook `useCoupon` existe, valida corretamente
  o `valido: false`, mas nenhum componente o importa. O `App.tsx` envia
  `cupom: "Nenhum"` fixo.
- **Só Pix no checkout.** O contrato aceita `pix`, `cartao` e `boleto`, e o
  frontend envia `pix` sempre.
- Alterações no contrato shared durante `dev` exigem recompilar esse pacote.
  A API usa `tsx watch` e o frontend usa o recarregamento do Vite para seus próprios fontes.

## Próximos passos

- Ligar a interface de cupom ao `useCoupon` que já existe.
- Criar upload de imagens e envio de e-mail (hoje só há as variáveis reservadas).
- Validar o workflow no GitHub e configurar o primeiro deploy.
- Completar acessibilidade dos diálogos e revisar os contratos e transações restantes da auditoria.

## Contribuições

Sugestões e melhorias são bem-vindas. Abra uma issue descrevendo o problema ou a ideia antes de enviar uma alteração maior.
