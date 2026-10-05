import type { ProdutoResponse } from "@loja/shared";

const imagensPadrao = [
  "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1585386959984-a4155224a1ad?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1491553895911-0055eca6402d?auto=format&fit=crop&w=900&q=80",
];

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
 * Aceita qualquer coisa com `imagem`, e não só `ProdutoResponse`: os favoritos e os
 * "vistos recentemente" chegam como `ProdutoSemCategoria`, que é o mesmo produto
 * sem o campo `categoria`. Como a imagem é escolhida só pelo `imagem` do
 * produto, exigir o tipo inteiro aqui só empurraria um `as` para o chamador.
 */
export const imagemDe = (produto: Pick<ProdutoResponse, "imagem">, indice = 0): string =>
  produto.imagem ?? imagensPadrao[indice % imagensPadrao.length] ?? imagensPadrao[0]!;
