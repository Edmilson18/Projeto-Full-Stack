# ADR 003: Monorepo com npm workspaces

- **Status:** Aceita
- **Data da decisão original:** 2026-09-25
- **Revisada em:** 2026-10-15
- **Escopo:** Organização do repositório e instalação reproduzível
- **Título original:** Monorepo com pnpm workspaces e Turborepo. O nome do arquivo foi preservado para manter os links existentes.

## Contexto

API e interface rodam em ambientes diferentes, mas compartilham contratos de entrada e saída. A estrutura precisa permitir dependências e comandos por aplicação e um único lockfile para reproduzir o conjunto.

A auditoria encontrou uma divergência concreta: os manifestos declaravam versões de ferramentas diferentes das registradas no lockfile e instaladas localmente. A raiz usava TypeScript 5.9.3 instalado apesar de declarar 7, enquanto a web resolvia Vitest 3 apesar de declarar 5.

Essa divergência foi corrigida alinhando manifestos e lockfile. Ela não é uma consequência inevitável de usar npm workspaces. O npm também possui cache endereçado por conteúdo; isso é diferente do modelo de instalação do pnpm e não garante, por si só, uma árvore sem versões duplicadas. [Documentação do cache npm](https://docs.npmjs.com/cli/v11/commands/npm-cache/).

## Decisão

Manter npm workspaces em três pacotes:

```text
apps/api         Fastify e PostgreSQL
apps/web         React e Vite
packages/shared  Schemas Zod e contratos
```

Usar `npm ci` para instalação a partir do lockfile e `npm ls --depth=0` para conferir a coerência das versões declaradas. Mudanças de dependências devem atualizar manifesto e lockfile juntos. [Documentação de npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

Os scripts da raiz compilam shared antes de executar consumidores em desenvolvimento, checagem de tipos, testes e cobertura. O build permanece sequencial: shared, API e web.

## Alternativas

- **pnpm workspaces:** opção válida se o modelo de instalação trouxer benefício medido. Uma restrição anterior de permissão no ambiente não é uma limitação inerente do gerenciador. Não é necessário trocar para resolver as divergências encontradas.
- **Turborepo/Nx:** podem organizar grafo e cache de tarefas. No tamanho atual, scripts explícitos atendem às dependências de build sem uma camada adicional.
- **Pacote único:** reduz pastas, mas mistura dependências de navegador/servidor e torna a fronteira dos contratos menos explícita.

## Consequências

- Há um único pacote de contratos e um único lockfile.
- A compilação de shared precisa anteceder tarefas consumidoras, pois os imports apontam para seu `dist`.
- O modo de desenvolvimento ainda exige recompilar shared ao editar contratos; não há watcher desse pacote nesta etapa.
- Versões coerentes exigem manutenção dos manifestos e validação em CI, independentemente do gerenciador.
- Não há cache de tarefas entre execuções. Reavaliar se o tempo de build justificar essa complexidade.
