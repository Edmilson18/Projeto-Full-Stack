# ADR 002: Fastify como framework de API

- **Status:** Proposta
- **Data:** 2026-09-25
- **Escopo:** Backend

## Contexto

O servidor atual é `node:http` puro, com um encadeamento de aproximadamente
quarenta blocos `if (req.method === ... && url === ...)` dentro de uma única
função. O problema não é falta de framework: é que os blocos compartilham
estado implícito — o mapa de sessões, a função `responder` e a checagem
`exigirAdmin` são acessados de qualquer lugar, sem fronteira.

A reescrita da API precisa resolver três coisas: roteamento com verificação de
tipo, validação de entrada com um esquema único compartilhado com o frontend, e
tratamento de erro centralizado.

Restrição que o projeto se impôs: **custo zero, sem cartão de crédito**. Isso
elimina as opções de hosting mais comuns e narrowa o deploy para Vercel Hobby e
Neon Free.

## Alternativas consideradas

**NestJS 12.** A primeira alternativa avaliada, e a mais forte em reconhecimento
de mercado no Brasil. Oferece o que o projeto mais precisa: `@nestjs/swagger`
gera OpenAPI a partir dos decoradores, e os guards cobrem o middleware de
autorização que a Fase 5 vai construir.

Um bloqueador foi verificado antes de descartar: o Nest depende de
`emitDecoratorMetadata` para injeção de dependência, e TypeScript 7 é a
reescrita em Go do compilador. Compilando um caso real de injeção, o TypeScript 7
**emite** `design:paramtypes` normalmente, então o Nest funciona. Não há
bloqueador técnico.

O que pesou contra foi o contrato compartilhado. O Nest resolve validação com
`class-validator` e classes DTO, que não compartilham nada com o frontend. Para
manter o schema Zod como fonte única, seriam dois sistemas de validação
 rodando — mais código, e o ponto mais valioso do projeto perde força.

**Hono.** Escrito em TypeScript, roda em Node, Deno, Bun e Cloudflare Workers.
Melhor DX e menor pegada que o Fastify. Contra: menos reconhecido em entrevista
no Brasil, e a promise de multi-runtime esbarra no banco — Workers não fala
PostgreSQL por TCP, exigindo driver HTTP.

**`node:http` com um router próprio.** Uma camada de roteamento de cerca de 50
linhas resolve o problema estrutural. Contra: o roteamento atual **é** um dos
problemas, e recusa de framework num portfólio sugere desconhecimento do
ecossistema, não disciplina.

## Decisão

Usar **Fastify** com o type provider de Zod.

O argumento decisivo é o contrato compartilhado. Com Fastify, o mesmo objeto de
esquema Zod valida a requisição no servidor e, por inferência, vaza o tipo
correspondente para o React. Com Nest, isso exigiria dois sistemas.

Encapsulamento por plugin é o segundo argumento: resolve o estado global
implícito do servidor atual, porque cada plugin tem seu próprio escopo.

## Consequências

**Positivo**

- Um único esquema Zod como fonte de verdade, com tipo inferido nas duas pontas.
- Encapsulamento por plugin elimina o estado implícito compartilhado.
- `app.inject()` permite teste de integração sem abrir socket: a suíte roda em
  segundos.
- Pino já vem integrado, o que resolve parte da observabilidade da Fase 8.

**Negativo**

- Decoradores de rota e um pouco mais de boilerplate que o Nest, que tem menos
  boilerplate e mais código de framework no lugar do código da aplicação.

**Risco**

- A ordem de substituição dos endpoints em fases é um trabalho real. Cada rota
  nova entra no estilo novo, e as antigas são convertidas por módulo, não de uma
  vez, para que o aplicativo não fique sem rotas funcionais entre fases.
