# ADR 004: Valores monetários em centavos inteiros

- **Status:** Proposta
- **Data:** 2026-09-25
- **Escopo:** Banco de dados

## Contexto

O schema define os valores em ponto flutuante:

```sql
preco        REAL NOT NULL CHECK (preco >= 0),
subtotal     REAL NOT NULL,
desconto     REAL NOT NULL DEFAULT 0,
total_final  REAL NOT NULL,
```

E o cálculo do pedido é feito em `number` do JavaScript:

```ts
const desconto = subtotal * (porcentagemDesconto / 100);
const totalFinal = subtotal - desconto + frete;
```

IEEE 754 representa 599,90 de forma aproximada. A soma de dois valores
monetários nunca fecha exatamente, e o resíduo se acumula a cada operação.
O resultado é um relatório que não bate com a soma dos pedidos, o que em
e-commerce é um defeito de conciliação, não um detalhe de precisão.

## Alternativas consideradas

**Manter `REAL` e arredondar na exibição.** É o que muitos projetos fazem e é
insuficiente: o erro continua existindo na origem e se manifesta quando se
compara o total gravado com a soma dos itens gravados.

**`NUMERIC` com escala fixa.** O PostgreSQL trata `NUMERIC(12,2)` com exatidão
decimal, e o driver devolve string para preservar a precisão. Contra: a
conversão para `number` no JavaScript reintroduz a imprecisão, então cada
camada precisaria de tratamento próprio. Some-se que a maioria das bibliotecas
de ORM mapeia `NUMERIC` para `string` ou `Decimal`, o que gera atrito
constante na aplicação.

**Guardar em centavos, como `INTEGER`.** A operação deixa de ser
representação aproximada e passa a ser aritmética exata, que o JavaScript faz
corretamente dentro da faixa segura de `Number` — até 2^53, o que dá mais de
90 trilhões de centavos.

## Decisão

Armazenar dinheiro em **centavos inteiros**, com o nome da coluna explícito:
`preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0)`.

A conversão para exibição acontece em um único lugar, na fronteira da API, com
uma função de formatação. Nenhum cálculo intermediário toca em ponto
flutuante.

## Consequências

**Positivo**

- Soma de itens iguala o total, sempre. Conciliação deixa de ser um problema.
- Nenhuma regra de arredondamento espalhada pela aplicação.
- `CHECK (preco_centavos >= 0)` continua valendo, com tipagem correta.

**Negativo**

- Todo o código que toca dinheiro passa a multiplicar e dividir por 100. É a
  desvantagem real desta abordagem e precisa de disciplina.
- Migração de dados: os valores existentes em `REAL` precisam ser convertidos
  com `ROUND(preco * 100)`, e a coluna precisa ser recriada, porque SQLite não
  altera tipo de coluna em `ALTER`.

**Mitigação**

A conversão fica confinada às funções de formatação e a um par de helpers
explícitos no pacote compartilhado, `paraCentavos` e `deCentavos`, para que
multiplicar por 100 não apareça espalhado.
