# Architecture Decision Records

Registro das decisões de arquitetura do projeto. Cada ADR documenta uma decisão,
as alternativas avaliadas e as consequências — inclusive as ruins.

## Por que este diretório existe

Código mostra o que foi feito. ADR mostra **por que** foi feito e o que foi
descartado no caminho. A segunda informação é a que distingue quem Decide de
quemSegue receita, e raramente está disponível em repositório público.

O formato segue o modelo de Michael Nygard, sem as partes que não se aplicam a um
projeto com poucos Contribuidores.

## Convenções

| Campo | Significado |
| --- | --- |
| **Status** | `Proposta` (decidido, ainda não implementado), `Aceita` (em uso), `Substituída` (não vale mais, apontando a substituta) |
| **Data** | Data da decisão, não da implementação |
| Alternativas | Sempre incluídas, mesmo as obviamente piores. Uma ADR sem alternativas pesquisadas não registra uma decisão, registra um Releases |

## Índice

O link é pelo nome do arquivo, porque os títulos de 004 e 005 não seguem a
ordem de gravação.

| ADR | Título | Status |
| --- | --- | --- |
| [001](001-linter-oxlint.md) | Linter: oxlint no lugar do ESLint | Aceita |
| [002](002-framework-api-fastify.md) | Framework de API: Fastify | Aceita |
| [003](003-monorepo-pnpm-turborepo.md) | Monorepo com workspaces e cache de build | Parcialmente adotada — npm workspaces, sem Turborepo |
| [004](004-dinheiro-em-centavos.md) | Valores monetários em centavos inteiros | Aceita |
| [005](005-banco-postgresql-neon.md) | Banco de dados: PostgreSQL sobre SQLite | Aceita |
| [006](006-deploy-vercel-neon.md) | Deploy: Vercel Hobby com Neon Free | Proposta |
