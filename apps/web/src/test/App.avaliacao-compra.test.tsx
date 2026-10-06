import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App.js";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();

vi.mock("../lib/api.js", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: vi.fn(),
  },
}));

const USUARIO = { id: "u1", nome: "Cliente", email: "cliente@exemplo.com", role: "cliente" };

const PRODUTOS = [
  {
    id: "prod-cadeira",
    nome: "Cadeira Ergonômica Flexform",
    descricao: "Conforto",
    preco: 1200,
    quantidade: 10,
    categoria: "cat-moveis",
  },
];

/**
 * Resposta de `/conta`.
 *
 * Tipada como `Conta` para o `pedidos` trocar de `[]` para um pedido com itens:
 * sem a anotação o TypeScript fixa o tipo no `never[]` do literal inicial e
 * passa a recusar a troca — que é exatamente a parte que o teste precisa mudar.
 */
type Conta = {
  perfil: { nome: string };
  pedidos: Array<{
    id: string;
    status: string;
    criado_em: string | null;
    itens: Array<{ produto_id: string; nome: string; quantidade: number; preco_unitario: number; subtotal: number }>;
  }>;
  favoritos: unknown[];
  minhasAvaliacoes: Array<{
    produto_id: string;
    nota: number;
    comentario: string | null;
    criado_em: string | null;
  }>;
};

const CONTA_SEM_PEDIDO: Conta = {
  perfil: { nome: "Cliente" },
  pedidos: [],
  favoritos: [],
  minhasAvaliacoes: [],
};

/**
 * Relógio do teste: cada evento (compra, avaliação) avança uma hora.
 *
 * A regra compara a data da última compra com a data da avaliação, então um
 * mock com datas fixas não consegue representar a sequência que importa —
 * avaliar e depois comprar de novo. O relógio dá essa ordem sem sleeps.
 */
function criarRelogio() {
  let minutos = 0;
  return {
    /** Instante corrente e avança em uma hora. */
    agora() {
      const instante = new Date(Date.UTC(2026, 9, 1, 12, minutos)).toISOString();
      minutos += 60;
      return instante;
    },
  };
}

/** Resposta de `/conta` com um pedido que contém o produto comprado. */
function contaComCompra(produtoId: string, em: string, minhaAvaliacao?: Conta["minhasAvaliacoes"]): Conta {
  return {
    perfil: { nome: "Cliente" },
    pedidos: [
      {
        id: `PED-${em}`,
        status: "processando",
        criado_em: em,
        itens: [{ produto_id: produtoId, nome: "Cadeira", quantidade: 1, preco_unitario: 1200, subtotal: 1200 }],
      },
    ],
    favoritos: [],
    minhasAvaliacoes: minhaAvaliacao ?? [],
  };
}

/**
 * Deixa `/conta` sem pedido. A troca para `contaComCompra` no meio do teste é
 * o que simula o servidor respondendo à recarga: é assim que o bug aparecia —
 * a compra existia, mas a tela continuava com a conta antiga em memória.
 */
function montarApi() {
  get.mockReset();
  post.mockReset();
  put.mockReset();

  const relogio = criarRelogio();
  let conta: Conta = CONTA_SEM_PEDIDO;
  // Data da compra em curso, para o pedido novo sair depois da avaliação.
  let compraEm: string | null = null;

  get.mockImplementation((url: string) => {
    if (url === "/sessao") return Promise.resolve({ usuario: USUARIO });
    if (url === "/produtos") return Promise.resolve(PRODUTOS);
    if (url === "/conta") return Promise.resolve(conta);
    if (url.startsWith("/avaliacoes/")) return Promise.resolve([]);
    return Promise.resolve([]);
  });

  post.mockImplementation((url: string) => {
    if (url === "/pedidos") {
      // O servidor já tem a compra; a recarga de `/conta` vai buscá-la. A data
      // é nova, então a janela reabre depois de uma avaliação.
      compraEm = relogio.agora();
      conta = contaComCompra("prod-cadeira", compraEm, conta.minhasAvaliacoes);
      return Promise.resolve({ pedido: { id: `PED-${compraEm}`, total_final: 1200 } });
    }
    if (url.startsWith("/avaliacoes/")) {
      // Como a API, avaliar substitui a nota anterior e passa a valer como
      // "já avaliado": a data agora é posterior à da compra.
      const produtoId = url.slice("/avaliacoes/".length);
      const corpo = post.mock.calls.find(([u]) => u === url)?.[1] as { nota?: number; comentario?: string } | undefined;
      const em = relogio.agora();
      conta = contaComCompra(produtoId, compraEm ?? em, [
        { produto_id: produtoId, nota: corpo?.nota ?? 5, comentario: corpo?.comentario ?? null, criado_em: em },
      ]);
      return Promise.resolve({ mensagem: "Avaliação registrada." });
    }
    return Promise.resolve({ mensagem: "ok" });
  });

  return {
    /** Simula a pessoa entrando na conta: um pedido já registrado. */
    comCompraJaFeita() {
      compraEm = relogio.agora();
      conta = contaComCompra("prod-cadeira", compraEm);
    },
    /**
     * Simula a pessoa que já deixou avaliação e depois comprou de novo: é a
     * situação em que a janela reabre para atualizar a nota.
     */
    comAvaliacaoPendente(nota: number, comentario: string | null = null) {
      const avaliouEm = relogio.agora();
      compraEm = relogio.agora();
      conta = contaComCompra("prod-cadeira", compraEm, [
        { produto_id: "prod-cadeira", nota, comentario, criado_em: avaliouEm },
      ]);
    },
  };
}

/**
 * Marcador de que o modal do produto está aberto. O texto vem em
 * `Avaliações (0)`, então precisa ser expressão regular — casa por substring.
 */
const AVALIACOES = /Avaliações \(/;

/** Abre o produto, que é onde fica o formulário de avaliação. */
async function abrirProduto() {
  // O card não é um `button`: é um `article` com `onClick`, então o clique vai
  // pelo texto do produto. Ele aparece na vitrine e na seção de destaques, daí
  // o `findAllByText` e o primeiro resultado.
  const [nome] = await screen.findAllByText("Cadeira Ergonômica Flexform");
  fireEvent.click(naoVazio(nome, "nome do produto na vitrine"));
  await screen.findByText(AVALIACOES);
}

/** Fecha o modal do produto pelo botão de fechar. */
async function fecharProduto() {
  fireEvent.click(naoVazio(screen.getAllByText("×")[0], "botão de fechar do modal"));
  await waitFor(() => expect(screen.queryByText(AVALIACOES)).not.toBeInTheDocument());
}

/**
 * `getAllBy*` devolve um array que o TypeScript vê como `T | undefined`.
 * Aqui a ausência é um erro de teste, não um caso a tratar — e como a
 * biblioteca já lança quando não acha nada, chegar ao `undefined` só acontece
 * com a lista vazia, o que a torna um erro também.
 */
function naoVazio<T>(valor: T | undefined, descricao: string): T {
  if (valor === undefined) throw new Error(`Teste: não encontrei ${descricao}.`);
  return valor;
}

/** Vai do produto até a confirmação do pedido: produto → carrinho → checkout. */
async function comprarPeloFluxoNormal() {
  // O botão de adicionar vive dentro do modal do produto, então ele precisa
  // estar aberto.
  await abrirProduto();
  fireEvent.click(await screen.findByRole("button", { name: "Adicionar ao carrinho" }));

  fireEvent.click(await screen.findByRole("button", { name: "Abrir carrinho" }));
  // "Comprar selecionados" só existe com pelo menos um item marcado.
  fireEvent.click(await screen.findByLabelText("Selecionar Cadeira Ergonômica Flexform"));
  fireEvent.click(await screen.findByRole("button", { name: /Comprar selecionados/ }));

  fireEvent.click(await screen.findByRole("button", { name: /Confirmar compra/ }));
}

/**
 * Regra: avaliação é de quem comprou. O que estes testes travam é a ordem das
 * coisas — a compra libera o formulário, e a tela precisa saber disso na hora.
 */
/** Renderiza o App e espera a sessão carregar. */
async function abrirAppLogado() {
  render(<App />);
  await screen.findByLabelText("Sair da conta");
}

describe("avaliação liberada pela compra", () => {
  beforeEach(() => {
    montarApi();
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it("começa travado para quem não comprou", async () => {
    await abrirAppLogado();

    await abrirProduto();

    expect(await screen.findByText(/A avaliação fica disponível logo após a compra/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar avaliação" })).not.toBeInTheDocument();
  });

  it("libera o formulário para quem comprou e ainda não avaliou", async () => {
    montarApi().comCompraJaFeita();
    await abrirAppLogado();

    await abrirProduto();

    expect(await screen.findByRole("button", { name: "Enviar avaliação" })).toBeInTheDocument();
    expect(screen.queryByText(/A avaliação fica disponível logo após a compra/)).not.toBeInTheDocument();
  });

  it("trava de novo logo depois de avaliar", async () => {
    await abrirAppLogado();
    await comprarPeloFluxoNormal();
    fireEvent.click(await screen.findByRole("button", { name: "Avaliar produtos" }));

    fireEvent.click(await screen.findByRole("button", { name: "3 estrelas" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar avaliação" }));
    await waitFor(() => expect(screen.queryByText("O que você achou?")).not.toBeInTheDocument());

    // A janela fecha ao avaliar: sem compra nova, o produto volta a ficar
    // travado. Era exatamente isso que faltava na regra anterior.
    await abrirProduto();

    expect(await screen.findByText(/A avaliação fica disponível logo após a compra/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar avaliação" })).not.toBeInTheDocument();
  });

  it("recarrega a conta depois de comprar, senão o formulário continua travado", async () => {
    await abrirAppLogado();
    await abrirProduto();
    expect(await screen.findByText(/A avaliação fica disponível logo após a compra/)).toBeInTheDocument();
    await fecharProduto();

    // Agora faz a compra pelo caminho normal: produto → carrinho → checkout.
    await comprarPeloFluxoNormal();

    // A compra happened; se a conta não recarregar, `/conta` continua sem o
    // pedido e o aviso de "só quem comprou" continua na tela.
    await waitFor(() => {
      const chamadas = get.mock.calls.filter(([url]) => url === "/conta");
      expect(chamadas.length).toBeGreaterThan(1);
    });

    await abrirProduto();

    expect(await screen.findByRole("button", { name: "Enviar avaliação" })).toBeInTheDocument();
    expect(screen.queryByText(/Só quem comprou/)).not.toBeInTheDocument();
  });

  it("abre a janela de avaliação logo após a confirmação da compra", async () => {
    await abrirAppLogado();
    await comprarPeloFluxoNormal();

    // Primeiro a confirmação do pagamento — o aviso de compra não pode ser
    // trocado pela avaliação antes de a pessoa saber que a compra passou.
    const confirmacao = await screen.findByText("Compra confirmada!");
    expect(confirmacao).toBeInTheDocument();
    expect(screen.queryByText("O que você achou?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Avaliar produtos" }));

    expect(await screen.findByText("O que você achou?")).toBeInTheDocument();
    // O nome também está no card atrás da janela, daí o `within`.
    const janela = within(screen.getByRole("dialog"));
    expect(janela.getByText("Cadeira Ergonômica Flexform")).toBeInTheDocument();
  });

  it("envia a nota escolhida e avisa uma vez só", async () => {
    await abrirAppLogado();
    await comprarPeloFluxoNormal();
    fireEvent.click(await screen.findByRole("button", { name: "Avaliar produtos" }));

    fireEvent.click(await screen.findByRole("button", { name: "4 estrelas" }));
    fireEvent.click(screen.getByRole("button", { name: /Enviar avaliação$/ }));

    await waitFor(() => {
      const enviados = post.mock.calls.filter(([url]) => String(url).startsWith("/avaliacoes/"));
      expect(enviados).toHaveLength(1);
      expect(enviados[0]?.[1]).toMatchObject({ nota: 4, comentario: "" });
    });
    expect(await screen.findByText("Avaliação enviada. Obrigado!")).toBeInTheDocument();
    // A janela fecha depois de enviar.
    await waitFor(() => expect(screen.queryByText("O que você achou?")).not.toBeInTheDocument());
  });

  it("não envia nada enquanto nenhuma nota foi escolhida", async () => {
    await abrirAppLogado();
    await comprarPeloFluxoNormal();
    fireEvent.click(await screen.findByRole("button", { name: "Avaliar produtos" }));

    // Sem nota marcada o botão fica desabilitado: pré-marcado em 5, qualquer
    // envio viraria nota máxima e a média deixaria de informar.
    const enviar = await screen.findByRole("button", { name: "Escolha uma nota" });
    expect(enviar).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Agora não" }));
    await waitFor(() => expect(screen.queryByText("O que você achou?")).not.toBeInTheDocument());
    expect(post.mock.calls.filter(([url]) => String(url).startsWith("/avaliacoes/"))).toHaveLength(0);
  });
});

/**
 * Comprar de novo não pode fazer a pessoa avaliar como se fosse a primeira vez.
 * A janela vem preenchida com a nota anterior e o botão passa a dizer
 * "atualizar" — é o único caminho para corrigir uma nota errada.
 */
describe("reavaliação após nova compra", () => {
  beforeEach(() => {
    montarApi();
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it("abre preenchida com a nota anterior e oferece atualizar", async () => {
    montarApi().comAvaliacaoPendente(2, "Demorou para chegar");

    await abrirAppLogado();
    await comprarPeloFluxoNormal();
    fireEvent.click(await screen.findByRole("button", { name: "Avaliar produtos" }));

    expect(await screen.findByText("Atualize sua avaliação")).toBeInTheDocument();
    expect(screen.getByText("Sua avaliação atual: 2 ★")).toBeInTheDocument();
    // O comentário anterior também volta, para não se perder o que já foi dito.
    expect(screen.getByLabelText("Comentário sobre Cadeira Ergonômica Flexform")).toHaveValue("Demorou para chegar");
    expect(screen.getByRole("button", { name: "Atualizar avaliação" })).toBeInTheDocument();
  });

  it("manda a nota nova no lugar da antiga", async () => {
    montarApi().comAvaliacaoPendente(1);

    await abrirAppLogado();
    await comprarPeloFluxoNormal();
    fireEvent.click(await screen.findByRole("button", { name: "Avaliar produtos" }));

    fireEvent.click(await screen.findByRole("button", { name: "5 estrelas" }));
    fireEvent.click(screen.getByRole("button", { name: "Atualizar avaliação" }));

    await waitFor(() => {
      const enviados = post.mock.calls.filter(([url]) => String(url).startsWith("/avaliacoes/"));
      expect(enviados).toHaveLength(1);
      expect(enviados[0]?.[1]).toMatchObject({ nota: 5 });
    });
  });

  it("deixa a nota vazia quando o produto ainda não foi avaliado", async () => {
    montarApi().comCompraJaFeita();

    await abrirAppLogado();
    await comprarPeloFluxoNormal();
    fireEvent.click(await screen.findByRole("button", { name: "Avaliar produtos" }));

    expect(await screen.findByText("O que você achou?")).toBeInTheDocument();
    expect(screen.queryByText(/Sua avaliação atual/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolha uma nota" })).toBeInTheDocument();
  });
});
