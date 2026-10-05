# ADR 003: Monorepo com workspaces e cache de build

- **Status:** Parcialmente adotada
- **Data:** 2026-09-25
- **Escopo:** Organização do repositório
- **O que foi realmente adotado:** a estrutura de três pacotes, com **npm
  workspaces**. Nem o pnpm nem o Turborepo entraram: o pnpm exige privilégio de
  administrador no ambiente de execução, e o cache de build do Turborepo foi
  dispensado porque, com três pacotes, o `npm run build` em sequência já é rápido
  o bastante para não justificar o grafo de cache. O `package.json` da raiz
  declara `"packageManager": "npm@12.0.2"`.
- **Título original:** "Monorepo com pnpm workspaces e Turborepo". O nome do
  arquivo continua o original para não quebrar links.

## Contexto

Hoje o projeto é um pacote único. `src/server.ts` e `src/App.tsx` dividem o
mesmo `tsconfig.json` e o mesmo conjunto de dependências, apesar de rodarem em
ambientes diferentes: um em Node com SQLite, o outro no browser.

A Fase 3 vai trocar o servidor, e a Fase 6 vai decompor o componente de 1.379
linhas do frontend. Nenhuma das duas deveria exigir mexer na estrutura de
pastas, e o contrato entre API e web precisa ser uma coisa só, não uma
convenção mantida à mão.

## Alternativas consideradas

**Manter pacote único.** Sem mudança de estrutura. Contra: não há como o
frontend importar um tipo do servidor, então o contrato compartilhado vira
duplicação. E a dependência entre o deploy do servidor e o build do cliente
continua implícita.

**Workspaces do npm com `concurrently`.** Mais simples de configurar, sem
dependência nova. Contra: o npm não faz content-addressable store, então cada
pacote recebe sua própria cópia de `typescript` e `react`. Divergências de
versão entre pacotes são a causa mais comum de `Cannot find module` que só
aparece em CI.

**Nx.** Mais completo que o Turborepo, com grafo de dependências e daemon de
cache. Contra: muito mais configuração. Para três pacotes, é $$$$$$$$$$$$$$
desgaste desproporcional ao ganho.

**Bun workspaces.** Mais simples e rápido. Contra: adoption ainda menor que a do
pnpm, e trocar de runtime agora aumentaria o escopo da fase sem resolver
nenhum dos problemas deste ADR.

## Decisão

Workspaces em três pacotes. **npm**, sem cache de build:

```
apps/api        Fastify, PostgreSQL via pg
apps/web        React 19 com Vite
packages/shared Esquemas Zod e tipos
```

O `packages/shared` é a peça central: é o que o frontend e o servidor
importam, e o que impede a duplicação do contrato.

Duas partes da decisão original **não** foram implementadas, e cada uma por um
motivo diferente:

- **pnpm.** Requer privilégio de administrador para instalar, indisponível no
  ambiente de execução. O npm não tem store content-addressable, então cada
  pacote recebe sua própria cópia de `typescript`, `vitest` e `jsdom`. Isso é a
  dívida real que a decisão original pretendia evitar.
- **Turborepo.** O cache de build foi descartado depois de medir: `npm run
  build` leva poucos segundos e, sem cache, recompila o `packages/shared` de
  todo modo. Para três pacotes, a configuração do grafo custaria mais do que
  economiza.

## Consequências

**Positivo**

- O contrato Zod é um pacote real, com o tipo inferido nos dois lados.
- O deploy trata `apps/web` e `apps/api` como projetos independentes, sem
  reescrever pipeline.
- Um lockfile só, e ferramentas que já vinham no ambiente de execução.

**Negativo**

- Sem store content-addressable, cada pacote recebe sua própria cópia de
  `typescript`, `vitest` e `jsdom`, em versões diferentes. É a origem de
  "funciona num pacote e falha no outro", e de uma classe de bug que só aparece
  depois de um `npm install`.
- Sem cache de build, todo `npm run build` recompila os três pacotes. Aceitável
  no tamanho atual; vira incômodo se o `apps/web` crescer.
- `npm run typecheck` e `npm test` precisam compilar o `packages/shared`
  antes, porque `apps/api` e `apps/web` importam os tipos do `dist/` dele. A
  ordem está explícita no `package.json` da raiz.
- Debug de resolução de módulos fica um nível mais profundo, o que exige
- Debug de resolução de módulos não muda: continua sendo o do npm.
- Um segundo lockfile não existe: segue um só.

**Mitigação**

A migração foi feita mantendo a aplicação funcionando a cada passo, com
`npm run dev` e `npm test` validados.
