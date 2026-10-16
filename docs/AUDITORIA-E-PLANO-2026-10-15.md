# Auditoria e plano de evolução — Loja Tech

Data: 15/10/2026. Objetivo informado: portfólio para conseguir vaga full-stack.

Este documento registra o diagnóstico anterior às correções. O andamento da implementação
está em [PROGRESSO-DAS-CORRECOES.md](<C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/docs/PROGRESSO-DAS-CORRECOES.md>).

## Parecer

O projeto merece ser aproveitado. React, Vite, Fastify, PostgreSQL e Zod atendem ao escopo atual. Os problemas mais relevantes estão nas regras de negócio, na coordenação de operações assíncronas, na reprodução do ambiente e em funcionalidades incompletas. Uma troca de framework, por si só, preservaria esses defeitos.

A proposta é uma reforma em etapas, com possibilidade de reconstruir partes do frontend. Recomeçar todo o projeto só passa a ser recomendável se houver um objetivo adicional de aprendizagem ou uma necessidade de produto que a arquitetura atual não atenda.

O diferencial para o portfólio deve ser uma aplicação publicada, utilizável e explicável: compra consistente, conta isolada, administração funcional, testes relevantes e decisões técnicas sustentadas por evidências.

## Escopo e método

Foram inspecionados os fontes, componentes, hooks, estilos, contratos compartilhados, SQL, migrações, testes, scripts, configurações, Docker, README e ADRs. A revisão considerou o estado atual dos arquivos, incluindo alterações locais ainda não commitadas. Dependências instaladas e arquivos gerados não foram tratados como código autoral; o lockfile foi conferido quanto à coerência dos pacotes.

Nenhum arquivo da aplicação foi corrigido nesta auditoria. Este documento é a entrega de planejamento. Compilações e relatórios temporários foram gerados nos diretórios ignorados. As reproduções de dados criaram um schema exclusivo no PostgreSQL local e o removeram ao terminar; não usaram as tabelas do schema de desenvolvimento.

Classificação de evidência:

- **R — reproduzido:** observado executando verificações, requisições ou cenários isolados.
- **L — leitura:** comportamento identificado diretamente no fluxo do código, sem reprodução em navegador.
- **C — concorrência:** interleaving possível pela implementação; precisa de teste controlado antes da correção ser considerada concluída.
- **D — decisão/dívida:** limitação ou escolha a definir, sem implicar necessariamente um bug.

Prioridades: **P1** compromete integridade, isolamento, segurança ou a entrega principal; **P2** deve ser corrigido para concluir o portfólio; **P3** é manutenção ou refinamento posterior. Prioridade não é uma classificação formal de vulnerabilidade.

Não foi realizada uma sessão completa de testes visuais em navegador, auditoria de vulnerabilidades de dependências, teste de carga, build da imagem Docker ou validação de deploy público. Portanto, o inventário é abrangente para o código disponível, mas não uma garantia de ausência de outros defeitos.

## Resultado das verificações

| Verificação | Resultado | Interpretação |
| --- | --- | --- |
| Compilação de produção | Passou | Shared, API e frontend compilam no ambiente instalado. |
| Checagem de tipos | Passou | Não garante coerência das regras de negócio. |
| Linter | Passou | Há regras relevantes desabilitadas globalmente. |
| Formatação | Falhou | Um arquivo: `useCarrinho.ts`. |
| Testes web | 88 passaram, 0 falharam | Executados com Vitest 3.2.7 instalado, apesar de o manifesto pedir 5. |
| Testes API | 119 passaram, 1 falhou, 120 no total | Falha no teste de persistência entre instâncias, detalhada em AMB-02. |
| Árvore de dependências | Falhou: `ELSPROBLEMS` | TypeScript, Vitest, jsdom e jest-dom instalados não satisfazem alguns manifestos. |
| Simulação offline de instalação limpa | Inconclusiva | Sem metadados em cache (`ENOTCACHED`); não foi feita instalação nem alterado o lockfile. |

O primeiro teste da API foi bloqueado pelo acesso restrito ao PostgreSQL. A repetição com acesso local permitido produziu o resultado acima. O erro de permissão inicial não foi classificado como bug da aplicação.

### Reproduções isoladas mais importantes

| Cenário | Resultado observado |
| --- | --- |
| Inativar produto e comprar pelo ID | Pedido criado em `processando`. |
| Comprar única unidade, cancelar, revender e reativar primeiro pedido | Dois pedidos ativos para uma unidade; estoque zero. Cancelar novamente criou saldo de uma unidade. |
| Dashboard com R$ 60 de receita, 3 pedidos, sendo 2 ativos | Ticket informado R$ 20; média dos pedidos ativos R$ 30. |
| Comprar teclado e reexecutar seed | Estoque voltou de 14 para 15, com pedido preservado. |
| Enviar duas vezes a mesma compra | Dois IDs de pedido diferentes. |
| Redefinir senha e consultar sessão anterior | Sessão antiga continuou válida. |
| Produto de R$ 100.000 × 999 unidades | PostgreSQL recusou 9.990.000.000 centavos com código `22003`. |
| 122 requisições com IP fixo / alternando `X-Forwarded-For` | 2 respostas 429 com IP fixo; nenhuma ao alternar cabeçalho em configuração de produção. |

## Inventário de inconsistências

### Ambiente, ferramentas e verificações

| ID | Prioridade/evidência | Inconsistência, consequência e direção da correção |
| --- | --- | --- |
| AMB-01 | P1 / R+L | **Manifestos, lockfile e instalação divergem.** Raiz declara TypeScript `^7.0.2`, lockfile registra `^5.6.3` e a instalação resolve 5.9.3. Web declara Vitest 5/jsdom 30/jest-dom 7, mas resolve 3.2.7/25.0.1/6.9.1. A checagem local passa usando uma combinação diferente da declarada. Alinhar versões e lockfile, depois comprovar instalação limpa. [Manifesto][package], [lockfile][lock]. |
| AMB-02 | P1 / R+L | **Teste apaga a sessão que tenta preservar.** `iniciarContexto()` chama `limparSessoes()` sem aguardar; o teste de persistência chama esse helper para a segunda instância. Falha observada: usuário retornou nulo. Separar criação do app de limpeza de dados e sempre aguardar limpeza. [Helper][ajuda44], [teste][teste669]. |
| AMB-03 | P3 / R | **Formatação fora do padrão.** Corrigir em etapa de saneamento, sem misturar com regras de negócio. [Carrinho][carrinho74]. |
| AMB-04 | P2 / L | **Depuração aponta para a estrutura antiga.** `webRoot` usa a pasta raiz `src`; API tenta executar `src/server.ts` com diretório da raiz, mas o arquivo está em `apps/api/src`. A configuração de testes executa Vitest na raiz, sem as configurações dos workspaces. Corrigir caminhos e diretórios. [Configuração de depuração][debug]. |
| AMB-05 | P2 / L | **Variável do proxy não acompanha o `.env` documentado.** Vite lê `process.env.VITE_API_URL` ao avaliar sua configuração; não há carregamento explícito do `.env` da raiz. Definir no arquivo conforme o README não é equivalente a exportá-la no processo. Centralizar o carregamento do ambiente do frontend. [Vite][vite]. |
| AMB-06 | P2 / L+D | **Verificação automatizada incompleta.** Não há pipeline CI; hooks locais não garantem execução por todos. `verify` não inclui formatação/build; cobertura tem limites zero; testes web emitem avisos de atualização fora de `act`. Há testes de recuperação cujos títulos prometem ocultação/não enumeração, mas as asserções não conferem a presença do campo `token`. Acrescentar checks que provem as propriedades anunciadas, sem perseguir cobertura percentual artificial. [Scripts][package], [Vitest API][vitestapi], [hooks][prepush], [teste de recuperação][teste585]. |

### Autenticação, segurança e operação

| ID | Prioridade/evidência | Inconsistência, consequência e direção da correção |
| --- | --- | --- |
| SEG-01 | P1 condicional / L | **Token de recuperação exposto fora de produção por padrão.** `NODE_ENV !== 'production'` inclui ambiente ausente ou digitado incorretamente. Se publicado assim, uma pessoa pode pedir o token e redefinir a senha de um e-mail conhecido. Exigir configuração válida e flag explícita, restrita ao desenvolvimento local, para qualquer exposição. [Recuperação][auth157], [configuração][config]. |
| SEG-02 | P1 / L | **Recuperação não entrega instruções em produção.** Token é gerado e ocultado, mas nenhum serviço envia e-mail. Em desenvolvimento o frontend também descarta o token. Implementar um canal verificável ou apresentar honestamente a indisponibilidade no modo demonstrativo. [Rota][auth151], [frontend][app367]. |
| SEG-03 | P1 condicional / R+L | **IP falsificado pode contornar o limitador.** Produção habilita confiança irrestrita em proxy; Docker publica a API diretamente. Um cliente pode alternar `X-Forwarded-For`. Definir proxies confiáveis conforme a implantação ou desabilitar essa confiança quando a exposição for direta. [Fastify][app99], [Compose][compose]. |
| SEG-04 | P1 condicional / L | **Guarda do reset valida substring, não o host.** Uma URL remota com `localhost` no usuário/senha/nome passa e o comando apaga `public`. Validar hostname e destino explicitamente. O reset não foi executado nesta auditoria. [Reset][reset22]. |
| SEG-05 | P1 / R | **Recuperar senha não revoga sessões existentes.** O cookie antigo continua autenticando após a troca de senha. Invalidar sessões na mesma transação e definir a política de reautenticação. [Redefinição][db70]. |
| SEG-06 | P2 / C | **Token de uso único não é consumido atomicamente.** Duas requisições podem ler o token antes de sua exclusão e ambas alterar a senha. Consumir com bloqueio ou `DELETE ... RETURNING`, junto da alteração de senha. [Redefinição][db70]. |
| SEG-07 | P2 / C | **Política de sessão única não é garantida.** `DELETE` seguido de `INSERT`, sem trava por usuário/restrição apropriada, permite logins concorrentes criarem múltiplas sessões. Definir se múltiplos dispositivos são permitidos e garantir a política escolhida. [Criação de sessão][db104]. |
| SEG-08 | P2 / L | **TLS ignora autenticidade do certificado.** `rejectUnauthorized: false` desliga a validação quando SSL é usado. Configurar verificação adequada para o provedor e validar as opções de ambiente. [Pool][pg55]. |
| SEG-09 | P2 / L | **Compose de produção oferece senha administrativa conhecida como fallback.** Isso conflita com o README, que exige senha própria. Separar modo local demonstrativo de configuração de produção. O seed também imprime sempre a senha de exemplo, mesmo quando outra foi configurada. [Compose][compose], [seed][seed295]. |
| SEG-10 | P2 / L | **Chamadas externas sem timeout/cancelamento da aplicação.** CEP e geocodificação dependem do tempo de resposta dos provedores; geocodificação não tem controle específico de rajadas. Definir timeout, cancelamento, cache e limites conforme o serviço escolhido. [Localização][localizacao]. |
| SEG-11 | P2 / C | **Migrações executadas no boot sem exclusão mútua.** Duas instâncias podem ler a mesma lista de pendências e competir pela aplicação/registro. Antes de implantar múltiplas instâncias, usar execução única no deploy ou trava de migração. [Migrações][pg104]. |
| SEG-12 | P2 / R+L | **Imagens externas permitidas no cadastro são bloqueadas pela política de produção.** O schema aceita HTTP/HTTPS, mas o cabeçalho CSP efetivamente gerado contém `img-src 'self' data:`. Alinhar formatos aceitos, hospedagem das imagens e política de segurança; acrescentar uma verificação em navegador no modo de produção. [Política][app112], [schema][schemas117]. |
| SEG-13 | P3 / L | **Migração de senha antiga é inalcançável.** Login promete atualizar formato legado depois da autenticação, mas `verificarSenha()` rejeita qualquer formato sem `scrypt$` antes disso. Remover a promessa/código obsoleto ou implementar uma migração se contas antigas forem requisito. [Login][auth99], [verificação][db36]. |

### Pedidos, estoque, dinheiro e contratos

| ID | Prioridade/evidência | Inconsistência, consequência e direção da correção |
| --- | --- | --- |
| DOM-01 | P1 / R | **Reativação permite vender sem estoque e criar saldo fictício.** `GREATEST(0, quantidade - n)` encobre a insuficiência. Definir transições permitidas; qualquer reserva deve validar e debitar atomicamente todas as unidades ou rejeitar a operação. [Status][db804]. |
| DOM-02 | P1 / R | **Compra repetida cria pedidos duplicados.** Não há chave de idempotência. Retry após timeout pode debitar novamente o estoque. Associar chave à intenção de compra e devolver o mesmo resultado nas repetições. [Rota][pedidos], [criação][db597]. |
| DOM-03 | P1 / R | **Seed altera dados de uma loja já utilizada.** Reexecução sobrescreve estoque, preço, nome e outras edições dos produtos de demonstração. Separar inicialização essencial, inclusão de amostras e restauração explicitamente destrutiva de cenário. [Seed][seed194]. |
| DOM-04 | P2 / R | **Produto inativo continua comprável pelo ID.** Consulta de estoque não verifica `ativo`. Verificar disponibilidade comercial dentro da mesma transação da compra. [Checkout][db597]. |
| DOM-05 | P2 / C | **Ordem dos itens permite deadlock.** Carrinhos `[A,B]` e `[B,A]` bloqueiam produtos em ordem inversa. Ordenar/agrupar IDs antes de bloquear e tratar falhas transitórias conscientemente. [Checkout][db597], [transações][pgtransacao]. |
| DOM-06 | P2 / R+L | **Limites monetários incompatíveis com o banco.** Preço e estoque aceitam números acima de `INTEGER`; mesmo um preço armazenável pode produzir total fora da faixa. Definir teto de produto/quantidade/total, precisão de entrada e armazenamento adequado. O limite JavaScript `2^53` descrito no ADR não é o limite das colunas atuais. [Schemas][schemas117], [SQL][sql001], [ADR monetário][adr004]. |
| DOM-07 | P2 / R | **Ticket médio usa denominador diferente da receita.** Cancelados entram na contagem, mas não na receita. Especificar o indicador e usar o mesmo conjunto de pedidos em ambos. [Dashboard][db824]. |
| DOM-08 | P2 / L | **Cupons anunciados e utilizáveis divergem.** Listagem ignora limite de uso e não expõe o desconto fixo necessário para representar todos os tipos. Unificar a elegibilidade e completar o contrato. [Cupons][db497], [resposta da listagem][catalogo75]. |
| DOM-09 | P2 / C | **Permissão de avaliação e gravação estão separadas.** Duas requisições podem passar pela mesma permissão antes do `UPSERT`. Garantir elegibilidade e atualização na mesma operação/transação. [Rota][catalogo150], [gravação][db976]. |
| DOM-10 | P2 / R+L | **Erro de saída é atribuído ao cliente.** Qualquer `ZodError` vira 400, inclusive erro nos schemas de resposta. O mecanismo foi reproduzido com um handler temporário, em memória, chamando um schema de resposta com dados inválidos; não foi observada uma saída inválida espontânea de uma rota real. Distinguir entrada inválida de bug interno de serialização; resposta inválida deve ser observável como falha do servidor. [Tratador][app158], [contratos de saída][respostas]. |
| DOM-11 | P3 / L | **Contrato compartilhado tem definições sobrepostas.** Produto, sessão e pagamento aceitam formatos diferentes entre modelos e respostas. UF valida somente comprimento, aceitando números e siglas inexistentes, como `12`/`XX`. Consolidar o domínio e definir entradas/saídas derivadas intencionalmente. [Schemas][schemas], [respostas][respostas]. |
| DOM-12 | P2 / D | **Ciclo de pedido ainda precisa de definição.** A API permite saltos entre quaisquer status, não exige endereço completo e sempre aprova pagamento no modo demonstrativo. Definir explicitamente estados, pré-condições de entrega e o comportamento da simulação. A ausência de gateway real, já declarada, não é por si um bug. [Criação][db651], [status][db762]. |
| DOM-13 | P3 / D | **Histórico não é totalmente imutável.** Itens usam o nome atual do produto; métricas usam sua categoria atual; pedido não vincula o cupom aplicado; movimentos não cobrem compras/cancelamentos. Avaliar snapshots e trilha de estoque para tornar histórico e relatórios explicáveis. [Histórico][db712], [movimentos administrativos][db462]. |

### Frontend e experiência de uso

| ID | Prioridade/evidência | Inconsistência, consequência e direção da correção |
| --- | --- | --- |
| WEB-01 | P1 / L | **Resposta de conta pode atravessar troca de usuário.** Resposta atrasada de A é aplicada depois de logout/login B, mostrando dados anteriores na interface de B. Cancelar/versionar requisições e vincular estado ao usuário que as iniciou. Isso é isolamento de estado no navegador; não foi identificado acesso de B à conta A pelo servidor. [Carregamento de conta][app101], [logout][app383]. |
| WEB-02 | P1 / L | **Resposta de checkout pode apagar mudanças recentes no carrinho.** Voltar durante a confirmação, adicionar B e receber a resposta usa um setter capturado antes do `await`. Atualização funcional precisa trabalhar com o estado atual; definir comportamento enquanto o pedido está pendente. [Setter][carrinho89], [checkout][app203], [resumo][summary]. |
| WEB-03 | P2 / L | **Inicialização e expiração de sessão não são coordenadas.** `/sessao` atrasada pode apagar login recente; carregamento inicial é ignorado; 401 não invalida usuário global. Definir estados de autenticação e tratamento central da expiração. [Hook][useauth], [cliente HTTP][apiweb], [App][app29]. |
| WEB-04 | P2 / L | **Endereço chega após a inicialização dos campos.** Abrir conta antes da resposta cria campos vazios que não acompanham o perfil posterior. Geolocalização pode preencher endereço diferente do salvo. Separar carregamento, rascunho editável e sugestão; preservar alterações feitas pela pessoa. [Conta][account48]. |
| WEB-05 | P2 / L | **Link de reset não abre o formulário e token permanece na URL.** `telaLogin` inicia falso; apenas `LoginPage` interpreta a query. Após uso/fechamento ela continua na URL. Criar entrada de rota específica e remover token do endereço depois de consumi-lo. [App][app35], [login][login34]. |
| WEB-06 | P2 / L | **Respostas de avaliações podem aparecer em outro produto.** A e B usam o mesmo estado sem conferir o ID vigente. Vincular consulta ao produto e ignorar respostas ultrapassadas. [Avaliações][app88]. |
| WEB-07 | P2 / L | **Avaliação direta não atualiza a elegibilidade.** O modal do produto recarrega só a lista pública, mantendo permissão antiga; ainda faz GET duplicado. Se POST passa e GET falha, pode comunicar falha no envio já salvo. Unificar pós-gravação e fonte de elegibilidade. [App][app145], [modal][productmodal43]. |
| WEB-08 | P2 / L | **Rollback de favorito desfaz outra operação bem-sucedida.** A falha de A restaura um snapshot integral e remove B da tela. Aplicar reversão por item/operação e definir ordenação por produto. [Favoritos][favoritos62]. |
| WEB-09 | P2 / L | **Carrinho guarda seleção de item removido.** Selecionar A e removê-lo deixa ID órfão: quantidade selecionada errada, total zero e compra sem efeito. Derivar seleção apenas dos IDs ainda existentes. [Painel][cartpanel]. |
| WEB-10 | P2 / L | **Exigência de login varia por botão.** Vitrine pede login para adicionar; modal adiciona diretamente. Escolher se carrinho anônimo é permitido e aplicar uma regra única. O servidor continua exigindo sessão no checkout. [Vitrine][app285], [modal][app669]. |
| WEB-11 | P2 / L | **Erro de catálogo parece catálogo vazio.** O hook registra erro, mas o App ignora e informa que nenhum produto foi encontrado. Exibir erro específico e permitir nova tentativa. [Hook][products], [App][app550]. |
| WEB-12 | P2 / L | **Cards e modais não atendem bem ao teclado.** Cards clicáveis usam `article` sem interação equivalente; modais não têm gestão de foco, restauração, Escape ou isolamento do fundo. Usar elementos semânticos e um componente de diálogo consistente. [Card][productcard], [modal][productmodal54], [painel][cartpanel]. |
| WEB-13 | P2 / L | **“Mais vendidos” usa posição do catálogo.** Destaque usa `produtos.slice(0, 3)`, apesar de existir endpoint de vendas. Consumir o indicador real ou mudar o rótulo. [Agrupamento][app67]. |
| WEB-14 | P2 / D | **Recursos existem só parcialmente entre API e tela.** Sem painel administrativo; hook de cupom sem consumidor; cupom fixo em `Nenhum`; só PIX na interface. Definir MVP e concluir os fluxos que serão demonstrados. Não há redirecionamento ativo para `admin.html` no estado atual. [Checkout][app327], [login admin][app346]. |
| WEB-15 | P3 / L+D | **Persistência do carrinho é permissiva e global.** Quantidade salva pode ser fracionária, acima do estoque, ou repetir IDs; chave não considera usuário e logout não limpa carrinho. Normalizar persistência, reconciliar catálogo e decidir se carrinho é por navegador ou por conta. [Hook][carrinho19], [logout][app383]. |
| WEB-16 | P3 / L | **Ações sem estoque não explicam resultado.** Botões seguem ativos; hook ignora adição e modal fecha. Também há duas cargas de conta no login/cadastro. Comunicar indisponibilidade e remover consultas redundantes. [Hook][carrinho52], [modal][productmodal134], [login][app346]. |

### Estilos, documentação e arquitetura

| ID | Prioridade/evidência | Inconsistência, consequência e direção da correção |
| --- | --- | --- |
| DOC-01 | P2 / L | **README não descreve mais o projeto atual.** Informa 94 testes API/5 web, redirecionamento admin já removido e limitações antigas; clone ainda tem placeholder. O modo Docker sobe API além do banco, embora o fluxo local descreva dois processos separados. Reescrever e testar instruções em ambiente limpo. [README][readme], [Compose][compose]. |
| DOC-02 | P2 / L | **ADRs misturam histórico, afirmações incorretas e implementação.** ADR 002 promete type provider Zod que não está instalado; ADR 003 atribui versões divergentes necessariamente ao npm; ADR 005 nega recursos existentes do SQLite e generaliza restrição de TCP/serverless; ADR 006 contém números de planos sem verificação atual. Corrigir fundamentos e registrar o que realmente foi adotado. Fontes verificadas abaixo. [ADRs][adrs]. |
| DOC-03 | P2 / D | **Hospedagem proposta não virou arquitetura de deploy.** Existe processo Node/Docker e acesso `pg`; não há configuração/pipeline demonstrando o caminho Vercel proposto. Escolher um alvo compatível e provar o deploy, sem converter a API inteira só por uma premissa antiga de documentação. [Servidor][server], [Docker][docker], [ADR de deploy][adr006]. |
| DOC-04 | P3 / L | **CSS acumula layouts antigos e conflitos.** Aproximadamente 2,7 mil linhas, resets repetidos, seletores antigos sem consumidores e `--success` usada sem definição. Há conflito de especificidade no botão Adicionar no tema escuro. Limpar com comparação visual e não apenas exclusão por busca de texto. [Estilos][styles]. |
| DOC-05 | P3 / D | **Arquivos concentram responsabilidades.** App coordena conta, sessão, catálogo, avaliações e checkout; camada de dados concentra mais de mil linhas; CSS é global. Separar por domínio/feature depois de fixar os contratos, sem criar camadas sem uso. [App][app29], [dados][database], [estilos][styles]. |

Pontos que exigem validação visual adicional: contraste dos temas, altura/rolagem dos diálogos em telas baixas, uso por teclado e estados de loading/erro em dispositivos móveis. Não foram classificados como defeitos visualmente reproduzidos.

## O que preservar

- Estrutura de workspaces e pacote compartilhado de contratos.
- PostgreSQL e migrações SQL existentes; mudanças futuras entram em novas migrações.
- Dinheiro em centavos no banco e recálculo de preços no servidor, ajustando os limites e as fronteiras.
- Autorização administrativa no backend, SQL parametrizado, cookies HttpOnly e tokens aleatórios com hash no banco.
- Transações e bloqueios de estoque/cupom já existentes; corrigir as lacunas de regra e concorrência.
- Testes úteis de imagens, favoritos, carrinho, logout, contrato HTTP e avaliação pós-compra.
- Separação inicial de componentes e hooks; imagens locais e identidade visual podem ser mantidas.

## Decisão sobre frameworks

| Caminho | Quando faz sentido | Custo/risco | Parecer |
| --- | --- | --- | --- |
| Evoluir React + Vite + Fastify + PostgreSQL | Concluir um portfólio full-stack com API explícita e regras demonstráveis | Menor retrabalho; exige organizar o estado e os domínios | **Recomendado agora.** |
| Reconstruir frontend com Next.js, preservando domínio/banco/API conforme necessidade | Quando páginas próprias, renderização no servidor e catálogo indexável forem requisitos centrais | Migração de navegação, autenticação e fronteiras de execução | Alternativa válida, depois de definir esses requisitos. |
| Migrar backend para NestJS | Quando praticar Nest e sua organização for um objetivo explícito, por exemplo para vagas que você esteja mirando | Converter estrutura e testes; o domínio defeituoso continua precisando ser corrigido | Decisão de aprendizagem, sem necessidade técnica demonstrada nesta auditoria. |
| Reescrever tudo | Mudança substancial de produto ou exercício deliberado de reconstrução | Maior risco de regressão, perda de testes e adiamento da publicação | Não recomendado como primeira ação. |

Essa recomendação é uma avaliação do código e do objetivo informado, não uma afirmação sobre demanda de mercado. Next.js oferece componentes de servidor/cliente; Nest permite validação com Zod. As premissas antigas de que Nest obrigaria dois sistemas de validação ou de que todo serverless proibiria `pg` não devem orientar a decisão. [Next.js](https://nextjs.org/docs/app/getting-started/server-and-client-components), [NestJS](https://docs.nestjs.com/pipes), [Neon com Node](https://neon.com/docs/guides/node).

Uma melhoria de navegação, gestão de consultas ou diálogos não exige automaticamente substituir o framework. Bibliotecas adicionais só entram para resolver problemas escolhidos e com custo compreendido.

## Plano para realizarmos juntos

### Etapa 0 — Definir a entrega e preservar o trabalho

Objetivo: combinar uma demonstração que caiba no portfólio e guardar o estado atual antes de alterações grandes.

Entregas: registrar o que já está modificado; criar um marco recuperável quando iniciarmos a implementação; decidir regras de carrinho anônimo/por conta, endereço obrigatório, pagamento demonstrativo, sessão por dispositivo, transições de pedido e funções mínimas de administração. Confirmar orçamento/restrições de hospedagem em vez de assumir que ADRs antigos continuam válidos.

Critério de conclusão: roteiro de demonstração aprovado com cadastro/login, produto, carrinho, compra, pedido na conta e administração. Uma única direção de arquitetura escolhida.

### Etapa 1 — Tornar o ambiente e os checks confiáveis

Escopo: AMB-01 a AMB-06; primeiro consertar o helper de sessão e alinhar manifestos/lockfile. Corrigir depuração, ambiente do Vite, formatação e instruções de instalação.

Critérios de conclusão:

- Instalação limpa reprodutível e árvore de dependências sem versões inválidas.
- Build, tipos, lint, formatação e os 208 testes atuais aprovados após a correção legítima do teste.
- CI executando checks com PostgreSQL isolado; comandos documentados conferidos.
- Nenhuma mudança de comportamento introduzida apenas para fazer uma asserção passar.

### Etapa 2 — Corrigir integridade e autenticação

Escopo: reativação/estoque, produto inativo, idempotência, seed, limites de dinheiro, reset seguro, recuperação de senha, revogação/consumo de token e confiança em proxy. Corrigir média do dashboard e elegibilidade de cupons. Definir concorrência de sessão/avaliação e exercitá-la com testes controlados.

Critérios de conclusão:

- A última unidade não pode sustentar dois pedidos ativos.
- Uma intenção de compra repetida devolve o mesmo pedido, sem novo débito.
- Produto inativo não vende; seed não repõe estoque usado sem ação explícita.
- Token só pode redefinir uma vez, inclusive em paralelo; sessões antigas são revogadas conforme política.
- Recuperação funcional demonstrada de ponta a ponta com canal seguro; alternativamente, se ficar fora do MVP, indisponibilidade apresentada explicitamente sem prometer envio. Ambiente mal configurado não expõe token por padrão.
- Valores aceitos pela API cabem no armazenamento; entradas fora da faixa recebem erro claro.
- Testes de regressão para cada falha reproduzida, com transações e migrações preservadas.

### Etapa 3 — Coordenar frontend e fechar os fluxos do cliente

Escopo: WEB-01 a WEB-11 e WEB-15/16. Dar identidade às consultas de conta/produto, impedir respostas antigas de substituir estado atual, tornar o carrinho consistente durante checkout e definir estados explícitos de autenticação/carregamento/erro.

Critérios de conclusão:

- Logout/login de outra conta com requisições pendentes nunca mostra dados da conta anterior.
- Resposta atrasada de produto A não altera B.
- Compra pendente não apaga produto acrescentado depois; timeout pode ser repetido com segurança.
- Endereço salvo aparece mesmo chegando após a abertura da conta; edição não é sobrescrita por sugestão.
- Link de reset abre o fluxo correto; token é retirado da URL após consumo.
- Falha de catálogo, sessão expirada, estoque insuficiente e envio parcial de avaliações têm mensagens e ações coerentes.

### Etapa 4 — Completar a demonstração full-stack

Escopo: construir painel mínimo de produtos/pedidos/estoque; conectar cupons; consumir dados reais de mais vendidos; concluir conta e histórico. Organizar código por catálogo, conta, checkout e administração. Definir documentação HTTP verificável, preferencialmente OpenAPI, sem manter uma segunda lista manual divergente.

Critério de conclusão: demonstrar uma edição administrativa refletida na loja, um pedido do cliente gerenciado no painel e regras de autorização preservadas. Pagamento/frete podem continuar simulados, com apresentação explícita. E-mail/upload reais entram somente se fizerem parte do MVP combinado.

### Etapa 5 — Acessibilidade, visual e publicação

Escopo: diálogos e cards por teclado, foco, responsividade, temas e limpeza de CSS com verificação visual. Corrigir README/ADRs. Configurar ambiente publicado, migrações, TLS, logs e uma checagem de saúde compatíveis com o alvo escolhido.

Critérios de conclusão:

- Fluxos principais navegáveis pelo teclado e usáveis em celular/tela baixa.
- Teste em navegador real de cadastro/login → compra → conta e administração; cenários de erro relevantes também exercitados.
- Link público funcional, configuração de produção conferida e instruções de execução reproduzíveis.
- README com objetivo, arquitetura real, limitações honestas, demonstração e explicação das decisões.

### Como conduzir cada etapa

Trabalhar por mudança pequena: explicar o defeito e o comportamento esperado, escolher a solução juntos, implementar, demonstrar o teste que a sustenta e revisar antes de avançar. Podemos alternar trechos que você implementa com trechos que eu preparo para revisão. O progresso será medido por fluxo completo e evidência, não por quantidade de ferramentas adotadas.

Não há estimativa fechada em horas: ela dependeria do ritmo de estudo, do escopo do painel e da decisão de hospedagem. A ordem acima permite entregar valor sem esperar uma reescrita inteira terminar.

## Fontes verificadas para corrigir as decisões técnicas

- SQLite possui [índices parciais](https://www.sqlite.org/partialindex.html), [window functions](https://www.sqlite.org/windowfunctions.html) e [UPSERT](https://www.sqlite.org/lang_upsert.html). Isso não invalida escolher PostgreSQL; invalida essas justificativas específicas do ADR 005.
- npm possui [cache endereçado por conteúdo](https://docs.npmjs.com/cli/v11/commands/npm-cache/). Isso é diferente do modelo de instalação do pnpm e não garante deduplicação da árvore. A divergência concreta aqui está nos manifestos/lockfile/instalação; não é uma consequência inevitável de usar npm workspaces.
- [`npm ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci/) exige coerência entre manifesto e lockfile. O build no ambiente instalado não substitui essa comprovação em instalação limpa.
- Neon documenta [uso com clientes Node](https://neon.com/docs/guides/node) e [pool de conexões](https://neon.com/docs/connect/connection-pooling). A decisão entre TCP, pooler, HTTP e WebSocket depende do ambiente; a proibição geral escrita nos ADRs precisa ser removida.
- Nest documenta [pipe de validação com Zod](https://docs.nestjs.com/pipes). O framework não obriga o uso exclusivo de class-validator.
- Next.js documenta [componentes de servidor e cliente](https://nextjs.org/docs/app/getting-started/server-and-client-components). São capacidades a escolher por requisito, sem necessidade de migrar para corrigir os defeitos listados.

Os preços e limites de hospedagem do ADR 006 não foram revalidados nesta auditoria; não devem ser tomados como proposta atual de contratação.

[package]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/package.json:1>
[lock]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/package-lock.json:1>
[ajuda44]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/testes/ajuda.ts:44>
[teste669]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/testes/api.test.ts:669>
[carrinho74]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/hooks/useCarrinho.ts:74>
[debug]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/.vscode/launch.json:15>
[vite]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/vite.config.ts:4>
[vitestapi]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/vitest.config.ts:30>
[prepush]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/.husky/pre-push:1>
[auth157]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/rotas/auth.ts:157>
[config]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/config.ts:14>
[auth151]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/rotas/auth.ts:151>
[app367]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:367>
[app99]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/app.ts:99>
[compose]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/docker-compose.yml:21>
[reset22]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/resetar.ts:22>
[db70]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:70>
[db104]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:104>
[pg55]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/postgres.ts:55>
[seed295]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/seed.ts:295>
[localizacao]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/rotas/localizacao.ts:42>
[pg104]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/postgres.ts:104>
[db804]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:804>
[pedidos]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/rotas/pedidos.ts:28>
[db597]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:597>
[seed194]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/seed.ts:194>
[pgtransacao]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/postgres.ts:74>
[schemas117]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/packages/shared/src/schemas.ts:117>
[sql001]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/database/migrations/001_inicial.sql:1>
[adr004]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/docs/adr/004-dinheiro-em-centavos.md:1>
[db824]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:824>
[db497]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:497>
[catalogo75]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/rotas/catalogo.ts:75>
[catalogo150]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/rotas/catalogo.ts:150>
[db976]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:976>
[app158]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/app.ts:158>
[respostas]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/packages/shared/src/respostas.ts:16>
[schemas]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/packages/shared/src/schemas.ts:1>
[db651]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:651>
[db762]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:762>
[db712]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:712>
[db462]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:462>
[app101]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:101>
[app383]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:383>
[carrinho89]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/hooks/useCarrinho.ts:89>
[app203]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:203>
[summary]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/components/PaymentSummary.tsx:23>
[useauth]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/hooks/useAuth.ts:9>
[apiweb]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/lib/api.ts:25>
[app29]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:29>
[account48]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/components/AccountModal.tsx:48>
[app35]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:35>
[login34]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/components/LoginPage.tsx:34>
[app88]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:88>
[app145]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:145>
[productmodal43]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/components/ProductModal.tsx:43>
[favoritos62]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/hooks/useFavoritos.ts:62>
[cartpanel]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/components/CartPanel.tsx:23>
[app285]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:285>
[app669]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:669>
[products]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/hooks/useProducts.ts:25>
[app550]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:550>
[productcard]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/components/ProductCard.tsx:24>
[productmodal54]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/components/ProductModal.tsx:54>
[app67]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:67>
[app327]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:327>
[app346]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/App.tsx:346>
[carrinho19]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/hooks/useCarrinho.ts:19>
[carrinho52]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/hooks/useCarrinho.ts:52>
[productmodal134]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/components/ProductModal.tsx:134>
[readme]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/README.md:256>
[adrs]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/docs/adr/README.md:1>
[server]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/server.ts:16>
[docker]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/Dockerfile:1>
[adr006]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/docs/adr/006-deploy-vercel-neon.md:1>
[styles]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/web/src/styles.css:910>
[database]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:1>
[teste585]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/testes/api.test.ts:585>
[app112]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/app.ts:112>
[auth99]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/rotas/auth.ts:99>
[db36]: <C:/Users/DELL/Desktop/Estudos/TypeScript/Projeto - FullStack/apps/api/src/database.ts:36>
