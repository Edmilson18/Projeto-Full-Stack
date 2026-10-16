# ADR 004: Valores monetários em centavos inteiros

- **Status:** Aceita
- **Data:** 2026-09-25
- **Implementada em:** Fase 4. As colunas monetárias viraram `INTEGER` em
  centavos, e o desconto percentual usa `Math.round` para fechar em centavos
  em vez de propagar meio centavo.

## Contexto

Antes da migração para PostgreSQL, o schema SQLite definia valores em ponto flutuante:

```sql
preco        REAL NOT NULL CHECK (preco >= 0),
subtotal     REAL NOT NULL,
desconto     REAL NOT NULL DEFAULT 0,
total_final  REAL NOT NULL,
```

O cálculo antigo do pedido era feito em reais com `number` do JavaScript:

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
corretamente dentro da faixa segura de `Number`. Neste projeto, porém, o limite
efetivo de cada coluna é o `INTEGER` de 32 bits do PostgreSQL: 2.147.483.647 centavos
(R$ 21.474.836,47). A API limita preço, subtotal e total a essa faixa, antes de gravar.

## Decisão

Armazenar dinheiro em **centavos inteiros**, com o nome da coluna explícito:
`preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0)`.

O cadastro converte reais em centavos com `Math.round(preco * 100)`. O checkout
calcula com os centavos lidos do banco; descontos percentuais são arredondados com
`Math.round`. A API divide por 100 ao preparar as respostas em reais, e a interface
usa `formatarMoeda` para exibição. Essa implementação usa `number`; centavos inteiros
evitam acumular frações monetárias durante as somas, dentro dos limites validados.

## Consequências

**Positivo**

- Soma de itens iguala o total, sempre. Conciliação deixa de ser um problema.
- Arredondamento explícito na entrada do preço e no cálculo do desconto percentual.
- `CHECK (preco_centavos >= 0)` continua valendo, com tipagem correta.

**Negativo**

- Todo o código que toca dinheiro passa a multiplicar e dividir por 100. É a
  desvantagem real desta abordagem e precisa de disciplina.
- A migração inicial do PostgreSQL cria as colunas em centavos. Importar um banco
  SQLite antigo requer conversão explícita; não há importador automático neste projeto.

**Mitigação**

As colunas usam o sufixo `_centavos`, e os contratos documentam a unidade dos campos.
Os testes conferem soma de itens, arredondamento, descontos e rejeição de totais fora
da faixa. Não existem helpers `paraCentavos`/`deCentavos` no estado atual; as conversões
ficam nas funções do banco e na preparação das respostas.
