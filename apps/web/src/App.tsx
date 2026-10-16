import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LogOut, Search, X } from "lucide-react";
import type { CepResponse, ProdutoResponse, RecuperarSenhaResponse, UsuarioAtualizadoResponse } from "@loja/shared";
import { useAuth } from "./hooks/useAuth.js";
import { useCarrinho, type ItemCarrinho } from "./hooks/useCarrinho.js";
import { useDebounce } from "./hooks/useDebounce.js";
import { useFavoritos } from "./hooks/useFavoritos.js";
import { useLocalizacao } from "./hooks/useLocalizacao.js";
import { useProducts } from "./hooks/useProducts.js";
import { useRecentes } from "./hooks/useRecentes.js";
import { useTema } from "./hooks/useTema.js";
import { useConta } from "./hooks/useConta.js";
import { useAvaliacoes } from "./hooks/useAvaliacoes.js";
import { escopoSessaoAtual, EVENTO_SESSAO_EXPIRADA } from "./lib/sessao.js";
import { limparTokenDaUrl } from "./lib/recuperacao.js";
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
import { AdminDashboard } from "./components/AdminDashboard.js";

type Produto = ProdutoResponse;
// Tipos inline removidos - agora usam tipos nomeados do shared.

export default function App() {
  const {
    usuario,
    carregando: verificandoSessao,
    login,
    cadastrar,
    logout,
    invalidarSessao,
    atualizarUsuario,
  } = useAuth();
  const { produtos, carregando, erro: erroProdutos, recarregar } = useProducts();
  const { carrinho, setCarrinho, adicionarAoCarrinho, alterarQuantidade, limparCarrinho, quantidadeCarrinho } =
    useCarrinho(produtos);
  const { tema, setTema } = useTema();
  const areaPrincipalRef = useRef<HTMLElement | null>(null);
  const { recentes, adicionarRecente } = useRecentes(produtos);
  const [tokenInicial, setTokenInicial] = useState(
    () => new URLSearchParams(window.location.search).get("resetToken") ?? "",
  );
  const [telaLogin, setTelaLogin] = useState(Boolean(tokenInicial));
  const [mensagem, setMensagem] = useState("");
  const { favoritos, alternarFavorito, setFavoritos } = useFavoritos({
    usuarioLogado: !!usuario,
    usuarioId: usuario?.id,
    onErro: setMensagem,
  });
  const { dadosConta, carregarConta, salvarEndereco } = useConta({
    usuarioId: usuario?.id ?? null,
    onFavoritos: setFavoritos,
    onErro: setMensagem,
  });
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
  const pedidoEmCurso = useRef<symbol | null>(null);
  const [pedidoConfirmado, setPedidoConfirmado] = useState<{ id: string; total: number; metodo: string } | null>(null);
  /** Produtos da compra recém-concluída, esperando avaliação. */
  const [paraAvaliar, setParaAvaliar] = useState<AvaliacaoPendente[] | null>(null);
  const [resumoPedido, setResumoPedido] = useState<{
    chaveIdempotencia: string;
    itens: ItemCarrinho[];
    subtotal: number;
    frete: number;
    desconto: number;
    total: number;
    cupom: string;
    metodo: string;
  } | null>(null);
  const [contaAberta, setContaAberta] = useState(false);
  const [metodoPagamento] = useState("pix");
  const { avaliacoes, recarregar: carregarAvaliacoes } = useAvaliacoes(produtoSelecionado?.id ?? null, setMensagem);
  const escopoRender = escopoSessaoAtual();
  const mensagemDaConta = useCallback(
    (texto: string) => {
      if (escopoRender === escopoSessaoAtual()) setMensagem(texto);
    },
    [escopoRender],
  );

  useEffect(() => {
    limparTokenDaUrl();
  }, []);
  useEffect(() => {
    const areaPrincipal = areaPrincipalRef.current;
    if (!areaPrincipal || !("IntersectionObserver" in window)) return undefined;

    const seletores = [
      ".hero",
      ".section-header",
      ".showcase-grid",
      ".favorites-section",
      ".catalog-controls",
      ".catalog-grid",
      ".info-grid",
      ".recent-section",
    ].join(",");
    const observados = new WeakSet<Element>();
    const revelarAoEntrar = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((entrada) => {
          if (!entrada.isIntersecting) return;
          entrada.target.classList.add("is-in-view");
          revelarAoEntrar.unobserve(entrada.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -5% 0px" },
    );

    const observarNovasAreas = () => {
      areaPrincipal.querySelectorAll(seletores).forEach((elemento) => {
        if (observados.has(elemento)) return;
        observados.add(elemento);
        revelarAoEntrar.observe(elemento);
      });
    };

    document.documentElement.classList.add("motion-ready");
    observarNovasAreas();
    const mutacoes = new MutationObserver(observarNovasAreas);
    mutacoes.observe(areaPrincipal, { childList: true, subtree: true });

    return () => {
      mutacoes.disconnect();
      revelarAoEntrar.disconnect();
      document.documentElement.classList.remove("motion-ready");
    };
  }, []);
  useEffect(() => {
    const expirada = () => {
      setTelaLogin(true);
      setMensagem("Sua sessão expirou. Faça login novamente.");
    };
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, expirada);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, expirada);
  }, []);

  useLayoutEffect(() => {
    setEnderecoSugerido(null);
    setLoginPrompt(null);
    setContaAberta(false);
    setConfirmarSaida(false);
    setCarrinhoAberto(false);
    setProdutoSelecionado(null);
    setResumoPedido(null);
    setPedidoConfirmado(null);
    setParaAvaliar(null);
    pedidoEmCurso.current = null;
    setProcessandoPedido(false);
  }, [usuario?.id]);

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

  const abrirProduto = useCallback(
    (produto: Produto) => {
      setProdutoSelecionado(produto);
      adicionarRecente(produto.id);
    },
    [adicionarRecente],
  );

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

  const enviarAvaliacao = useCallback(
    async (produtoId: string, nota: number, comentario: string) => {
      const escopo = escopoSessaoAtual();
      await api.post(`/avaliacoes/${encodeURIComponent(produtoId)}`, { nota, comentario });
      if (escopo !== escopoSessaoAtual()) return;
      setMensagem("Avaliação enviada. Obrigado!");
      await Promise.all([carregarConta(), carregarAvaliacoes(produtoId)]);
    },
    [carregarConta, carregarAvaliacoes],
  );

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
      const escopo = escopoSessaoAtual();
      const resultados = await Promise.allSettled(
        notas.map((item) => api.post(`/avaliacoes/${encodeURIComponent(item.produtoId)}`, item)),
      );
      if (escopo !== escopoSessaoAtual()) return "";
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

  const confirmarPedido = useCallback(async () => {
    if (!resumoPedido || !usuario || pedidoEmCurso.current) return;

    const operacao = Symbol("pedido");
    pedidoEmCurso.current = operacao;
    const escopo = escopoSessaoAtual();
    setProcessandoPedido(true);
    try {
      const itensSelecionados = resumoPedido.itens;
      const dados = await api.post<{ pedido: { id: string; total_final: number } }>("/pedidos", {
        chaveIdempotencia: resumoPedido.chaveIdempotencia,
        metodoPagamento: resumoPedido.metodo,
        cupomCodigo: resumoPedido.cupom !== "Nenhum" ? resumoPedido.cupom : undefined,
        itens: itensSelecionados.map((item) => ({ produtoId: item.id, quantidade: item.quantidadeCarrinho })),
      });
      if (escopo !== escopoSessaoAtual() || pedidoEmCurso.current !== operacao) return;
      setCarrinho((atual) =>
        atual.flatMap((item) => {
          const comprado = itensSelecionados.find((selecionado) => selecionado.id === item.id);
          if (!comprado) return [item];
          const restante = item.quantidadeCarrinho - comprado.quantidadeCarrinho;
          return restante > 0 ? [{ ...item, quantidadeCarrinho: restante }] : [];
        }),
      );
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
      if (escopo === escopoSessaoAtual() && pedidoEmCurso.current === operacao) {
        setMensagem(err instanceof Error ? err.message : "Não foi possível finalizar o pedido.");
      }
    } finally {
      if (pedidoEmCurso.current === operacao) {
        pedidoEmCurso.current = null;
        setProcessandoPedido(false);
      }
    }
  }, [resumoPedido, usuario, carregarConta, recarregar, setCarrinho]);

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
        chaveIdempotencia: crypto.randomUUID(),
        itens: itensSelecionados,
        subtotal,
        frete,
        desconto: 0,
        total,
        cupom: "Nenhum",
        metodo: metodoPagamento,
      });
      setCarrinhoAberto(false);
    },
    [usuario, carrinho, metodoPagamento],
  );

  const handleRecuperarSenha = useCallback(async (email: string) => {
    return api.post<RecuperarSenhaResponse>("/recuperar-senha", { email });
  }, []);

  const handleSalvarNome = useCallback(
    async (nome: string) => {
      const dados = await api.put<UsuarioAtualizadoResponse>("/conta/nome", { nome });
      atualizarUsuario(dados.usuario);
      await carregarConta();
    },
    [atualizarUsuario, carregarConta],
  );

  const handleRedefinirSenha = useCallback(
    async (token: string, senha: string) => {
      await api.post("/redefinir-senha", { token, senha });
      invalidarSessao();
      setTokenInicial("");
      setMensagem("Senha redefinida com sucesso. Entre com sua nova senha.");
    },
    [invalidarSessao],
  );

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

  const sairDoPainelAdmin = useCallback(async () => {
    try {
      await logout();
      setMensagem("Você saiu da sua conta.");
      setTelaLogin(true);
    } catch (err) {
      setMensagem(err instanceof Error ? err.message : "Não foi possível encerrar a sessão.");
    }
  }, [logout]);

  if (verificandoSessao)
    return (
      <div className="loading" role="status">
        Verificando sua sessão...
      </div>
    );

  if (telaLogin) {
    return (
      <>
        <LoginPage
          tema={tema}
          onToggleTema={() => setTema(tema === "claro" ? "escuro" : "claro")}
          tokenInicial={tokenInicial}
          onLogin={login}
          onCadastrar={cadastrar}
          onRecuperarSenha={handleRecuperarSenha}
          onRedefinirSenha={handleRedefinirSenha}
          onFechar={() => {
            setTokenInicial("");
            setTelaLogin(false);
          }}
          onMensagem={setMensagem}
        />
        {/* A tela de login substitui o layout inteiro. Sem este `Toast` aqui, o
            aviso de credencial inválida era escrito no estado e nunca renderizado:
            o botão parecia não fazer nada. */}
        <Toast mensagem={mensagem} onFechar={fecharMensagem} />
      </>
    );
  }

  if (usuario?.role === "admin") {
    return (
      <>
        <AdminDashboard
          tema={tema}
          nome={usuario.nome}
          email={usuario.email}
          onToggleTema={() => setTema(tema === "claro" ? "escuro" : "claro")}
          onSair={() => void sairDoPainelAdmin()}
        />
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

      <main className="container main-layout" ref={areaPrincipalRef}>
        <section className="hero">
          <div>
            <span className="badge">Tecnologia para o seu dia</span>
            <h2>Seu próximo upgrade começa aqui.</h2>
            <p>
              Encontre os acessórios que combinam com seu jeito de trabalhar, jogar e criar. Escolha com calma e compre
              com confiança.
            </p>
            <div className="hero-actions">
              <a href="#produtos" className="primary-btn">
                Explorar produtos
              </a>
              <a href="#sobre" className="secondary-btn">
                Conheça a loja
              </a>
            </div>
          </div>
          <div className="hero-card">
            {/* Banner local, como as fotos dos produtos. Era uma URL do Unsplash,
                e era a única imagem da lojaDepending de serviço de terceiro: se o
                serviço caísse, o topo da página ficaria com um buraco enquanto o
                resto continuava inteiro.

                Arquivo próprio em 3:2, e não o `teclado.jpg` quadrado: a caixa do
                banner é deitada, e forçar a foto quadrada nela cortaria as laterais
                da foto. */}
            <img src="/imagens/banner.jpg" alt="Teclado gamer com iluminação azul e roxa" />
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
          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar produtos por nome ou descrição"
              aria-label="Buscar produtos"
            />
            {busca && (
              <button type="button" className="clear-search" aria-label="Limpar busca" onClick={() => setBusca("")}>
                <X size={17} />
              </button>
            )}
          </label>
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
        <div className="catalog-feedback" aria-live="polite">
          <span>
            {produtosFiltrados.length === 1
              ? "1 produto encontrado"
              : `${produtosFiltrados.length} produtos encontrados`}
          </span>
          {(busca || categoriaSelecionada !== "Todas") && (
            <button
              type="button"
              onClick={() => {
                setBusca("");
                setCategoriaSelecionada("Todas");
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>

        {erroProdutos ? (
          <section className="empty-state" role="alert">
            <p>Não foi possível carregar o catálogo. {erroProdutos}</p>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                void recarregar();
              }}
            >
              Tentar novamente
            </button>
          </section>
        ) : carregando ? (
          <p className="loading">Carregando catálogo...</p>
        ) : (
          <section className="catalog-grid">
            {produtosFiltrados.map((produto) => (
              <ProductCard
                key={produto.id}
                produto={produto}
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
          podeAvaliar={podeAvaliar(
            dadosConta?.pedidos ?? [],
            dadosConta?.minhasAvaliacoes ?? [],
            produtoSelecionado.id,
          )}
          onFechar={() => setProdutoSelecionado(null)}
          key={produtoSelecionado.id}
          onAdicionarAoCarrinho={handleAdicionarAoCarrinho}
          onEnviarAvaliacao={enviarAvaliacao}
          onMensagem={mensagemDaConta}
        />
      )}

      {contaAberta && usuario && (
        <AccountModal
          key={usuario.id}
          usuario={usuario}
          dadosConta={dadosConta}
          onFechar={() => setContaAberta(false)}
          onSalvarNome={handleSalvarNome}
          onSalvarEndereco={salvarEndereco}
          enderecoSugerido={enderecoSugerido}
          onDesfavoritar={handleDesfavoritar}
          onAbrirProduto={handleAbrirFavorito}
          onMensagem={mensagemDaConta}
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
            const escopo = escopoSessaoAtual();
            const aviso = await enviarAvaliacoes(notas);
            if (escopo !== escopoSessaoAtual()) return aviso;
            setParaAvaliar(null);
            setMensagem(aviso);
            return aviso;
          }}
        />
      )}
    </div>
  );
}
