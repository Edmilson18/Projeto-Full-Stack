# ADR 001: oxlint no lugar do ESLint

- **Status:** Aceita
- **Data:** 2026-09-25
- **Escopo:** Ferramenta de lint

## Contexto

O projeto está em TypeScript 7, que é a reescrita nativa do compilador. A
ferramenta de lint precisa de duas coisas: entender a sintaxe TypeScript e,
para as regras mais úteis, consultar a API do compilador.

A escolha natural seria o ESLint com `typescript-eslint`, que é o padrão do
ecossistema. A instalação falhou:

```
npm error peer typescript@">=4.8.4 <6.1.0" from typescript-eslint@8.70.1
```

Isso isolado seria contornável. Instalando com `--legacy-peer-deps` para
investigar, o problema se revela ser fatal:

```
Error: typescript-eslint does not support TS 7.0.
```

O erro é lançado no carregamento do módulo, antes de qualquer regra rodar.
Não é aviso de peer dependency nem depreciação: o pacote se recusa a
funcionar. A própria mensagem do erro sugere rodar com a API do TypeScript 6
em paralelo, o que significa manter dois compiladores no projeto.

## Decisão

Usar **oxlint** com o pacote `oxlint-tsgolint`, que expõe a API do compilador
TypeScript 7 ao linter.

O oxlint é escrito em Rust sobre o projeto Oxc. Para as regras que dependem de
informação de tipo, ele delega ao `oxlint-tsgolint`, construído sobre o
compilador nativo. Na prática a análise de tipos é preservada.

## Alternativas consideradas

**ESLint com `typescript-eslint` e TypeScript 6.** Funciona, e foi o caminho
óbvio. Descartado por dois motivos: obriga a prender o projeto numa versão
antiga do compilador, e mantém dois compiladores instalados para que o linter
funcione. Um linter que exige uma dependência paralela é um linter que vai
quebrar de novo na próxima atualização.

**ESLint com `typescript-eslint` e TypeScript 7.** Descartado pelo erro acima.

**Sem lint, só o compilador.** `tsc` cobre tipos e resolves a maioria dos
erros. Descartado porque não cobre os hooked React, nem código morto, nem
padrões de erro, e porque lint e typecheck sãooides complementares: o
compilador não avisa que um `catch` não usa a variável capturada.

**oxlint sem `oxlint-tsgolint`.** Mais simples de instalar, e foi a primeira
configuração testada: 111 regras em 1,2 s. Descartado por perder 61 avisos de
regra type-aware, entre eles `no-base-to-string` e `no-floating-promises`, que
apegaram defeitos reais neste código.

## Consequências

**Positivo**

- Análise de tipos ativa em TypeScript 7, sem compilador paralelo.
- Velocidade: 209 regras em cerca de 1 s no projeto inteiro.
- Instala sem conflito de peer dependency.

**Negativo**

- Ecossistema menor. Se uma regra necessária não existir no oxlint, não há
  caminho para escrevê-la como plugin próprio.
- `react-in-jsx-scope` vem ativa por padrão e é obsoleta desde o JSX
  transform automático. Das 397 regras reportadas inicialmente, 282 eram
  falsos positivos dessa regra. Desligá-la foi necessário para que o output do
  linter passasse a ter sinal.

**Risco**

- O `oxlint-tsgolint` acompanha a versão do TypeScript. Uma atualização do
  compilador pode exigir atualizar o linter junto. É o mesmo acoplamento que
  o `typescript-eslint` tem, só que por enquanto resolvido.
