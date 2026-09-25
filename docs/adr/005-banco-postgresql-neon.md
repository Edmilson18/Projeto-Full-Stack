# ADR 005: PostgreSQL no Neon em vez de SQLite

- **Status:** Aceita com ressalva
- **Data:** 2026-09-25
- **Escopo:** Banco de dados
- **Ressalva:** o PostgreSQL entrou pelo `docker-compose.yml`, não pelo Neon.
  O Neon continua como alvo de deploy e exige `DATABASE_SSL=true` e o driver
  HTTP no lugar do pool TCP. Ver "Consequências".

## Contexto

O projeto usa SQLite através de `node:sqlite`, sem dependência externa. É uma
escolha legítima e traz مزias reais: zero configuração, banco em arquivo, e
`npm install && npm run dev` funciona em qualquer máquina.

O gargalo apareceu na Fase 1, quando o linter com análise de tipos reportou
`no-unsafe-type-assertion` 33 vezes. A causa é única: as funções de acesso a
dados devolvem `Array<Record<string, unknown>>`, e nenhuma biblioteca de
consulta está no caminho. Trocar o banco resolve parte disso, mas o tipo do
retorno depende do *query builder*, não do banco.

O que realmente motiva a troca é o vocabulário. SQLite não tem `jsonb`, não
tem índices parciais, não tem `ON CONFLICT` com `WHERE`, não tem
`json_agg`, nem window functions. São construções que aparecem em qualquer
entrevista de backend.

Restrição do projeto: **custo zero, sem cartão de crédito**.

## Alternativas consideradas

**Manter SQLite.** Contra o que foi listado acima. A favor: zero
configuração, e o banco em arquivo é fácil de versionar junto com o projeto
para efeitos de demonstração.

**Turso ou libSQL.** SQLite gerenciado, com free tier e sem cartão. Contra:
mantém as limitações do SQLite. É a opção a considerar se a prioridade for
simplicidade operacional, não vocabulário SQL.

**Supabase.** PostgreSQL com free tier generoso, sem cartão. Contra: o
conjunto de serviços que gira em torno do Postgres (auth, storage, realtime)
tenta resolver problemas que este projeto quer resolver por conta própria, e a
camada de abstração entre o cliente e o banco atrapalha a leitura das queries.

## Decisão

**PostgreSQL no Neon**, plano gratuito.

O Neon entrega PostgreSQL real com *branching* de banco — clone do schema na
lógica de `git`, útil para testar migrações sem tocar nos dados de execução. O
plano gratuito cobre o escopo do projeto com folga.

Um detalhe técnico que precisa ser registrado: **de ambiente serverless para
PostgreSQL, conexão TCP direta não é viável.** O pool de conexões do Postgres
não escala para a quantidade de invocações concorrentes que uma função
serverless gera, e conexões longas são encerradas. O acesso precisa ser pelo
driver HTTP do Neon, `@neondatabase/serverless`, ou pelo pooler. Isso não é
opcional: é a primeira coisa que quebra se a `DATABASE_URL` for usada como
`postgres://` comum.

## Consequências

**Positivo**

- Vocabulário SQL completo, incluindo `jsonb` e window functions.
- Tipagem real no retorno das consultas, com o query builder do ADR seguinte.
- Migrações versionadas em SQL, auditáveis em code review.

**Negativo**

- O projeto deixa de rodar com `npm install` sem mais nada. Passa a exigir
  Docker Compose local ou uma URL do Neon, o que é uma barreira de entrada
  real para quem só quer abrir e olhar.
- Cold start de 300 a 500 ms quando o banco hiberna após cinco minutos
  inativo. Num portfólio, o primeiro clique pode pagar esse custo.

**Mitigação**

O `docker-compose.yml` com PostgreSQL local entra junto na Fase 4, e o README
documenta os dois caminhos: local sem conta, ou Neon em 30 segundos.
