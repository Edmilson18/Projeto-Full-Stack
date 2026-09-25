import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Heart, LogIn, LogOut, Moon, ShoppingBag, Sun, UserRound } from "lucide-react";

type Produto = {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  quantidade: number;
  categoria: string;
  imagem?: string;
};

type UsuarioSessao = {
  id: string;
  nome: string;
  email: string;
  role: "admin" | "cliente";
};

type ItemCarrinho = Produto & { quantidadeCarrinho: number };
type Avaliacao = { nota: number; comentario: string; criado_em: string; nome: string };

const imagensPadrao = [
  "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1585386959984-a4155224a1ad?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1491553895911-0055eca6402d?auto=format&fit=crop&w=900&q=80",
];

const formatarMoeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

export default function App() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null);
  const [telaLogin, setTelaLogin] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [recuperacaoAberta, setRecuperacaoAberta] = useState(false);
  const [emailRecuperacao, setEmailRecuperacao] = useState("");
  const [tokenRecuperacao, setTokenRecuperacao] = useState(
    () => new URLSearchParams(window.location.search).get("resetToken") ?? "",
  );
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmacaoNovaSenha, setConfirmacaoNovaSenha] = useState("");
  const [login, setLogin] = useState({ nome: "", email: "", senha: "" });
  const [modoCadastro, setModoCadastro] = useState(false);
  const [emailJaCadastrado, setEmailJaCadastrado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [loading, setLoading] = useState(true);
  const [produtoSelecionado, setProdutoSelecionado] = useState<Produto | null>(null);
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("carrinho") || "[]") as ItemCarrinho[];
    } catch {
      return [];
    }
  });
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [codigoCupom, setCodigoCupom] = useState("");
  const [cupomStatus, setCupomStatus] = useState<{ tipo: "idle" | "erro" | "sucesso"; mensagem: string }>({
    tipo: "idle",
    mensagem: "",
  });
  const [cuponsDisponiveis, setCuponsDisponiveis] = useState<
    Array<{ codigo: string; tipoDesconto: string; porcentagemDesconto: number; valorMinimo: number }>
  >([]);
  const [busca, setBusca] = useState("");
  const [categoriaSelecionada, setCategoriaSelecionada] = useState("Todas");
  const [processandoPedido, setProcessandoPedido] = useState(false);
  const [pedidoConfirmado, setPedidoConfirmado] = useState<{ id: string; total: number; metodo: string } | null>(null);
  const [resumoPedido, setResumoPedido] = useState<{
    subtotal: number;
    frete: number;
    desconto: number;
    total: number;
    cupom: string;
    metodo: string;
  } | null>(null);
  const [contaAberta, setContaAberta] = useState(false);
  const [dadosConta, setDadosConta] = useState<{
    perfil: Record<string, string>;
    pedidos: Array<Record<string, unknown>>;
    favoritos: Produto[];
  } | null>(null);
  const [favoritos, setFavoritos] = useState<string[]>(() => JSON.parse(localStorage.getItem("favoritosLoja") || "[]"));
  const [recentes, setRecentes] = useState<Produto[]>(() => JSON.parse(localStorage.getItem("recentesLoja") || "[]"));
  const [metodoPagamento, setMetodoPagamento] = useState("pix");
  const [notaAvaliacao, setNotaAvaliacao] = useState(5);
  const [comentarioAvaliacao, setComentarioAvaliacao] = useState("");
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [tema, setTema] = useState<"claro" | "escuro">(() =>
    localStorage.getItem("temaLoja") === "escuro" ? "escuro" : "claro",
  );
  const [buscandoLocalizacao, setBuscandoLocalizacao] = useState(false);

  useEffect(() => {
    fetch("/api/sessao")
      .then((resposta) => resposta.json())
      .then((dados) => setUsuario(dados.usuario ?? null))
      .catch(() => setMensagem("Não foi possível conectar ao servidor."));
  }, []);

  const carregarCupons = async () => {
    try {
      const resposta = await fetch("/api/cupons");
      const dados = await resposta.json();
      if (Array.isArray(dados)) {
        setCuponsDisponiveis(dados);
      }
    } catch {
      setCuponsDisponiveis([]);
    }
  };

  useEffect(() => {
    localStorage.setItem("carrinho", JSON.stringify(carrinho));
  }, [carrinho]);

  useEffect(() => {
    localStorage.setItem("temaLoja", tema);
    document.documentElement.dataset.tema = tema;
  }, [tema]);

  useEffect(() => {
    localStorage.setItem("favoritosLoja", JSON.stringify(favoritos));
  }, [favoritos]);
  useEffect(() => {
    localStorage.setItem("recentesLoja", JSON.stringify(recentes));
  }, [recentes]);

  const carregarProdutos = async () => {
    try {
      const resposta = await fetch("/api/produtos");
      const dados = await resposta.json();

      const itens = Array.isArray(dados)
        ? dados.map((produto, index) => ({
            ...produto,
            imagem: produto.imagem || imagensPadrao[index % imagensPadrao.length],
          }))
        : [];

      setProdutos(itens);
    } catch (erro) {
      console.error(erro);
    } finally {
      setLoading(false);
    }
  };

  // Precisa ficar depois de `carregarProdutos` e `carregarCupons`: sao `const`, e
  // um useEffect acima delas os encontraria em TDZ.
  useEffect(() => {
    void carregarProdutos();
    void carregarCupons();
  }, []);

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
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return produtos.filter(
      (produto) =>
        (categoriaSelecionada === "Todas" || produto.categoria === categoriaSelecionada) &&
        (!termo || `${produto.nome} ${produto.descricao}`.toLocaleLowerCase("pt-BR").includes(termo)),
    );
  }, [produtos, busca, categoriaSelecionada]);

  const totalCarrinho = carrinho.reduce((total, item) => total + item.preco * item.quantidadeCarrinho, 0);
  const quantidadeCarrinho = carrinho.reduce((total, item) => total + item.quantidadeCarrinho, 0);

  const adicionarAoCarrinho = (produto: Produto) => {
    if (produto.quantidade < 1) return;
    setCarrinho((itens) => {
      const existente = itens.find((item) => item.id === produto.id);
      if (existente) {
        return itens.map((item) =>
          item.id === produto.id
            ? { ...item, quantidadeCarrinho: Math.min(item.quantidadeCarrinho + 1, produto.quantidade) }
            : item,
        );
      }
      return [...itens, { ...produto, quantidadeCarrinho: 1 }];
    });
    setCarrinhoAberto(true);
  };

  const alterarQuantidade = (produtoId: string, variacao: number) => {
    setCarrinho((itens) =>
      itens
        .map((item) =>
          item.id === produtoId
            ? {
                ...item,
                quantidadeCarrinho: Math.min(item.quantidade, Math.max(0, item.quantidadeCarrinho + variacao)),
              }
            : item,
        )
        .filter((item) => item.quantidadeCarrinho > 0),
    );
  };

  const abrirProduto = (produto: Produto) => {
    setProdutoSelecionado(produto);
    setAvaliacoes([]);
    setRecentes((itens) => [produto, ...itens.filter((item) => item.id !== produto.id)].slice(0, 4));
    fetch(`/api/avaliacoes/${encodeURIComponent(produto.id)}`)
      .then(async (resposta) => {
        if (!resposta.ok) throw new Error("Não foi possível carregar as avaliações.");
        return resposta.json();
      })
      .then((dados) => setAvaliacoes(Array.isArray(dados) ? dados : []))
      .catch(() => setMensagem("Não foi possível carregar as avaliações agora."));
  };

  const alternarFavorito = async (produtoId: string) => {
    if (!usuario) {
      setMensagem("Entre na sua conta para salvar favoritos.");
      return;
    }
    try {
      const resposta = await fetch(`/api/favoritos/${encodeURIComponent(produtoId)}`, { method: "POST" });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro);

      const favoritoAtivo = dados.favorito === true;
      setFavoritos((itens) =>
        favoritoAtivo ? [...new Set([...itens, produtoId])] : itens.filter((id) => id !== produtoId),
      );
      setMensagem(
        favoritoAtivo ? "Produto adicionado aos favoritos. Confira em Minha Conta." : "Produto removido dos favoritos.",
      );
      if (favoritoAtivo) {
        setContaAberta(true);
        await carregarConta();
      }
    } catch {
      setMensagem("Não foi possível atualizar seus favoritos.");
    }
  };

  const carregarConta = async () => {
    const resposta = await fetch("/api/conta");
    const dados = await resposta.json();
    if (resposta.ok) {
      setDadosConta(dados);
      setFavoritos(dados.favoritos.map((produto: Produto) => produto.id));
    }
  };

  const consultarCep = async (event: React.FocusEvent<HTMLInputElement>) => {
    const cep = event.currentTarget.value.replace(/\D/g, "");
    if (cep.length !== 8) return;

    try {
      setMensagem("Consultando endereço...");
      const resposta = await fetch(`/api/cep/${cep}`);
      const dados = await resposta.json();
      if (!resposta.ok) {
        setMensagem(dados.erro ?? "CEP não encontrado.");
        return;
      }

      const formulario = event.currentTarget.form;
      if (!formulario) return;
      for (const campo of ["rua", "bairro", "cidade", "estado"]) {
        const input = formulario.elements.namedItem(campo) as HTMLInputElement | null;
        if (input) input.value = dados[campo] ?? "";
      }
      setMensagem("Endereço preenchido pelo CEP.");
    } catch {
      setMensagem("Não foi possível consultar o CEP agora.");
    }
  };

  const obterLocalizacao = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!navigator.geolocation) {
      setMensagem("Seu navegador não suporta localização. Preencha o endereço manualmente.");
      return;
    }

    const formulario = event.currentTarget.form;
    if (!formulario) return;

    setBuscandoLocalizacao(true);
    setMensagem("Solicitando sua localização...");

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const resposta = await fetch(
            `/api/localizacao/reversa?latitude=${encodeURIComponent(coords.latitude)}&longitude=${encodeURIComponent(coords.longitude)}`,
          );
          const dados = (await resposta.json()) as Record<string, string>;
          if (!resposta.ok) throw new Error(dados.erro ?? "Não foi possível identificar o endereço.");

          for (const [campo, valor] of Object.entries(dados)) {
            const input = formulario.elements.namedItem(campo) as HTMLInputElement | null;
            if (input && valor) input.value = valor;
          }
          setMensagem("Endereço encontrado. Confira os dados antes de salvar.");
        } catch (erro) {
          setMensagem(erro instanceof Error ? erro.message : "Não foi possível encontrar seu endereço.");
        } finally {
          setBuscandoLocalizacao(false);
        }
      },
      (erro) => {
        setBuscandoLocalizacao(false);
        setMensagem(
          erro.code === erro.PERMISSION_DENIED
            ? "Permissão de localização negada. Preencha o endereço manualmente."
            : "Não foi possível obter sua localização. Tente novamente ou use o CEP.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    );
  };

  const salvarEndereco = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const valores = Object.fromEntries(new FormData(event.currentTarget).entries());
    const resposta = await fetch("/api/conta/endereco", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valores),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      setMensagem(dados.erro ?? "Não foi possível salvar o endereço.");
      return;
    }
    setDadosConta((atual) => (atual ? { ...atual, perfil: dados.perfil } : atual));
    setMensagem("Endereço salvo com sucesso.");
  };

  const enviarAvaliacao = async () => {
    if (!produtoSelecionado || !usuario) {
      setMensagem("Entre na sua conta para avaliar um produto.");
      setProdutoSelecionado(null);
      setTelaLogin(true);
      return;
    }
    try {
      const resposta = await fetch(`/api/avaliacoes/${encodeURIComponent(produtoSelecionado.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota: notaAvaliacao, comentario: comentarioAvaliacao }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setMensagem(dados.erro ?? "Não foi possível enviar a avaliação.");
        return;
      }
      setMensagem("Avaliação enviada. Obrigado!");
      setComentarioAvaliacao("");
      const lista = await fetch(`/api/avaliacoes/${encodeURIComponent(produtoSelecionado.id)}`);
      if (lista.ok) setAvaliacoes(await lista.json());
    } catch {
      setMensagem("Não foi possível conectar ao servidor para enviar a avaliação.");
    }
  };

  const validarCupomAntesDoPagamento = async () => {
    const codigo = codigoCupom.trim();

    if (!codigo) {
      setCupomStatus({ tipo: "idle", mensagem: "" });
      return true;
    }

    try {
      const resposta = await fetch("/api/cupons/validar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        setCupomStatus({ tipo: "erro", mensagem: dados.erro || "Cupom inválido." });
        return false;
      }

      setCupomStatus({ tipo: "sucesso", mensagem: `Cupom ${dados.codigo} aplicado com sucesso.` });
      return true;
    } catch {
      setCupomStatus({ tipo: "erro", mensagem: "Não foi possível validar o cupom no momento." });
      return false;
    }
  };

  const abrirResumoCompra = async () => {
    if (!usuario) {
      setMensagem("Faça login para finalizar a compra.");
      setTelaLogin(true);
      return;
    }
    if (!carrinho.length) {
      setMensagem("Adicione produtos ao carrinho antes de finalizar.");
      return;
    }

    const cupomValido = await validarCupomAntesDoPagamento();
    if (!cupomValido) {
      setMensagem("Cupom inválido ou não aplicável ao pedido.");
      return;
    }

    const subtotal = totalCarrinho;
    const frete = subtotal >= 150 ? 0 : 20;
    const codigoInformado = codigoCupom.trim();
    let desconto = 0;

    if (codigoInformado) {
      try {
        const resposta = await fetch("/api/cupons/validar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codigo: codigoInformado }),
        });
        const dados = await resposta.json();

        if (resposta.ok && dados.tipoDesconto === "porcentagem") {
          desconto = subtotal * (Number(dados.porcentagemDesconto ?? 0) / 100);
        } else if (resposta.ok && dados.tipoDesconto === "valor_fixo") {
          desconto = Math.min(subtotal, Number(dados.porcentagemDesconto ?? 0));
        } else if (resposta.ok && dados.tipoDesconto === "frete_gratis") {
          desconto = 0;
        }
      } catch {
        setMensagem("Não foi possível calcular o desconto do cupom.");
        return;
      }
    }

    const total = Math.max(subtotal - desconto + frete, 0);
    setResumoPedido({
      subtotal,
      frete,
      desconto,
      total,
      cupom: codigoInformado || "Nenhum",
      metodo: metodoPagamento,
    });
  };

  const confirmarPedido = async () => {
    if (!resumoPedido || !usuario) return;

    setProcessandoPedido(true);
    try {
      const resposta = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": usuario.id },
        body: JSON.stringify({
          cupomCodigo: codigoCupom,
          metodoPagamento: resumoPedido.metodo,
          itens: carrinho.map((item) => ({ produtoId: item.id, quantidade: item.quantidadeCarrinho })),
        }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setMensagem(dados.erro || "Não foi possível finalizar o pedido.");
        return;
      }
      setCarrinho([]);
      setCodigoCupom("");
      setCupomStatus({ tipo: "idle", mensagem: "" });
      setCarrinhoAberto(false);
      setResumoPedido(null);
      setPedidoConfirmado({
        id: String(dados.pedido.id),
        total: Number(dados.pedido.total_final),
        metodo: resumoPedido.metodo,
      });
      carregarProdutos();
    } catch (erro) {
      console.error(erro);
      setMensagem("Não foi possível conectar ao servidor.");
    } finally {
      setProcessandoPedido(false);
    }
  };

  const fazerLogin = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      const resposta = await fetch(modoCadastro ? "/api/cadastro" : "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(login),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        if (modoCadastro && resposta.status === 409) {
          setEmailJaCadastrado(true);
          return;
        }
        setMensagem(dados.erro || "Erro ao entrar.");
        return;
      }

      const usuarioLogado: UsuarioSessao = dados.usuario;
      // Apenas para personalizar a interface; a autorização real é a sessão HttpOnly do servidor.
      localStorage.setItem("usuarioLogado", JSON.stringify(usuarioLogado));
      setUsuario(usuarioLogado);
      setMensagem("");

      if (usuarioLogado.role === "admin") {
        window.location.href = "/admin.html";
      }
    } catch (erro) {
      console.error(erro);
      setMensagem("Não foi possível conectar ao servidor.");
    }
  };

  const sair = () => {
    fetch("/api/logout", { method: "POST" });
    setUsuario(null);
  };

  const solicitarRecuperacao = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const resposta = await fetch("/api/recuperar-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailRecuperacao }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setMensagem(dados.erro ?? "Não foi possível solicitar a recuperação.");
        return;
      }
      setMensagem(dados.mensagem ?? "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.");
      if (dados.token) setTokenRecuperacao(String(dados.token));
      else setRecuperacaoAberta(false);
    } catch {
      setMensagem("Não foi possível solicitar a recuperação agora.");
    }
  };

  const redefinirSenha = async (event: React.FormEvent) => {
    event.preventDefault();
    if (novaSenha !== confirmacaoNovaSenha) {
      setMensagem("As senhas não conferem.");
      return;
    }
    try {
      const resposta = await fetch("/api/redefinir-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRecuperacao, senha: novaSenha }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setMensagem(dados.erro ?? "Não foi possível redefinir a senha.");
        return;
      }
      setMensagem(dados.mensagem);
      setRecuperacaoAberta(false);
      setTokenRecuperacao("");
      setNovaSenha("");
      setConfirmacaoNovaSenha("");
    } catch {
      setMensagem("Não foi possível redefinir a senha agora.");
    }
  };

  if (!usuario && telaLogin) {
    return (
      <div className={`login-page tema-${tema}`}>
        <button
          className="theme-toggle login-theme-toggle"
          aria-label={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
          title={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
          onClick={() => setTema(tema === "claro" ? "escuro" : "claro")}
        >
          {tema === "claro" ? <Moon size={17} strokeWidth={2} /> : <Sun size={17} strokeWidth={2} />}
        </button>
        <div className="login-card">
          <div className="brand-block">
            <span className="badge">Loja Tech</span>
            <h1>Bem-vindo</h1>
            <p>Gerencie seu negócio com tecnologia, velocidade e confiança.</p>
          </div>

          <form onSubmit={fazerLogin} className="login-form">
            {modoCadastro && (
              <label>
                Nome completo
                <input
                  type="text"
                  required
                  minLength={2}
                  value={login.nome}
                  onChange={(e) => setLogin((prev) => ({ ...prev, nome: e.target.value }))}
                />
              </label>
            )}
            <label>
              E-mail
              <input
                type="email"
                value={login.email}
                onChange={(e) => setLogin((prev) => ({ ...prev, email: e.target.value }))}
              />
            </label>

            <label>
              Senha
              <span className="password-field">
                <input
                  type={mostrarSenha ? "text" : "password"}
                  value={login.senha}
                  onChange={(e) => setLogin((prev) => ({ ...prev, senha: e.target.value }))}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  onClick={() => setMostrarSenha((atual) => !atual)}
                >
                  {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <button type="submit" className="primary-btn">
              {modoCadastro ? "Criar conta" : "Entrar"}
            </button>
          </form>

          {!modoCadastro && (
            <button type="button" className="text-btn" onClick={() => setRecuperacaoAberta(true)}>
              Esqueci minha senha
            </button>
          )}

          {mensagem && <p className="alert">{mensagem}</p>}

          <button
            type="button"
            className="secondary-btn full"
            onClick={() => {
              setModoCadastro((atual) => !atual);
              setMensagem("");
              setLogin({ nome: "", email: "", senha: "" });
            }}
          >
            {modoCadastro ? "Já tenho uma conta" : "Criar uma nova conta"}
          </button>
          <button
            type="button"
            className="text-btn guest-access"
            onClick={() => {
              setTelaLogin(false);
              setMensagem("");
            }}
          >
            Continuar sem conta
          </button>
        </div>
        {(recuperacaoAberta || tokenRecuperacao) && (
          <div className="modal-backdrop">
            <form className="recovery-dialog" onSubmit={tokenRecuperacao ? redefinirSenha : solicitarRecuperacao}>
              <button
                type="button"
                className="close-btn"
                onClick={() => {
                  setRecuperacaoAberta(false);
                  setTokenRecuperacao("");
                }}
              >
                ×
              </button>
              {tokenRecuperacao ? (
                <>
                  <h2>Definir nova senha</h2>
                  <p>Crie uma senha com pelo menos 6 caracteres.</p>
                  <label>
                    Nova senha
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={novaSenha}
                      onChange={(e) => setNovaSenha(e.target.value)}
                    />
                  </label>
                  <label>
                    Confirmar senha
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={confirmacaoNovaSenha}
                      onChange={(e) => setConfirmacaoNovaSenha(e.target.value)}
                    />
                  </label>
                  <button className="primary-btn full">Salvar nova senha</button>
                </>
              ) : (
                <>
                  <h2>Recuperar senha</h2>
                  <p>Informe seu e-mail para receber as instruções.</p>
                  <input
                    type="email"
                    required
                    value={emailRecuperacao}
                    onChange={(e) => setEmailRecuperacao(e.target.value)}
                    placeholder="voce@email.com"
                  />
                  <button className="primary-btn full">Enviar instruções</button>
                </>
              )}
            </form>
          </div>
        )}
        {emailJaCadastrado && (
          <div className="account-conflict-backdrop">
            <div
              className="account-conflict"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="email-cadastrado-titulo"
            >
              <span className="conflict-mark">!</span>
              <h2 id="email-cadastrado-titulo">E-mail já cadastrado</h2>
              <p>Este e-mail já foi cadastrado no site. Entre com sua conta para continuar.</p>
              <button
                className="primary-btn full"
                onClick={() => {
                  setEmailJaCadastrado(false);
                  setModoCadastro(false);
                  setMensagem("");
                }}
              >
                Ir para o login
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="container nav">
          <div className="brand">Loja Tech</div>
          <nav>
            <a href="#produtos">Produtos</a>
            <a href="#destaques">Destaques</a>
            <a href="#sobre">Sobre</a>
            {usuario ? (
              <button
                className="account-toggle"
                aria-label="Abrir minha conta"
                title="Minha conta"
                onClick={() => {
                  setContaAberta(true);
                  carregarConta();
                }}
              >
                <UserRound size={17} />
              </button>
            ) : (
              <button className="account-toggle login-toggle" onClick={() => setTelaLogin(true)}>
                <LogIn size={17} /> Entrar
              </button>
            )}
            <button
              className="theme-toggle"
              aria-label={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
              title={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
              onClick={() => setTema(tema === "claro" ? "escuro" : "claro")}
            >
              {tema === "claro" ? <Moon size={17} strokeWidth={2} /> : <Sun size={17} strokeWidth={2} />}
            </button>
            <button
              className="cart-toggle"
              aria-label="Abrir carrinho"
              title="Abrir carrinho"
              onClick={() => setCarrinhoAberto(true)}
            >
              <ShoppingBag className="icon-cart" size={17} strokeWidth={2} />
              <span>{quantidadeCarrinho}</span>
            </button>
            {usuario && (
              <button
                className="logout-btn"
                aria-label="Sair da conta"
                title="Sair da conta"
                onClick={() => setConfirmarSaida(true)}
              >
                <LogOut size={17} strokeWidth={2} />
              </button>
            )}
          </nav>
        </div>
      </header>

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
            <article key={produto.id} className="product-card featured" onClick={() => abrirProduto(produto)}>
              <img src={produto.imagem} alt={produto.nome} />
              <div className="product-body">
                <span className="tag">{produto.categoria}</span>
                <h4>{produto.nome}</h4>
                <p>{produto.descricao}</p>
                <div className="card-bottom">
                  <strong>{formatarMoeda(produto.preco)}</strong>
                  <div className="card-actions">
                    <button
                      className="favorite-btn"
                      aria-label={favoritos.includes(produto.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                      aria-pressed={favoritos.includes(produto.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        alternarFavorito(produto.id);
                      }}
                    >
                      <Heart size={17} fill={favoritos.includes(produto.id) ? "currentColor" : "none"} />
                    </button>
                    <button
                      className="small-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        adicionarAoCarrinho(produto);
                      }}
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>

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

        {loading ? (
          <p className="loading">Carregando catálogo...</p>
        ) : (
          <section className="catalog-grid">
            {produtosFiltrados.map((produto) => (
              <article key={produto.id} className="product-card" onClick={() => abrirProduto(produto)}>
                <img src={produto.imagem} alt={produto.nome} />
                <div className="product-body">
                  <span className="tag">{produto.categoria}</span>
                  <h4>{produto.nome}</h4>
                  <p>{produto.descricao}</p>
                  <div className="card-bottom">
                    <strong>{formatarMoeda(produto.preco)}</strong>
                    <div className="card-actions">
                      <button
                        className="favorite-btn"
                        aria-label={
                          favoritos.includes(produto.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"
                        }
                        aria-pressed={favoritos.includes(produto.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          alternarFavorito(produto.id);
                        }}
                      >
                        <Heart size={17} fill={favoritos.includes(produto.id) ? "currentColor" : "none"} />
                      </button>
                      <button
                        className="small-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          adicionarAoCarrinho(produto);
                        }}
                      >
                        Adicionar
                      </button>
                    </div>
                  </div>
                </div>
              </article>
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
                <article key={produto.id} className="product-card compact" onClick={() => abrirProduto(produto)}>
                  <img src={produto.imagem} alt={produto.nome} />
                  <div className="product-body">
                    <h4>{produto.nome}</h4>
                    <strong>{formatarMoeda(produto.preco)}</strong>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {mensagem && (
        <div className="toast-message" role="status">
          {mensagem}
        </div>
      )}

      {carrinhoAberto && (
        <div className="cart-backdrop" onClick={() => setCarrinhoAberto(false)}>
          <aside className="cart-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cart-header">
              <div>
                <span className="eyebrow">Sua seleção</span>
                <h3>Meu carrinho</h3>
              </div>
              <button className="close-btn" onClick={() => setCarrinhoAberto(false)}>
                ×
              </button>
            </div>
            {carrinho.length === 0 ? (
              <p className="cart-empty">
                Seu carrinho está vazio.
                <br />
                Escolha um produto para começar.
              </p>
            ) : (
              <>
                <div className="cart-items">
                  {carrinho.map((item) => (
                    <div className="cart-item" key={item.id}>
                      <img src={item.imagem} alt={item.nome} />
                      <div className="cart-item-info">
                        <strong>{item.nome}</strong>
                        <span>{formatarMoeda(item.preco)}</span>
                        <div className="quantity-controls">
                          <button onClick={() => alterarQuantidade(item.id, -1)}>-</button>
                          <b>{item.quantidadeCarrinho}</b>
                          <button onClick={() => alterarQuantidade(item.id, 1)}>+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cart-summary">
                  <span>Subtotal</span>
                  <strong>{formatarMoeda(totalCarrinho)}</strong>
                  <small>Frete grátis acima de R$ 150,00. Descontos e frete são calculados no checkout.</small>
                </div>
                <input
                  className="coupon-input"
                  value={codigoCupom}
                  onChange={(e) => {
                    const valor = e.target.value.toUpperCase();
                    setCodigoCupom(valor);
                    if (!valor.trim()) {
                      setCupomStatus({ tipo: "idle", mensagem: "" });
                    }
                  }}
                  placeholder="Cupom de desconto (opcional)"
                />
                {cuponsDisponiveis.length > 0 && (
                  <div className="coupon-list">
                    <span className="eyebrow">Cupons disponíveis</span>
                    <div className="coupon-pills">
                      {cuponsDisponiveis.map((cupom) => (
                        <button
                          key={cupom.codigo}
                          type="button"
                          className="coupon-pill"
                          onClick={() => {
                            setCodigoCupom(cupom.codigo);
                            setCupomStatus({ tipo: "idle", mensagem: "" });
                          }}
                        >
                          {cupom.codigo}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {cupomStatus.mensagem && (
                  <p className={`coupon-feedback ${cupomStatus.tipo === "erro" ? "error" : "success"}`}>
                    {cupomStatus.mensagem}
                  </p>
                )}
                <select
                  className="coupon-input"
                  value={metodoPagamento}
                  onChange={(e) => setMetodoPagamento(e.target.value)}
                  aria-label="Forma de pagamento"
                >
                  <option value="pix">Pix</option>
                  <option value="cartao">Cartão (simulado)</option>
                  <option value="boleto">Boleto (simulado)</option>
                </select>
                <button className="primary-btn full" disabled={processandoPedido} onClick={abrirResumoCompra}>
                  {processandoPedido ? "Confirmando pedido..." : "Revisar pedido"}
                </button>
              </>
            )}
          </aside>
        </div>
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
            <p>Sua sessão será encerrada neste dispositivo.</p>
            <div className="confirm-actions">
              <button className="secondary-btn" onClick={() => setConfirmarSaida(false)}>
                Cancelar
              </button>
              <button className="primary-btn" onClick={sair}>
                Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {produtoSelecionado && (
        <div className="modal-backdrop" onClick={() => setProdutoSelecionado(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setProdutoSelecionado(null)}>
              ×
            </button>
            <div className="modal-grid">
              <img src={produtoSelecionado.imagem} alt={produtoSelecionado.nome} />
              <div>
                <span className="tag">{produtoSelecionado.categoria}</span>
                <h3>{produtoSelecionado.nome}</h3>
                <p className="modal-price">{formatarMoeda(produtoSelecionado.preco)}</p>
                <p>{produtoSelecionado.descricao}</p>
                <ul className="feature-list">
                  <li>Estoque disponível: {produtoSelecionado.quantidade}</li>
                  <li>Entrega em até 5 dias úteis</li>
                  <li>Pagamento seguro e suporte especializado</li>
                </ul>
                <div className="review-form">
                  <strong>Avaliações ({avaliacoes.length})</strong>
                  {avaliacoes.length ? (
                    <div className="review-list">
                      {avaliacoes.map((avaliacao) => (
                        <article key={`${avaliacao.nome}-${avaliacao.criado_em}`}>
                          <div>
                            <strong>{avaliacao.nome}</strong>
                            <span>
                              {"★".repeat(avaliacao.nota)}
                              {"☆".repeat(5 - avaliacao.nota)}
                            </span>
                          </div>
                          {avaliacao.comentario && <p>{avaliacao.comentario}</p>}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="review-empty">Ainda não há avaliações para este produto.</p>
                  )}
                  {usuario ? (
                    <>
                      <strong>Avalie este produto</strong>
                      <div>
                        <label>
                          Nota{" "}
                          <select value={notaAvaliacao} onChange={(e) => setNotaAvaliacao(Number(e.target.value))}>
                            {[5, 4, 3, 2, 1].map((nota) => (
                              <option key={nota} value={nota}>
                                {"★".repeat(nota)}
                                {"☆".repeat(5 - nota)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <textarea
                        value={comentarioAvaliacao}
                        onChange={(e) => setComentarioAvaliacao(e.target.value)}
                        maxLength={600}
                        placeholder="Conte sua experiência (opcional)"
                      />
                      <button className="secondary-btn" type="button" onClick={enviarAvaliacao}>
                        Enviar avaliação
                      </button>
                    </>
                  ) : (
                    <button className="secondary-btn" type="button" onClick={enviarAvaliacao}>
                      Entre para avaliar
                    </button>
                  )}
                </div>
                <button
                  className="primary-btn full"
                  onClick={() => {
                    adicionarAoCarrinho(produtoSelecionado);
                    setProdutoSelecionado(null);
                  }}
                >
                  Adicionar ao carrinho
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {contaAberta && (
        <div className="modal-backdrop" onClick={() => setContaAberta(false)}>
          <section
            className="account-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-conta"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="close-btn" onClick={() => setContaAberta(false)}>
              ×
            </button>
            <span className="eyebrow">MINHA CONTA</span>
            <h3 id="titulo-conta">Olá, {usuario?.nome ?? "cliente"} 👋</h3>
            {!dadosConta ? (
              <p className="loading">Carregando sua conta...</p>
            ) : (
              <div className="account-grid">
                <div>
                  <h4>Meus pedidos</h4>
                  {dadosConta.pedidos.length ? (
                    <div className="order-list">
                      {dadosConta.pedidos.map((pedido) => (
                        <article key={String(pedido.id)} className="order-card">
                          <strong>#{String(pedido.id).slice(0, 8)}</strong>
                          <span>{String(pedido.status)}</span>
                          <b>{formatarMoeda(Number(pedido.total_final))}</b>
                          <small>
                            {String(pedido.metodo_pagamento ?? "pix").toUpperCase()} ·{" "}
                            {String(pedido.status_pagamento ?? "pendente")}
                          </small>
                          <div>
                            {Array.isArray(pedido.itens) &&
                              pedido.itens.map((item: Record<string, unknown>) => (
                                <p key={String(item.produto_id)}>
                                  {Number(item.quantidade)}× {String(item.nome)}
                                </p>
                              ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p>Você ainda não fez pedidos.</p>
                  )}
                </div>
                <div>
                  <h4>Endereço de entrega</h4>
                  <form className="address-form" onSubmit={salvarEndereco}>
                    {(
                      [
                        ["cep", "CEP"],
                        ["rua", "Rua"],
                        ["numero", "Número"],
                        ["complemento", "Complemento"],
                        ["bairro", "Bairro"],
                        ["cidade", "Cidade"],
                        ["estado", "UF"],
                      ] as const
                    ).map(([campo, rotulo]) => (
                      <label key={campo}>
                        {rotulo}
                        <input
                          name={campo}
                          defaultValue={dadosConta.perfil[campo] ?? ""}
                          onBlur={campo === "cep" ? consultarCep : undefined}
                          inputMode={campo === "cep" ? "numeric" : undefined}
                          maxLength={campo === "cep" ? 9 : campo === "estado" ? 2 : undefined}
                          required={!["complemento"].includes(campo)}
                        />
                      </label>
                    ))}
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={obterLocalizacao}
                      disabled={buscandoLocalizacao}
                    >
                      {buscandoLocalizacao ? "Buscando localização..." : "Usar minha localização"}
                    </button>
                    <button className="primary-btn" type="submit">
                      Salvar endereço
                    </button>
                  </form>
                  <h4>Favoritos</h4>
                  <p>
                    {dadosConta.favoritos.length
                      ? dadosConta.favoritos.map((produto) => produto.nome).join(", ")
                      : "Nenhum favorito salvo."}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {resumoPedido && (
        <div className="confirm-backdrop" onClick={() => setResumoPedido(null)}>
          <section
            className="payment-summary"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">Resumo do pedido</span>
            <h2>Confirme sua compra</h2>
            <div className="summary-list">
              <div>
                <span>Produtos</span>
                <strong>{formatarMoeda(resumoPedido.subtotal)}</strong>
              </div>
              <div>
                <span>Frete</span>
                <strong>{resumoPedido.frete === 0 ? "Gratis" : formatarMoeda(resumoPedido.frete)}</strong>
              </div>
              <div>
                <span>Desconto</span>
                <strong>- {formatarMoeda(resumoPedido.desconto)}</strong>
              </div>
              <div>
                <span>Cupom</span>
                <strong>{resumoPedido.cupom}</strong>
              </div>
              <div>
                <span>Método</span>
                <strong>{resumoPedido.metodo.toUpperCase()}</strong>
              </div>
              <div className="summary-total">
                <span>Total final</span>
                <strong>{formatarMoeda(resumoPedido.total)}</strong>
              </div>
            </div>
            <div className="confirm-actions">
              <button className="secondary-btn" type="button" onClick={() => setResumoPedido(null)}>
                Voltar
              </button>
              <button className="primary-btn" type="button" disabled={processandoPedido} onClick={confirmarPedido}>
                {processandoPedido ? "Confirmando..." : "Confirmar compra"}
              </button>
            </div>
          </section>
        </div>
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
            <button className="primary-btn full" onClick={() => setPedidoConfirmado(null)}>
              Continuar comprando
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
