# Loja Tech

Aplicação full-stack de e-commerce desenvolvida como projeto de portfólio. A Loja Tech reúne uma vitrine de produtos, carrinho, checkout demonstrativo, área do cliente e painel administrativo, com frontend em React e backend em Node.js.

> Projeto demonstrativo: pagamentos, frete e envio de pedidos não usam serviços externos reais.

## Índice

- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Como executar](#como-executar)
- [Credenciais de demonstração](#credenciais-de-demonstração)
- [Estrutura do projeto](#estrutura-do-projeto)
- [API](#api)
- [Segurança e limitações](#segurança-e-limitações)
- [Próximos passos](#próximos-passos)

## Funcionalidades

### Cliente

- Cadastro, login e logout.
- Catálogo com busca e filtro por categoria.
- Carrinho persistido no navegador, com atualização de quantidade e validação de estoque.
- Checkout com Pix, cartão e boleto em modo demonstrativo.
- Cupom percentual e cupom de frete grátis.
- Área “Minha conta” com endereço de entrega, favoritos e pedidos detalhados.
- Favoritos, itens vistos recentemente e avaliação de produtos.
- Tema claro e escuro.

### Administração

- Cadastro, busca, edição e inativação de produtos.
- Preservação de histórico ao inativar produtos.
- Gestão do status dos pedidos: processando, enviado, finalizado e cancelado.
- Dashboard com produtos, usuários, pedidos, receita, ticket médio, produtos vendidos, gráficos e alertas de estoque baixo.
- Exportação de relatório CSV e relatório para impressão/PDF.

## Tecnologias

- React 19
- TypeScript
- Vite
- Node.js
- SQLite (`node:sqlite`)
- CSS responsivo
- Lucide React

## Como executar

### Pré-requisitos

- [Node.js](https://nodejs.org/) 24 ou superior.
- npm.

### Instalação

```bash
git clone <URL-DO-SEU-REPOSITORIO>
cd "Projeto - Loja"
npm install
npm run db:init
npm run dev
```

Com o ambiente iniciado:

- Loja: `http://localhost:5173`
- API: `http://localhost:3000`

### Build de produção

```bash
npm run build
npm start
```

O banco é criado em `database/loja.db` a partir de `database/schema.sql`. Esse arquivo não deve ser versionado, pois contém os dados locais de execução.

## Credenciais de demonstração

| Perfil | E-mail | Senha |
| --- | --- | --- |
| Administrador | `admin@lojaficticia.com` | `admin123` |

Use essas credenciais somente no ambiente local de demonstração. Antes de publicar uma aplicação real, crie uma conta administrativa própria e remova qualquer senha de exemplo.

## Estrutura do projeto

```text
.
├── database/
│   └── schema.sql          # Schema, migrações e dados iniciais
├── src/
│   ├── App.tsx             # Loja, autenticação, carrinho e conta
│   ├── admin.ts            # Gestão de catálogo e pedidos
│   ├── dashboard.ts        # Métricas e relatórios
│   ├── database.ts         # Acesso ao SQLite e regras de dados
│   ├── server.ts           # API HTTP e sessão
│   └── validacao.ts        # Validações do domínio
├── admin.html              # Painel administrativo
├── dashboard.html          # Dashboard
├── package.json
└── README.md
```

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/cadastro` | Cria uma conta de cliente. |
| `POST` | `/api/login` | Autentica e cria a sessão. |
| `POST` | `/api/logout` | Encerra a sessão. |
| `GET` | `/api/produtos` | Lista os produtos ativos. |
| `GET` | `/api/produtos/mais-vendidos` | Lista os produtos mais vendidos. |
| `POST` | `/api/pedidos` | Cria um pedido a partir do carrinho. |
| `GET` | `/api/conta` | Retorna perfil, favoritos e pedidos do cliente. |
| `PUT` | `/api/conta/endereco` | Atualiza o endereço de entrega. |
| `GET` | `/api/dashboard` | Retorna métricas administrativas. |
| `POST` | `/api/produtos` | Cria produto (admin). |
| `PUT` | `/api/produtos/:id` | Edita produto (admin). |
| `DELETE` | `/api/produtos/:id` | Inativa produto (admin). |
| `PATCH` | `/api/admin/pedidos/:id` | Atualiza status do pedido (admin). |

## Segurança e limitações

- Senhas são armazenadas com hash `scrypt` e comparação segura.
- A autorização no backend é feita por sessão identificada em cookie `HttpOnly`; dados no `localStorage` são usados somente para personalizar a interface, não para autorizar ações.
- A sessão é mantida em memória. Portanto, é adequada para demonstração local, mas não para múltiplas instâncias ou produção.
- O cookie deve receber a opção `Secure` quando o projeto estiver hospedado com HTTPS.
- Pagamento, frete, e-mail e upload de imagens são simulados ou baseados em URL.

## Próximos passos

- Integrar pagamentos e cálculo de frete reais.
- Armazenar sessões em Redis ou banco de dados.
- Adicionar testes automatizados para autenticação, cupons, pedidos e permissões.
- Criar upload de imagens e notificações por e-mail.
- Configurar CI, lint e deploy.

## Contribuições

Sugestões e melhorias são bem-vindas. Abra uma issue descrevendo o problema ou a ideia antes de enviar uma alteração maior.
