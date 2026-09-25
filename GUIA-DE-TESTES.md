# Guia de validação manual

Rode a suíte automatizada e depois valide na mão. Os testes automatizados
confirmam que o comportamento não regrediu; a validação manual confirma que a
aplicação inteira continua utilizável de ponta a ponta, algo que um teste de
unidade não enxerga.

---

## Parte 1 — Suíte automatizada

### 1. Rodar tudo de uma vez

```bash
npm test
```

Esperado:

```
Test Files  3 passed (3)
     Tests  69 passed (69)
```

### 2. Rodar a verificação completa

```bash
npm run verify
```

Executa `typecheck`, `lint` e `test` em sequência — o mesmo que o hook de
`pre-push` roda. Esperado: **0 erros** de tipo, **0 erros** de lint, todos os
testes passando.

### 3. Ver a cobertura

```bash
npm run test:coverage
```

Referência do estado atual:

| Arquivo | Linhas | Observação |
| --- | --- | --- |
| `database.ts` | 87% | Regras de dados e transações |
| `validacao.ts` | 100% | Completo |
| `config.ts` | 100% | Completo |
| `server.ts` | 55% | Rotas deCEP e geolocalização ainda sem teste |
| `App.tsx` | 0% | Frontend ainda sem teste, é a Fase 6 |
| `admin.ts` / `dashboard.ts` | 0% | Serão removidos no reescrito da Fase 6 |

O total fica em torno de 31% porque o frontend ainda não tem teste. É
esperado neste ponto.

### 4. Rodar um arquivo só, durante a depuração

```bash
npx vitest run src/testes/banco.test.ts
npx vitest run src/testes/api.test.ts
```

### 5. Filtrar por nome de teste

```bash
npx vitest run -t "cupom"
npx vitest run -t "rollback"
```

### 6. Modo interativo

```bash
npm run test:watch
```

Reexecuta só o arquivo alterado, o que é bem mais rápido que a suíte inteira.

---

## Parte 2 — O que cada arquivo cobre

### `src/testes/banco.test.ts` — 31 testes

Chama `src/database.ts` direto, sem HTTP.

| Bloco | O que verifica |
| --- | --- |
| senhas | Hash `scrypt`, senha nunca em texto puro, salt diferente por usuário, recusa de senha errada |
| cupons | Percentual válido, case-insensitive, inativo, expirado, limite de uso, valor mínimo |
| criação de pedido | Subtotal, frete acima e abaixo de R$ 150, cupom percentual, cupom de frete grátis, contador de uso |
| precisão monetária | Documenta o artefato de ponto flutuante, com valores **verificados** no console |
| produtos | Cadastro, edição, inativação preservando histórico, movimentação de estoque |
| favoritos e avaliações | Alternar favorito, avaliação substituída em vez de duplicada |
| endereço e status | Salvar endereço, status inválido rejeitado |
| tokens de senha | Token reseta uma vez só, e-mail inexistente não emite token |

O teste mais importante é **`faz rollback quando um item do pedido falha`**. Ele
envia dois itens, sendo o segundo inexistente, e confirma que o estoque do
primeiro **não** foi debitado. É a garantia de que a transação funciona.

### `src/testes/api.test.ts` — 27 testes

Sobe o servidor real em porta efêmera e fala HTTP, com cookie de sessão.

| Bloco | O que verifica |
| --- | --- |
| autenticação | Login válido, senha errada, e-mail inexistente com mensagem idêntica, cookie, logout |
| cadastro | Conta nova, e-mail duplicado, validação de campos, `role: "admin"` injetado é ignorado |
| permissões | Anônimo e cliente comum bloqueados em rotas de admin, admin liberado |
| produtos | Listagem pública, CRUD do admin, recusa de dados inválidos |
| pedidos | Exige login, cria pedido, devolve o pedido em `/api/conta` |
| recuperação de senha | Token válido, token inválido, login com a senha nova |
| tratamento de erro | 404 em rota inexistente, 400 em JSON quebrado, servidor não cai |

Dois testes merecem atenção:

- **`não revela se o e-mail existe`** — compara a resposta para e-mail existente
  e inexistente. Se forem diferentes, a API permite enumerar quem tem conta.
- **`não deixa o cadastro escolher o próprio papel de admin`** — envia
  `role: "admin"` no corpo e confirma que a resposta vem `cliente`. É uma
  tentativa de escalada de privilégio.

---

## Parte 3 — Validação manual da aplicação

Confirme que a aplicação inteira funciona, não só a API.

### 1. Preparar

```bash
npm run db:init    # opcional, só se quiser recomeçar do zero
npm run dev
```

Devem subir duas saídas:

```
Servidor da loja rodando em http://localhost:3000
```

```
VITE v8.2.2  ready in 300 ms
➜  Local:   http://localhost:5173/
```

### 2. Conferir que o banco de teste não foi tocado

O ponto mais importante deste guia. A suíte usa um banco separado:

```bash
npm run dev
```

Em outra aba:

```bash
Get-ChildItem .tmp\teste.db      # Windows
ls -la .tmp/teste.db             # Linux/macOS
```

Abra `http://localhost:3000/api/produtos` no navegador. Os produtos devem ser os
de `database/schema.sql`, **não** os que você criou a mano. Se os dados de teste
aparecerem na loja, a suíte está gravando no banco errado — e isso é um defeito
grave.

### 3. Fluxo de cliente

1. Abra `http://localhost:5173` sem estar logado. A vitrine precisa carregar.
2. Adicione dois produtos ao carrinho. Confira o total.
3. Tente finalizar a compra. Deve pedir login.
4. Crie uma conta. O carrinho deve ser preservado.
5. Aplique o cupom `BEMVINDO10` e confira o desconto de 10%.
6. Finalize. Vá em **Minha conta** e confirme que o pedido aparece com status
   "processando".
7. Favorite um produto e avalie outro. Confirme em **Minha conta**.

### 4. Fluxo de administrador

1. Faça logout e entre com `admin@lojaficticia.com` / `admin123`.
2. Abra `http://localhost:5173/admin.html`. Cadastre um produto.
3. Confirme que o produto aparece na loja em `http://localhost:5173`.
4. Edite preço e quantidade. Salve.
5. Inative o produto. Ele deve sumir da vitrine, mas continuar no painel.
6. Abra `http://localhost:5173/dashboard.html`. Confira receita, ticket médio e
   gráficos.
7. Mude o status de um pedido para "enviado".

### 5. Verificar o gate de produção na mão

Este é o teste que a suíte não cobre, porque precisa de um ambiente diferente.

```bash
# Windows PowerShell
$env:NODE_ENV="production"
$env:PORT="3100"
npx tsx src/server.ts
```

Em outra aba:

```bash
curl.exe -X POST http://localhost:3100/api/recuperar-senha `
  -H "Content-Type: application/json" `
  -d '{\"email\":\"admin@lojaficticia.com\"}'
```

**Esperado: nenhum campo `token` na resposta.**

```json
{"mensagem":"Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação."}
```

Depois, confirme que em desenvolvimento o token **aparece**, para provar que o
gate funciona nos dois sentidos:

```bash
$env:NODE_ENV="development"
$env:PORT="3101"
npx tsx src/server.ts
```

```bash
curl.exe -X POST http://localhost:3101/api/recuperar-senha `
  -H "Content-Type: application/json" `
  -d '{\"email\":\"admin@lojaficticia.com\"}'
```

**Esperado: campo `token` presente.** Encerre os dois servidores ao final.

### 6. Verificar o build de produção

```bash
npm run build
npm start
```

Abra `http://localhost:3000`. A loja deve funcionar servida pelo build, não pelo
Vite. Confira também `http://localhost:3000/admin.html` e
`http://localhost:3000/dashboard.html`.

Depois, confira que `build/` não contém lixo:

```bash
Get-ChildItem build
```

Esperado: exatamente 7 arquivos `.js`, mais `App.js`, `admin.js`,
`dashboard.js`, `database.js`, `main.js`, `server.js`, `validacao.js`. Se
aparecer `*.test.js`, o `tsconfig.build.json` parou de excluir os testes.

---

## Parte 4 — O que ainda não é coberto

| Área | Situação |
| --- | --- |
| Frontend (`App.tsx`) | Sem teste. Entra na Fase 6, com Testing Library |
| Painéis `admin.html` e `dashboard.html` | Sem teste, e serão removidos |
| Endpoints de CEP e geolocalização | Sem teste, pois chamam APIs externas |
| Execução no navegador | Só Playwright, na Fase 7 |
| Carga e concorrência | Fora do escopo de um portfólio |

Uma limitação que vale registrar: **o teste de rollback prova que a transação
atua, não que ela é à prova de corrida.** Duas requisições simultâneas ainda
podem passar da checagem de estoque antes do `UPDATE`. Isso exigiria `SELECT ...
FOR UPDATE` ou uma restrição no banco, e está anotado na Fase 4.
