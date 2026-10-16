# Progresso das correções

Atualizado em 15/10/2026. A auditoria original continua como registro do diagnóstico;
este arquivo acompanha o que foi implementado e o que ainda falta.

## Primeiro lote: ambiente, integridade e checkout

### Verificação final

| Checagem | Resultado |
| --- | --- |
| `npm run verify` | Aprovado: tipos, lint, formatação, testes e build |
| API | 154 testes aprovados |
| Frontend | 90 testes aprovados |
| Total | 244 testes aprovados; 36 testes novos em relação à auditoria |
| `npm ls --depth=0` | Sem versões inválidas |
| `npm ci --dry-run --offline --ignore-scripts` | Simulação aprovada; não equivale a reinstalação limpa completa |
| Configuração Vite | Diretório de ambiente da raiz e override do proxy conferidos |
| Workflow CI | YAML validado localmente; execução no GitHub pendente |
| `git diff --check` | Aprovado |

As consultas do dashboard também foram ajustadas para execução sequencial na
conexão da transação, removendo o uso concorrente desaconselhado pelo driver `pg`.
Não houve teste visual completo nem build da imagem Docker neste lote.

### Implementado

- **AMB-01 a AMB-05:** dependências e lockfile alinhados; teste de sessão deixa de apagar dados ao criar app; formatação corrigida; caminhos de depuração e ambiente do Vite ajustados. A simulação offline de `npm ci` passou, assim como `npm ls --depth=0`.
- **AMB-06, parte:** `verify` inclui tipos, lint, formatação, testes e build; pre-push usa o mesmo comando; workflow GitHub Actions preparado com PostgreSQL isolado. Execução remota do workflow ainda depende de enviar o código ao GitHub.
- **SEG-03:** acesso direto deixa de confiar em IP repassado por cabeçalho. Proxy confiável exige configuração explícita em `TRUSTED_PROXIES`.
- **SEG-04:** reset valida protocolo e hostname; rejeita parâmetros que podem substituir o host e URLs com `localhost` apenas nas credenciais ou no caminho. Nenhum reset foi executado.
- **SEG-05 a SEG-07:** redefinição consome o token atomicamente e revoga sessões; logins simultâneos são serializados por usuário. Cenários concorrentes receberam testes.
- **SEG-08:** TLS habilitado exige verificação de certificado e `verify-full`, inclusive quando a URL tenta rebaixar o modo. Conexões de teste usam a mesma configuração.
- **SEG-09:** Compose deixa de oferecer senha administrativa padrão em produção; senha vazia é recusada na criação do administrador em produção; seed deixa de imprimir credencial de exemplo.
- **DOM-01 e DOM-04:** reativar pedido exige unidades disponíveis e produto ativo; produto inativo é recusado na compra. Rejeições fazem rollback de estoque, status e auditoria.
- **DOM-02:** chave de idempotência por conta e tentativa, armazenada na migração 003 com a resposta original. Repetições simultâneas ou em outra instância devolvem o mesmo pedido. Chave reutilizada com outra compra responde 409.
- **DOM-03:** seed preserva estoque, preços, status e demais edições existentes; preenche somente fotos ausentes.
- **DOM-05, parte:** compras e alterações de status bloqueiam produtos em ordem consistente. Política geral de repetição de transações transitórias ainda não foi implementada.
- **DOM-06:** entrada de preço/estoque e total do pedido respeitam a faixa de armazenamento. Pedidos fora do limite recebem erro de negócio e rollback, em vez de overflow no banco.
- **DOM-07 e DOM-08, parte:** ticket médio usa pedidos não cancelados; listagem de cupons oculta os esgotados. Completar a representação de desconto fixo continua pendente.
- **WEB-02:** atualização funcional do carrinho usa as entradas atuais; conclusão retira apenas as quantidades compradas. Confirmação guarda os itens e a mesma chave para repetir após falha de conexão; Voltar e backdrop não fecham o resumo enquanto processa.
- **DOC-01/DOC-02, parte:** README atualizado para os comandos, CI e checkout atuais; ADR 003 corrigida. Os demais ADRs ainda precisam de revisão.

### Mudanças de comportamento

O cliente web gera uma UUID ao abrir o resumo e a reutiliza quando confirma novamente após
falha de conexão. Isso protege a repetição dessa intenção de compra enquanto o resumo
está mantido. Recarregar a página descarta o resumo: persistir recuperação de checkout após
recarregamento fica para uma etapa posterior.

A API continua aceitando pedidos sem chave por compatibilidade. Nesses clientes externos,
cada requisição sem chave representa uma compra nova. A proteção de repetição exige enviar
e reutilizar `chaveIdempotencia` com os mesmos itens, cupom e método de pagamento.

A migração 003 é aditiva e será aplicada no próximo início da API, conforme o mecanismo
existente. Ela foi validada em schemas de teste isolados. Não foi aplicado reset ou seed
sobre o banco de desenvolvimento durante este trabalho.

## Segundo lote: sessão, conta e recuperação

### Implementado

- **SEG-01/SEG-02 e WEB-05:** a recuperação responde 503 enquanto não há entrega de e-mail. O token só é retornado com `NODE_ENV=development` **e** `ALLOW_LOCAL_PASSWORD_RESET=true`, nunca com ambiente ausente/teste/produção. O token deixa de ser registrado nos logs. O modo local abre diretamente a redefinição. Links com `resetToken` abrem o formulário mesmo com sessão existente; o parâmetro é retirado do endereço, preservando outros parâmetros e fragmentos.
- **WEB-01:** dados da conta identificam o usuário proprietário; consultas, salvamentos e callbacks antigos não substituem os dados de outra conta. Respostas de checkout e avaliações também conferem a sessão de origem. Trocar usuário fecha janelas privadas e descarta sugestões de endereço anteriores antes da interação.
- **WEB-03:** consulta inicial da sessão não sobrescreve login/logout posteriores; a aplicação espera a verificação inicial. Respostas 401 da sessão atual invalidam a autenticação e levam ao login com aviso. Credenciais incorretas no login e respostas 401 de sessões anteriores não encerram a sessão nova.
- **WEB-04:** perfil recebido após a abertura preenche o endereço; campos editados, inclusive apagados, prevalecem sobre recargas e geolocalização. O formulário tem identidade por usuário.
- **WEB-06:** listas de avaliações pertencem ao produto consultado; respostas e erros atrasados de outro produto são ignorados.
- **WEB-07:** avaliação direta recarrega a conta e a lista pública uma vez, atualizando a elegibilidade. Falha de leitura posterior é tratada como falha de carregamento, sem informar que o envio já confirmado foi recusado.
- **WEB-08:** favoritos revertem apenas o item da operação que falhou; gravações do mesmo produto seguem a ordem dos cliques. Uma falha antiga não desfaz outra intenção mais recente nem interfere nos favoritos da próxima conta.
- **WEB-09:** contagem, total e compra de selecionados consideram somente itens ainda presentes no carrinho.
- **WEB-10:** adicionar pelo modal exige login, assim como adicionar pela vitrine.
- **WEB-11:** falha ao carregar catálogo tem mensagem própria e botão para tentar novamente; consultas ultrapassadas não substituem o resultado mais recente.
- **WEB-16, parte:** produto sem estoque tem botão de adição desabilitado e texto de indisponibilidade no modal; login e cadastro usam a carga de conta do hook, removendo a consulta duplicada.

### Validação

`npm run verify` aprovado: tipos, lint, formatação, testes e build de produção.
159 testes da API e 117 testes da interface passaram, totalizando **276 testes**.
Foram acrescentados 32 testes em relação ao primeiro lote, incluindo respostas fora de
ordem, isolamento entre contas, gravações concorrentes de favoritos, endereço recebido
tardiamente, recuperação local, entrada por link e falha seguida de recuperação do catálogo.
`git diff --check` também passou.

Os testes de banco usam schemas isolados. Não foi executado reset ou seed sobre o banco
de desenvolvimento. Este lote não incluiu inspeção visual completa no navegador.

## Terceiro lote: regras de negócio, contratos e concorrência

### Implementado

- **SEG-11:** trava de migrações por banco/schema, adquirida antes de criar ou consultar o registro. A mesma conexão mantém a trava durante o lote e a libera ao terminar, inclusive após falha. Cada arquivo continua atômico e só é registrado após aplicação bem-sucedida.
- **DOM-05:** transações repetem no máximo três tentativas para `40P01`/`40001`, sempre após rollback e com intervalo curto. Falhas de negócio, integridade e conexão não são repetidas. Callbacks são restritos a operações no banco, sem efeitos externos.
- **DOM-08:** a listagem já excluía cupons esgotados; agora retorna também `desconto` em reais para representar descontos fixos. O contrato de validação conserva campos em centavos com nomes explícitos.
- **DOM-09:** elegibilidade e gravação da avaliação estão na mesma transação, com trava por usuário/produto e proteção contra cancelamento concorrente dos pedidos usados. Uma única tentativa consome a janela; nova compra permite atualizar a avaliação. A data da avaliação é obtida após as travas.
- **DOM-10:** validação explícita de entrada produz 400; erro de schema na saída passa pelo tratamento de falhas internas, com 500 genérico e detalhe somente no log.
- **DOM-11:** produto e sessão usam o mesmo schema nos modelos e respostas; pedido deriva do modelo comum, incluindo o enum de métodos de pagamento. Saídas não aceitam mais flags numéricas herdadas do SQLite. UF de entrada é normalizada e validada contra as 27 siglas brasileiras.
- **DOM-12:** transições compartilhadas: processando → enviado/cancelado; enviado → finalizado; cancelado → processando. Finalizado é terminal. Repetir o estado é idempotente. Enviar exige endereço completo válido; reativar continua exigindo estoque e produto ativo. Cancelamento de envio, devolução e estorno não fazem parte dessa rota.
- **DOM-13, parte:** preservação do endereço de entrega no pedido. Se completo na compra, não é substituído pelo perfil posterior; se incompleto, é preenchido com o perfil válido no despacho. Os snapshots de nome/categoria, cupom e trilha completa de estoque continuam pendentes.
- **DOC-02, parte:** README documenta as regras efetivas. ADR 004 corrigida para o limite `INTEGER` de 32 bits, conversões e arredondamentos existentes, removendo a descrição de helpers inexistentes.

### Validação

`npm run verify` aprovado: tipos, lint, formatação, testes e build de produção.
São **296 testes aprovados**: 179 da API e 117 da interface, 20 novos neste lote.
Os testes incluem concorrência de avaliações, cancelamentos,
migrações em schema vazio com pools independentes, rollback e liberação de trava após
falha, repetição limitada de transações e preservação de endereço.
`git diff --check` também passou. O lint não tem erros; mantém nove avisos na
interface e seus testes, relativos a dependências de efeitos/refs e duas asserções
de tipo desnecessárias, para revisão no próximo trabalho de frontend.

Os testes usam schemas temporários isolados. Nenhum reset ou seed foi executado sobre
o banco de desenvolvimento. As regras não alteram retroativamente os estados dos
pedidos existentes. Pagamentos e frete continuam simulados; não houve publicação.

### Limitações e próximos lotes

1. Completar snapshots de histórico e trilha de estoque; revisar chamadas externas, imagens e os demais ADRs.
2. Definir persistência do carrinho por conta ou navegador e recuperação de checkout após recarregar a página; normalizar quantidades salvas (WEB-15).
3. Construir administração mínima, conectar cupons e dados reais de mais vendidos.
4. Acessibilidade dos cards e diálogos, revisão visual, ADRs restantes e publicação.

O painel, a entrega de e-mail, o upload e o deploy público continuam pendentes. A recuperação
local é uma ferramenta de demonstração e exige manter o ambiente inacessível a terceiros.
