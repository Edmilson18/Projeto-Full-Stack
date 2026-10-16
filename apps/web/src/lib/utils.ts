import type { MinhaAvaliacao, PedidoResponse, ProdutoResponse } from "@loja/shared";

export const formatarMoeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

/**
 * Texto em minúsculas e sem acento, para comparar e buscar.
 *
 * `toLowerCase` sozinho só resolve caixa: "Ergonômica" continua com o acento, e
 * quem digita "ergonomica" — sem acento, como quase todo mundo digita — não
 * encontra nada. A comparação por `includes` é literal, então o acento decide
 * entre achar e não achar.
 *
 * `NFD` decompõe "ô" em "o" + acento combinante, e o `Diacritic` remove o
 * caractere sobrando. O resultado é que acento vale pouco: "cadeira ergonomica"
 * acha "Cadeira Ergonômica", e "acao" acha "Ação".
 *
 * A ordem importa: normalizar antes de remover os diacríticos é o que permite
 * o `/u` casar o caractere combinante.
 */
export const normalizar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");

/**
 * Aceita qualquer coisa com `imagem` e `nome`, e não só `ProdutoResponse`: os
 * favoritos e os "vistos recentemente" chegam como `ProdutoSemCategoria`, que é o
 * mesmo produto sem o campo `categoria`.
 *
 * Quando o produto tem foto, ela manda. Quando não tem, vem um desenho gerado
 * do próprio produto — e não mais uma foto genérica escolhida por índice.
 *
 * A versão antiga pegava a foto por posição na lista local, e era isso que
 * produzia as trocas: a cadeira aparecia com a foto de uma placa-mãe, porque a
 * cadeira e a placa-mãe ocupavam o mesmo índice em listas diferentes. Além de
 * errar, a foto mudava conforme a seção da tela, o filtro de busca ou a ordem
 * dos favoritos.
 */
export const imagemDe = (produto: Pick<ProdutoResponse, "imagem" | "nome">): string =>
  produto.imagem?.trim() ? produto.imagem : desenhoDoProduto(produto.nome);

/**
 * Desenho de reserva: o ícone do próprio produto, na linguagem de linha do
 * `lucide` que o resto da interface já usa.
 *
 * É um SVG embutido como `data:` — não depende de arquivo nem de rede, e nunca
 * quebra. Escrever "sem foto" no lugar deixava a vitrine com aparência de
 * defeito; o ícone mostra o que o produto é.
 *
 * A escolha vem do **nome**, e não da categoria: os favoritos e os vistos
 * recentemente chegam sem `categoria`, e foi por isso que a foto antiga ficava
 * errada. O nome está sempre presente.
 */
function desenhoDoProduto(nome: string): string {
  // Tons do tema: cinza, verde-lima e areia, todos legíveis com tinta escura.
  const tons = ["#e7e4dc", "#dbe8b4", "#e8ddc9", "#dde3e6"];
  const fundo = tons[indiceDeCor(nome)] ?? tons[0]!;
  const icone = iconeDoProduto(nome);

  // Ícone e sigla são dois formatos diferentes, não o mesmo formato com textos
  // trocados: texto solto dentro de `<g>` não desenha nada, então a sigla
  // precisa do próprio elemento `<text>`.
  const conteudo = icone
    ? `<g transform="translate(120 60) scale(6.5)" fill="none" stroke="#17202b" stroke-opacity="0.5"
 stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icone}</g>`
    : `<text x="200" y="196" font-family="Manrope, sans-serif" font-size="96" font-weight="800"
 fill="#17202b" fill-opacity="0.45" text-anchor="middle">${siglaDe(nome)}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<rect width="400" height="300" fill="${fundo}"/>
${conteudo}
</svg>`;

  // `encodeURIComponent` cobre os caracteres que o SVG exige literais: as
  // aspas nos atributos e o `#` das cores. Sem isso o navegador leria o
  // atributo só até o primeiro espaço.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Ícone do produto, escolhido por palavra-chave no nome.
 *
 * A ordem importa: "cadeira" antes de "cadeira de rodinha" não faz diferença,
 * mas "headset" precisa ser testado antes de qualquer regra genérica de áudio.
 * Nenhuma regra aqui depende de a palavra estar na posição 0, porque nome de
 * produto costuma trazer adjetivo antes ("Mouse Gamer", "Teclado Mecânico").
 */
function iconeDoProduto(nome: string): string | null {
  const n = normalizar(nome);

  if (n.includes("teclado") || n.includes("keyboard")) return iconeTeclado();
  if (n.includes("mouse")) return iconeMouse();
  if (n.includes("monitor") || n.includes("display") || n.includes("tela")) return iconeMonitor();
  if (n.includes("cadeira") || n.includes("poltrona")) return iconeCadeira();
  if (n.includes("headset") || n.includes("fone") || n.includes("headphone")) return iconeHeadset();
  if (n.includes("camera") || n.includes("webcam") || n.includes("monitoramento")) return iconeCamera();

  return null;
}

/** Desenhos em viewBox 24x24, como os ícones do lucide. */

function iconeTeclado(): string {
  // Teclas desenhadas como pontos: mais legível que um quadriculado de
  // retângulos quando o ícone é pequeno.
  const teclas = [
    [4, 7],
    [8, 7],
    [12, 7],
    [16, 7],
    [4, 10],
    [8, 10],
    [12, 10],
    [16, 10],
    [4, 13],
    [8, 13],
    [12, 13],
    [16, 13],
    [7, 16],
    [12, 16],
  ]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="2.4" height="2.4" rx="0.5"/>`)
    .join("");
  return `<rect x="2" y="5" width="20" height="14" rx="2.5"/>${teclas}`;
}

function iconeMouse(): string {
  return `<rect x="6" y="2.5" width="12" height="19" rx="6"/>
<path d="M12 2.5v6"/>
<path d="M6 9h12"/>`;
}

function iconeMonitor(): string {
  return `<rect x="2.5" y="4" width="19" height="12.5" rx="2"/>
<path d="M9 20.5h6"/>
<path d="M12 16.5v4"/>`;
}

function iconeCadeira(): string {
  // Encosto, assento e base em pé: o que diferencia uma cadeira de escritório
  // de uma poltrona.
  return `<path d="M7 3.5h4a3 3 0 0 1 3 3v5H7z"/>
<path d="M5 11.5h13a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2z"/>
<path d="M12 16.5v3"/>
<path d="M7.5 20.5h9"/>
<path d="M12 19.5 9 21.5M12 19.5l3 2"/>`;
}

function iconeHeadset(): string {
  return `<path d="M4 14v-2a8 8 0 0 1 16 0v2"/>
<path d="M4 13h1.5a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 5.5 19H5a1 1 0 0 1-1-1z"/>
<path d="M20 13h-1.5a1.5 1.5 0 0 0-1.5 1.5v3a1.5 1.5 0 0 0 1.5 1.5h.5a1 1 0 0 0 1-1z"/>
<path d="M17.5 19v.5a2.5 2.5 0 0 1-2.5 2.5H13"/>`;
}

function iconeCamera(): string {
  return `<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2l1.2-2h6.6L16.5 6h2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>
<circle cx="12" cy="13" r="3.5"/>`;
}

/**
 * Escolhe um tom a partir do nome, de forma estável.
 *
 * `for...of` percorre por ponto de código, então um acento conta como uma
 * letra só — o mesmo que o spread faria, sem a ressalva de dividir caractere
 * composto. O nome já entra normalizado, o que mantém a cor igual entre
 * "Cadeira" e "cadeira".
 */
function indiceDeCor(nome: string, total = 4): number {
  let soma = 0;
  for (const letra of normalizar(nome)) soma += letra.codePointAt(0) ?? 0;
  return soma % total;
}

/**
 * Sigla do produto, usada só quando o nome não casa com nenhum ícone.
 *
 * Duas letras do começo errariam feio: "Mouse Gamer" e "Monitor Gamer" dariam
 * as duas "MG". Pegar as pontas separa esse par — "mouse" vira "ME" e "monitor"
 * vira "MR" — sem depender de posição nenhuma no nome.
 *
 * A sigla **não** é identificador único, e não pretende ser: "Cadeira" e
 * "Câmera" dão as duas "CA". Nenhum esquema de duas letras resolve isso num
 * catálogo com nomes parecidos. É por isso que os dois têm ícone próprio, e a
 * sigla é só o último recurso.
 */
function siglaDe(nome: string): string {
  const primeira = normalizar(nome).split(/\s+/).find(Boolean);
  if (!primeira) return "?";

  const inicio = primeira[0]!;
  // Nome de uma letra só não tem "última letra": usa a mesma nos dois lugares.
  const fim = primeira.length > 1 ? primeira[primeira.length - 1]! : inicio;
  return (inicio + fim).toUpperCase();
}

/**
 * Data da última compra do produto que não foi cancelada, em milissegundos.
 *
 * `Date.parse` e não comparação de texto: as duas datas vêm do mesmo banco e
 * no mesmo formato, mas comparar string ISO funciona só por acidente enquanto
 * os formatos coincidirem.
 */
function ultimaCompra(pedidos: readonly PedidoResponse[], produtoId: string): number | null {
  const datas = pedidos
    .filter(
      (pedido) =>
        pedido.status !== "cancelado" &&
        (pedido.criado_em ?? "") !== "" &&
        (pedido.itens ?? []).some((item) => item.produto_id === produtoId),
    )
    .map((pedido) => Date.parse(pedido.criado_em ?? ""))
    .filter((tempo) => !Number.isNaN(tempo));

  return datas.length > 0 ? Math.max(...datas) : null;
}

/**
 * Diz se a pessoa pode avaliar o produto **agora**.
 *
 * Avaliar não é um direito permanente de quem comprou uma vez: é uma janela que
 * abre a cada compra e fecha assim que a nota é enviada. Comprou e nunca
 * avaliou, pode. Avaliou, não pode de novo — a menos que compre outra vez, e
 * aí a janela reabre para atualizar a nota.
 *
 * Por isso a comparação é entre a data da última compra e a data da avaliação,
 * e não apenas "tem compra registrada". Sem isso, o mesmo produto aceitaria
 * nota nova toda vez que a pessoa recarregasse a página.
 *
 * Espelha `podeAvaliarProduto` no servidor. O servidor é quem decide de
 * verdade; isto serve para o formulário aparecer travado com o motivo, e não
 * escondido — escondido a pessoa conclui que a página quebrou.
 */
export const podeAvaliar = (
  pedidos: readonly PedidoResponse[],
  minhasAvaliacoes: readonly MinhaAvaliacao[],
  produtoId: string,
): boolean => {
  const compra = ultimaCompra(pedidos, produtoId);
  if (compra === null) return false;

  const minha = minhasAvaliacoes.find((avaliacao) => avaliacao.produto_id === produtoId);
  const avaliouEm = minha?.criado_em ? Date.parse(minha.criado_em) : Number.NaN;

  // Sem avaliação registrada, ou com avaliação anterior à última compra, a
  // janela está aberta.
  return Number.isNaN(avaliouEm) || avaliouEm < compra;
};
