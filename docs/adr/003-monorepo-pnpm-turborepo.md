# ADR 003: Monorepo com pnpm workspaces e Turborepo

- **Status:** Proposta
- **Data:** 2026-09-25
- **Escopo:** Organização do repositório

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

**pnpm workspaces com Turborepo**, em três pacotes:

```
apps/api        Fastify, Drizzle, PostgreSQL
apps/web        Next.js
packages/shared Esquemas Zod e tipos
```

O `packages/shared` é a peça central: é o que o frontend e o servidor
importam, e o que impede a duplicação do contrato.

## Consequências

**Positivo**

- O contrato Zod é um pacote real, com o tipo inferido nos dois lados.
- Store content-addressable elimina a divergência de versões entre pacotes.
- Cache de build do Turborepo evita recompilar o que não mudou.
- O deploy passa a poder tratar `apps/web` e `apps/api` como projetos
  independentes, sem reescrever pipeline.

**Negativo**

- `pnpm` passa a ser requisito de instalação, e não só o npm.
- Debug de resolução de módulos fica um nível mais profundo, o que exige
 xkifer de estar familiarizado.
- Um segundo lockfile. Quem conhece apenas npm vai achar o
  `pnpm-lock.yaml` unfamiliar.

**Mitigação**

A migração é feita mantendo a aplicação funcionando: o `apps/api` começa
importando de `src/` e o `apps/web` idem, e os caminhos são invertidos ao longo
da fase, com `npm run dev` e `npm test` validados a cada passo.
