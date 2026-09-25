# ADR 006: Deploy em Vercel Hobby e Neon Free

- **Status:** Proposta
- **Data:** 2026-09-25
- **Escopo:** Infraestrutura

## Contexto

O projeto não tem deploy. Para um repositório de portfólio, isso significa que
quem abre o link lê código em vez de usar o software, o que desperdiça a
primeira impressão — a única janela de poucos segundos em que alguém decide se
vale olhar o restante.

A restrição é dura: **custo zero, sem cartão de crédito**. Isso não é
preferência, é o que elimina a maior parte das opções de hosting hoje.

A questão de *quando* fazer o deploy foi avaliada antes da de *onde*. Fazer
cedo demais obriga a brigar com infraestrutura enquanto o schema ainda muda a
cada fase. Fazer tarde demais transforma a última fase numa corrida de
infraestrutura com prazo estourado.

## Alternativas consideradas

**Railway, Fly.io e Render.** Todos exigem cartão de crédito mesmo no free tier.
Descartados pela restrição. O Render tem ainda o PostgreSQL free expiring em
30 dias.

**Tudo em Docker num plano gratuito com suspensão por inatividade.** O free tier
do Render hiberna o serviço após 15 minutos. Um recrutador que abre o link na
segunda-feira vê a tela inicial. Isso **queima a primeira impressão**, que é
justamente o que o deploy deveria proteger.

**Neon para o banco e Vercel para o resto.** Escolhido.

## Decisão

Dividir o deploy em dois momentos, em vez de tratá-lo como evento único:

| Momento | O quê | Custo |
| --- | --- | --- |
| Fase 1 | Docker Compose local, sem conta nenhuma | zero |
| Fase 3 | Primeiro deploy hospedado; a URL entra no README | zero |
| Fase 9 | GitHub Actions faz o deploy a cada `main` | zero |

O link público nasce no fim da Fase 3, quando existe uma API de verdade, e não
no dia 1 com um `hello world`.

## Limites verificados dos planos gratuitos

Vercel Hobby: 100 GB de transferência, 1 milhão de invocações de função, 4
horas de CPU, 100 minutos de build por mês, timeout de função de 60 segundos.
Quando um limite estoura, o serviço **pausa** em vez de cobrar excedente — o que
torna impossível gastar dinheiro por acidente.

Neon Free: 0,5 GB de armazenamento, 100 horas de CPU por mês, até 2 CU, 5 GB
de transferência pública por mês, e hibernação após cinco minutos inativo.

**O teto real é a transferência de 5 GB do Neon, não o armazenamento.** Meia
gigabyte de dados é bastante; cinco gigabytes de egress param o projeto se o
catálogo crescer com imagens.

## Consequências

**Positivo**

- Impossível gerar custo por engano, o que elimina a principal ansiedade de
  hosting gratuito.
- A URL viva no README é o ativo de maior valor do repositório.
- Nenhuma configuração de infraestrutura antes da Fase 3.

**Negativo**

- A Vercel Hobby proíbe uso comercial. Um e-commerce que gere receita exigiria
  o plano Pro, a US$ 20 por desenvolvedor. Para um portfólio sem receita não há
  problema, mas o projeto não pode ser monetizado ali.
- Duas contas para manter, Vercel e Neon.
- Serverless impõe limite de 60 segundos por função e não tolera conexão TCP
  longa, o que restringe a biblioteca de banco ao driver HTTP.

**Mitigação**

O `README` documenta os limites, para que o número de visitas não seja
surpresa. E o plano de troca, se um dia precisar sair do free, é mover a API
para um container em Railway e apontar a `DATABASE_URL` para o mesmo Neon.
