import { useCallback, useEffect, useMemo, useState } from "react";
import { LogOut } from "lucide-react";
import type { AvaliacaoResponse, CepResponse, Conta, ProdutoResponse } from "@loja/shared";
import { useAuth } from "./hooks/useAuth.js";
import { useCarrinho } from "./hooks/useCarrinho.js";
import { useDebounce } from "./hooks/useDebounce.js";
import { useFavoritos } from "./hooks/useFavoritos.js";
import { useLocalizacao } from "./hooks/useLocalizacao.js";
import { useProducts } from "./hooks/useProducts.js";
import { useRecentes } from "./hooks/useRecentes.js";
import { useTema } from "./hooks/useTema.js";
import { api } from "./lib/api.js";
import { formatarMoeda, normalizar, podeAvaliar } from "./lib/utils.js";
import { Header } from "./components/Header.js";
import { ProductCard } from "./components/ProductCard.js";
import { CartPanel } from "./components/CartPanel.js";
import { LoginPage } from "./components/LoginPage.js";
import { LoginPromptModal } from "./components/LoginPromptModal.js";
import { AvaliarCompraModal, type AvaliacaoPendente, type NotaEnviada } from "./components/AvaliarCompraModal.js";
import { ProductModal } from "./components/ProductModal.js";
import { AccountModal } from "./components/AccountModal.js";
import { PaymentSummary } from "./components/PaymentSummary.js";
import { Toast } from "./components/Toast.js";

type Produto = ProdutoResponse;
// Tipos inline removidos - agora usam tipos nomeados do shared.

export default function App() {
  const { usuario, login, cadastrar, logout } = useAuth();
  const { produtos, carregando, recarregar } = useProducts();
  const { carrinho, setCarrinho, adicionarAoCarrinho, alterarQuantidade, limparCarrinho, quantidadeCarrinho } =
    useCarrinho();
  const { tema, setTema } = useTema();
  const { recentes, adicionarRecente } = useRecentes();
  const [telaLogin, setTelaLogin] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const { favoritos, alternarFavorito, setFavoritos } = useFavoritos({ usuarioLogado: !!usuario, onErro: setMensagem });
  const { detectarEndereco } = useLocalizacao({ usuarioLogado: !!usuario });
  const [enderecoSugerido, setEnderecoSugerido] = useState<CepResponse | null>(null);
  const [loginPrompt, setLoginPrompt] = useState<{ titulo: string; mensagem: string } | null>(null);
  const [produtoSelecionado, setProdutoSelecionado] = useState<Produto | null>(null);
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebounce(busca, 300);
  const [categoriaSelecionada, setCategoriaSelecionada] = useState("Todas");
  const [processandoPedido, setProcessandoPedido] = useState(false);
  const [pedidoConfirmado, setPedidoConfirmado] = useState<{ id: string; total: number; metodo: string } | null>(null);
  /** Produtos da compra recém-concluída, esperando avaliação. */
  const [paraAvaliar, setParaAvaliar] = useState<AvaliacaoPendente[] | null>(null);
  const [resumoPedido, setResumoPedido] = useState<{
    subtotal: number;
    frete: number;
    desconto: number;
    total: number;
    cupom: string;
    metodo: string;
    itensIds: string[];
  } | null>(null);
  const [contaAberta, setContaAberta] = useState(false);
  const [dadosConta, setDadosConta] = useState<Conta | null>(null);
  const [metodoPagamento] = useState("pix");
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoResponse[]>([]);

  const grupos = useMemo(() => {
    return {
      destaque: produtos.slice(0, 3),
      recomendados: produtos.slice(3),
    };
  }, [produtos]);

  const categorias = useMemo(
    () => ["Todas", ...Array.from(new Set(produtos.map((produto) => produto.categoria)))],
    [produtos],
  );

  const produtosFiltrados = useMemo(() => {
    // Os dois lados da comparação passam por `normalizar`, senão a busca
    // continua exigindo acento e caixa exatos.
    const termo = normalizar(buscaDebounced.trim());
    return produtos.filter((produto) => {
      if (categoriaSelecionada !== "Todas" && produto.categoria !== categoriaSelecionada) return false;
      if (!termo) return true;
      return normalizar(`${produto.nome} ${produto.descricao}`).includes(termo);
    });
  }, [produtos, buscaDebounced, categoriaSelecionada]);

  /**
   * Posição do produto no catálogo cheio, para escolher a foto de fallback.
   *
   * Nenhum produto do seed tem `imagem` no banco, então a foto vem da lista
   * padrão do `imagemDe`, e essa lista é escolhida **por posição**. Passando o
   * índice da lista local de cada seção, o mesmo produto aparecia com fotos
   * diferentes na vitrine, nos favoritos, no histórico e no modal. Buscar no
   * catálogo inteiro dá a mesma foto em qualquer tela.
   *
   * `Math.max` protege o `-1` do `findIndex` quando o produto não está no
   * catálogo (favorito de uma conta antiga, por exemplo): sem ele, o índice
   * negativo cairia no último item da lista.
   */
  const indiceDe = useCallback(
    (id: string) =>
      Math.max(
        0,
        produtos.findIndex((p) => p.id === id),
      ),
    [produtos],
  );

  const abrirProduto = useCallback(
    (produto: Produto) => {
      setProdutoSelecionado(produto);
      setAvaliacoes([]);
      adicionarRecente(produto);
      api
        .get<AvaliacaoResponse[]>(`/avaliacoes/${encodeURIComponent(produto.id)}`)
        .then((dados) => setAvaliacoes(Array.isArray(dados) ? dados : []))
        .catch(() => setMensagem("Não foi possível carregar as avaliações agora."));
    },
    [adicionarRecente],
  );

  const carregarConta = useCallback(async () => {
    try {
      const dados = await api.get<Conta>("/conta");
      setDadosConta(dados);
      setFavoritos(dados.favoritos.map((produto) => produto.id));
    } catch (err) {
      setMensagem(err instanceof Error ? err.message : "Erro ao carregar conta.");
    }
  }, [setFavoritos]);

  useEffect(() => {
    if (usuario) {
      void carregarConta();
    }
  }, [usuario, carregarConta]);

  /**
   * Geolocalização ao entrar no site, e só com sessão ativa.
   *
   * O `usuario` na lista de dependências é o que garante o "sem conta não
   * pergunta": sem ele, deslogar e recarregar pediria permissão de novo.
   */
  useEffect(() => {
    if (!usuario) {
      // Saiu da conta: a sugestão anterior era daquele usuário e não pode
      // sobrar para o próximo que logar.
      setEnderecoSugerido(null);
    }
    let ativo = true;
    void (async () => {
      if (!usuario) return;
      const detectado = await detectarEndereco();
      if (detectado && ativo) setEnderecoSugerido(detectado);
    })();
    return () => {
      ativo = false;
    };
  }, [usuario, detectarEndereco]);

  const salvarEndereco = useCallback(async (endereco: Record<string, string>) => {
    const dados = await api.put<{ perfil: Conta["perfil"] }>("/conta/endereco", endereco);
    setDadosConta((atual) => (atual ? { ...atual, perfil: dados.perfil } : atual));
  }, []);

  const enviarAvaliacao = useCallback(async (produtoId: string, nota: number, comentario: string) => {
    await api.post(`/avaliacoes/${encodeURIComponent(produtoId)}`, { nota, comentario });
    setMensagem("Avaliação enviada. Obrigado!");
    const lista = await api.get<AvaliacaoResponse[]>(`/avaliacoes/${encodeURIComponent(produtoId)}`);
    if (Array.isArray(lista)) setAvaliacoes(lista);
  }, []);

  /**
   * Envia as várias avaliações do pop-up pós-compra e devolve o aviso.
   *
   * Não reaproveita `enviarAvaliacao` porque aquela mostra um aviso por
   * produto: três itens dariam três toasts empilhados. Aqui sai um resumo só.
   *
   * Uma falha não descarta as outras: quem avaliou dois de três produtos não
   * perde as duas respostas por causa do terceiro, que é o que acontece se a
   * chamada inteira for abortada no primeiro erro.
   */
  const enviarAvaliacoes = useCallback(
    async (notas: NotaEnviada[]): Promise<string> => {
      const resultados = await Promise.allSettled(
        notas.map((item) => api.post(`/avaliacoes/${encodeURIComponent(item.produtoId)}`, item)),
      );
      const falhas = resultados.filter((r) => r.status === "rejected").length;

      if (falhas > 0 && falhas === notas.length) {
        throw new Error("Não foi possível enviar nenhuma das avaliações.");
      }

      const enviadas = notas.length - falhas;
      // A lista em tela vem do modal do produto; recarregar a conta mantém as
      // permissões em dia para quem escolher avaliar de novo.
      void carregarConta();

      if (falhas === 0) {
        return enviadas === 1 ? "Avaliação enviada. Obrigado!" : `${enviadas} avaliações enviadas. Obrigado!`;
      }
      return `${enviadas} ${enviadas === 1 ? "avaliação enviada" : "avaliações enviadas"}, ${falhas} ${
        falhas === 1 ? "falhou" : "falharam"
      }.`;
    },
    [carregarConta],
  );

  const carregarAvaliacoes = useCallback(async (produtoId: string) => {
    try {
      const lista = await api.get<AvaliacaoResponse[]>(`/avaliacoes/${encodeURIComponent(produtoId)}`);
      if (Array.isArray(lista)) setAvaliacoes(lista);
    } catch {
      setMensagem("Não foi possível carregar as avaliações.");
    }
  }, []);

  const confirmarPedido = useCallback(async () => {
    if (!resumoPedido || !usuario) return;

    setProcessandoPedido(true);
    try {
      const itensSelecionados = carrinho.filter((item) => resumoPedido.itensIds.includes(item.id));
      const dados = await api.post<{ pedido: { id: string; total_final: number } }>("/pedidos", {
        metodoPagamento: resumoPedido.metodo,
        cupomCodigo: resumoPedido.cupom !== "Nenhum" ? resumoPedido.cupom : undefined,
        itens: itensSelecionados.map((item) => ({ produtoId: item.id, quantidade: item.quantidadeCarrinho })),
      });
      setCarrinho((atual) => atual.filter((item) => !resumoPedido.itensIds.includes(item.id)));
      setCarrinhoAberto(false);
      setResumoPedido(null);
      setPedidoConfirmado({
        id: dados.pedido.id,
        total: dados.pedido.total_final,
        metodo: resumoPedido.metodo,
      });
      // A compra libera a avaliação, então a pergunta vai logo depois da
      // confirmação. Fica guardada aqui porque a confirmação aparece primeiro.
      setParaAvaliar(itensSelecionados.map((item) => ({ produtoId: item.id, nome: item.nome })));
      // A conta guarda os pedidos, e é dela que sai a permissão de avaliar. Sem
      // esta recarga, quem acabou de comprar continuava vendo o formulário
      // travado até fechar e abrir a página de novo — a compra existia no
      // servidor, mas a tela ainda não sabia.
      void carregarConta();
      void recarregar();
    } catch (err) {
      setMensagem(err instanceof Error ? err.message : "Não foi possível finalizar o pedido.");
    } finally {
      setProcessandoPedido(false);
    }
  }, [resumoPedido, usuario, carrinho, carregarConta, recarregar, setCarrinho]);

  const handleFavoritar = useCallback(
    (produtoId: string) => {
      if (!usuario) {
        setLoginPrompt({
          titulo: "Salve seus favoritos",
          mensagem: "Faça login para salvar produtos favoritos e acessá-los depois.",
        });
        return;
      }
      alternarFavorito(produtoId);
    },
    [usuario, alternarFavorito],
  );

  /**
   * O modal da conta desenha a partir de `dadosConta`, que só muda quando a
   * conta é recarregada. Alternar o favorito atualiza a lista global mas não
   * esta, então sem o `carregarConta()` o item removido continuaria na tela
   * até fechar e abrir o modal de novo.
   */
  const handleDesfavoritar = useCallback(
    async (produtoId: string) => {
      await alternarFavorito(produtoId);
      await carregarConta();
    },
    [alternarFavorito, carregarConta],
  );

  /**
   * Abre um favorito na página do produto.
   *
   * O favorito chega sem a `categoria`, que o `ProductModal` exibe, então o
   * produto é procurado no catálogo que já está em memória em vez de montado
   * às partes — assim o modal mostra os mesmos dados da listagem.
   *
   * A busca também cobre o produto inativado: `listarProdutos` filtra
   * `ativo = true`, mas `listarFavoritos` não filtra, então um produto
   * desativado continua listado entre os favoritos e não terá Correspondência
   * no catálogo. Nesse caso avisamos em vez de abrir um modal pela metade.
   */
  const handleAbrirFavorito = useCallback(
    (produtoId: string) => {
      const produto = produtos.find((item) => item.id === produtoId);
      if (!produto) {
        setMensagem("Esse produto não está mais disponível no catálogo.");
        return;
      }
      setContaAberta(false);
      abrirProduto(produto);
    },
    [produtos, abrirProduto],
  );

  const handleAdicionarAoCarrinho = useCallback(
    (produto: Produto) => {
      if (!usuario) {
        setLoginPrompt({
          titulo: "Faça login para comprar",
          mensagem: "Entre na sua conta para adicionar produtos ao carrinho e finalizar sua compra.",
        });
        return;
      }
      adicionarAoCarrinho(produto);
    },
    [usuario, adicionarAoCarrinho],
  );

  const removerItemCarrinho = useCallback(
    (produtoId: string) => {
      const novoCarrinho = carrinho.filter((item) => item.id !== produtoId);
      setCarrinho(novoCarrinho);
    },
    [carrinho, setCarrinho],
  );

  const comprarSelecionados = useCallback(
    (ids: string[]) => {
      if (!usuario) {
        setLoginPrompt({
          titulo: "Faça login para comprar",
          mensagem: "Entre na sua conta para finalizar sua compra.",
        });
        return;
      }
      const itensSelecionados = carrinho.filter((item) => ids.includes(item.id));
      if (itensSelecionados.length === 0) return;

      // Prévia para mostrar na tela. O valor cobrado é o que `POST /api/pedidos`
      // devolve, recalculado no servidor a partir dos preços do banco — este
      // cálculo serve só para a leitura rápida e pode divergir se o preço mudar
      // entre a listagem e o checkout.
      const subtotal = itensSelecionados.reduce((acc, item) => acc + item.preco * item.quantidadeCarrinho, 0);
      const frete = subtotal >= 150 ? 0 : 20;
      const total = subtotal + frete;

      // `cupom` fixo em "Nenhum": a interface de cupom não existe. O hook
      // `useCoupon` valida um código corretamente, mas nenhum componente o
      // importa, então `cupomCodigo` chega sempre como `undefined` na rota.
      setResumoPedido({
        subtotal,
        frete,
        desconto: 0,
        total,
        cupom: "Nenhum",
        metodo: metodoPagamento,
        itensIds: ids,
      });
      setCarrinhoAberto(false);
    },
    [usuario, carrinho, metodoPagamento],
  );

  // O admin entra pela mesma tela do cliente. Não existe painel administrativo:
  // as rotas `/api/admin/*` existem e são protegidas por papel, mas não há
  // interface para elas. O redirecionamento para `/admin.html` foi removido
  // porque o arquivo não existe mais — ele levava o admin a uma página de erro
  // sem volta, a não ser digitando a URL de novo.
  const handleLogin = useCallback(
    async (email: string, senha: string) => {
      const usuarioLogado = await login(email, senha);
      await carregarConta();
      return usuarioLogado;
    },
    [login, carregarConta],
  );

  const handleCadastrar = useCallback(
    async (nome: string, email: string, senha: string) => {
      const usuarioLogado = await cadastrar(nome, email, senha);
      await carregarConta();
      return usuarioLogado;
    },
    [cadastrar, carregarConta],
  );

  const handleRecuperarSenha = useCallback(async (email: string) => {
    await api.post("/recuperar-senha", { email });
    setMensagem("Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.");
  }, []);

  const handleRedefinirSenha = useCallback(async (token: string, senha: string) => {
    await api.post("/redefinir-senha", { token, senha });
    setMensagem("Senha redefinida com sucesso.");
  }, []);

  /**
   * Encerrar a sessão redireciona para a tela de login em vez de devolver o
   * visitante à página inicial. A mensagem é setada antes da troca de tela
   * porque o `Toast` do layout principal deixa de existir assim que
   * `telaLogin` assume.
   */
  const handleSair = useCallback(async () => {
    try {
      await logout();
      setConfirmarSaida(false);
      setDadosConta(null);
      setContaAberta(false);
      setCarrinhoAberto(false);
      setProdutoSelecionado(null);
      setMensagem("Você saiu da sua conta. Entre novamente se quiser continuar.");
      setTelaLogin(true);
    } catch (err) {
      // Sem este `catch`, uma falha na chamada de logout deixava o modal aberto
      // e a rejeição da promise ia solta, sem aviso: o clique parecia não ter
      // feito nada.
      setConfirmarSaida(true);
      setMensagem(err instanceof Error ? err.message : "Não foi possível encerrar a sessão.");
    }
  }, [logout]);

  const abrirLogin = useCallback(() => {
    setTelaLogin(true);
  }, []);

  // Estável de propósito: o `Toast` reinicia o próprio timer sempre que
  // `onFechar` muda de identidade. Uma arrow function inline criaria um timer
  // novo a cada render e o aviso nunca expitaria.
  const fecharMensagem = useCallback(() => {
    setMensagem("");
  }, []);

  if (!usuario && telaLogin) {
    return (
      <>
        <LoginPage
          tema={tema}
          onToggleTema={() => setTema(tema === "claro" ? "escuro" : "claro")}
          onLogin={handleLogin}
          onCadastrar={handleCadastrar}
          onRecuperarSenha={handleRecuperarSenha}
          onRedefinirSenha={handleRedefinirSenha}
          onFechar={() => setTelaLogin(false)}
          onMensagem={setMensagem}
        />
        {/* A tela de login substitui o layout inteiro. Sem este `Toast` aqui, o
            aviso de credencial inválida era escrito no estado e nunca renderizado:
            o botão parecia não fazer nada. */}
        <Toast mensagem={mensagem} onFechar={fecharMensagem} />
      </>
    );
  }

  return (
    <div className="app-shell">
      <Header
        usuario={usuario}
        tema={tema}
        quantidadeCarrinho={quantidadeCarrinho}
        onToggleTema={() => setTema(tema === "claro" ? "escuro" : "claro")}
        onAbrirLogin={abrirLogin}
        onAbrirConta={() => {
          setContaAberta(true);
          void carregarConta();
        }}
        onAbrirCarrinho={() => setCarrinhoAberto(true)}
        onSair={() => setConfirmarSaida(true)}
      />

      <main className="container main-layout">
        <section className="hero">
          <div>
            <span className="badge">Novo ciclo</span>
            <h2>Produtos premium para sua rotina</h2>
            <p>Tecnologia, design e performance em um ambiente de compra pensado para clientes e negócios.</p>
            <div className="hero-actions">
              <a href="#produtos" className="primary-btn">
                Comprar agora
              </a>
              <a href="#sobre" className="secondary-btn">
                Saiba mais
              </a>
            </div>
          </div>
          <div className="hero-card">
            <img
              src="https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=900&q=80"
              alt="Banner principal"
            />
          </div>
        </section>

        <section id="destaques" className="section-header">
          <div>
            <span className="eyebrow">Mais vendidos</span>
            <h3>Produtos em destaque</h3>
          </div>
        </section>

        <section className="showcase-grid">
          {grupos.destaque.map((produto) => (
            <ProductCard
              key={produto.id}
              produto={produto}
              indice={indiceDe(produto.id)}
              variante="featured"
              favorito={favoritos.includes(produto.id)}
              onAbrir={abrirProduto}
              onFavoritar={handleFavoritar}
              onAdicionar={handleAdicionarAoCarrinho}
            />
          ))}
        </section>

        {usuario && favoritos.length > 0 && (
          <section className="favorites-section">
            <div className="section-header">
              <div>
                <span className="eyebrow">Seus favoritos</span>
                <h3>Produtos que você salvou</h3>
              </div>
            </div>
            <div className="showcase-grid">
              {produtos
                .filter((p) => favoritos.includes(p.id))
                .map((produto) => (
                  <ProductCard
                    key={produto.id}
                    produto={produto}
                    indice={indiceDe(produto.id)}
                    variante="compact"
                    favorito={true}
                    onAbrir={abrirProduto}
                    onFavoritar={handleFavoritar}
                    onAdicionar={handleAdicionarAoCarrinho}
                  />
                ))}
            </div>
          </section>
        )}

        <section id="produtos" className="section-header">
          <div>
            <span className="eyebrow">Catálogo</span>
            <h3>Todos os produtos</h3>
          </div>
        </section>

        <div className="catalog-controls" aria-label="Filtros do catálogo">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar produtos"
            aria-label="Buscar produtos"
          />
          <select
            value={categoriaSelecionada}
            onChange={(e) => setCategoriaSelecionada(e.target.value)}
            aria-label="Filtrar por categoria"
          >
            {categorias.map((categoria) => (
              <option key={categoria}>{categoria}</option>
            ))}
          </select>
        </div>

        {carregando ? (
          <p className="loading">Carregando catálogo...</p>
        ) : (
          <section className="catalog-grid">
            {produtosFiltrados.map((produto) => (
              <ProductCard
                key={produto.id}
                produto={produto}
                indice={indiceDe(produto.id)}
                favorito={favoritos.includes(produto.id)}
                onAbrir={abrirProduto}
                onFavoritar={handleFavoritar}
                onAdicionar={handleAdicionarAoCarrinho}
              />
            ))}
            {produtosFiltrados.length === 0 && <p className="loading">Nenhum produto encontrado.</p>}
          </section>
        )}

        <section id="sobre" className="info-grid">
          <div className="info-card">
            <h4>Qualidade e confiança</h4>
            <p>Produtos com garantia, suporte real e processo de compra seguro.</p>
          </div>
          <div className="info-card">
            <h4>Entrega rápida</h4>
            <p>Logística eficiente para atender clientes em diversos perfis.</p>
          </div>
          <div className="info-card">
            <h4>Atendimento humano</h4>
            <p>Equipe preparada para uma experiência de compra profissional.</p>
          </div>
        </section>

        {recentes.length > 0 && (
          <section className="recent-section">
            <div className="section-header">
              <div>
                <span className="eyebrow">Seu histórico</span>
                <h3>Vistos recentemente</h3>
              </div>
            </div>
            <div className="showcase-grid">
              {recentes.map((produto) => (
                <ProductCard
                  key={produto.id}
                  produto={produto}
                  indice={indiceDe(produto.id)}
                  variante="compact"
                  onAbrir={abrirProduto}
                  onFavoritar={handleFavoritar}
                  onAdicionar={handleAdicionarAoCarrinho}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      <Toast mensagem={mensagem} onFechar={fecharMensagem} />

      {loginPrompt && (
        <LoginPromptModal
          titulo={loginPrompt.titulo}
          mensagem={loginPrompt.mensagem}
          onIrParaLogin={() => {
            setLoginPrompt(null);
            abrirLogin();
          }}
          onFechar={() => setLoginPrompt(null)}
        />
      )}

      {carrinhoAberto && (
        <CartPanel
          carrinho={carrinho}
          onAlterarQuantidade={alterarQuantidade}
          onRemoverItem={removerItemCarrinho}
          onLimparCarrinho={limparCarrinho}
          onFechar={() => setCarrinhoAberto(false)}
          onComprarSelecionados={comprarSelecionados}
        />
      )}

      {confirmarSaida && (
        <div className="confirm-backdrop" onClick={() => setConfirmarSaida(false)}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmar-saida-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="confirm-icon">
              <LogOut size={19} />
            </span>
            <h3 id="confirmar-saida-titulo">Você realmente deseja sair?</h3>
            <p>Sua sessão será encerrada neste dispositivo e você voltará para a tela de login.</p>
            <div className="confirm-actions">
              <button className="secondary-btn" onClick={() => setConfirmarSaida(false)}>
                Cancelar
              </button>
              <button className="primary-btn" onClick={handleSair}>
                Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {produtoSelecionado && (
        <ProductModal
          produto={produtoSelecionado}
          usuario={usuario}
          avaliacoes={avaliacoes}
          indice={indiceDe(produtoSelecionado.id)}
          podeAvaliar={podeAvaliar(
            dadosConta?.pedidos ?? [],
            dadosConta?.minhasAvaliacoes ?? [],
            produtoSelecionado.id,
          )}
          onFechar={() => setProdutoSelecionado(null)}
          onAdicionarAoCarrinho={adicionarAoCarrinho}
          onEnviarAvaliacao={enviarAvaliacao}
          onCarregarAvaliacoes={carregarAvaliacoes}
          onMensagem={setMensagem}
        />
      )}

      {contaAberta && usuario && (
        <AccountModal
          usuario={usuario}
          dadosConta={dadosConta}
          onFechar={() => setContaAberta(false)}
          onSalvarEndereco={salvarEndereco}
          enderecoSugerido={enderecoSugerido}
          onDesfavoritar={handleDesfavoritar}
          onAbrirProduto={handleAbrirFavorito}
          onMensagem={setMensagem}
        />
      )}

      {resumoPedido && (
        <PaymentSummary
          subtotal={resumoPedido.subtotal}
          frete={resumoPedido.frete}
          total={resumoPedido.total}
          metodo={resumoPedido.metodo}
          processando={processandoPedido}
          onVoltar={() => setResumoPedido(null)}
          onConfirmar={confirmarPedido}
        />
      )}

      {pedidoConfirmado && (
        <div className="confirm-backdrop">
          <section className="payment-success" role="dialog" aria-modal="true">
            <span className="success-check">✓</span>
            <span className="eyebrow">PAGAMENTO APROVADO</span>
            <h2>Compra confirmada!</h2>
            <p>
              Seu pedido <strong>#{pedidoConfirmado.id.slice(0, 8)}</strong> foi registrado com sucesso.
            </p>
            <div>
              <span>Total pago</span>
              <strong>{formatarMoeda(pedidoConfirmado.total)}</strong>
              <small>{pedidoConfirmado.metodo.toUpperCase()} · confirmação demonstrativa</small>
            </div>
            <button
              className="primary-btn full"
              onClick={() => {
                const proximo = paraAvaliar;
                setPedidoConfirmado(null);
                // Só oferece avaliação se a compra tiver trazido produto para
                // avaliar. Sem este item o botão é só o "continuar" de sempre.
                if (proximo && proximo.length > 0) setParaAvaliar(proximo);
              }}
            >
              {paraAvaliar && paraAvaliar.length > 0 ? "Avaliar produtos" : "Continuar comprando"}
            </button>
          </section>
        </div>
      )}

      {/*
        Só entra depois que a confirmação saiu. As duas janelas ficariam
        empilhadas — e quem compra precisa ver "compra confirmada" antes de ser
        levado a avaliar, senão não há garantia de que a pergunta é sobre algo
        que ele realmente acabou de comprar.
      */}
      {!pedidoConfirmado && paraAvaliar && paraAvaliar.length > 0 && (
        <AvaliarCompraModal
          itens={paraAvaliar}
          // `minhasAvaliacoes` chega em `produto_id`; a janela trabalha com o
          // id do produto em camelCase, então a troca acontece na entrada.
          jaAvaliadas={(dadosConta?.minhasAvaliacoes ?? [])
            // Só entra o que ainda está na janela: um produto já avaliado e sem
            // compra nova não tem o que atualizar.
            .filter((avaliacao) =>
              podeAvaliar(dadosConta?.pedidos ?? [], dadosConta?.minhasAvaliacoes ?? [], avaliacao.produto_id),
            )
            .map((avaliacao) => ({
              produtoId: avaliacao.produto_id,
              nota: avaliacao.nota,
              comentario: avaliacao.comentario ?? null,
            }))}
          onFechar={() => setParaAvaliar(null)}
          onEnviar={async (notas) => {
            // O aviso só é mostrado depois de fechar a janela: enquanto ela
            // estiver aberta o toast ficaria escondido atrás do overlay.
            const aviso = await enviarAvaliacoes(notas);
            setParaAvaliar(null);
            setMensagem(aviso);
            return aviso;
          }}
        />
      )}
    </div>
  );
}
