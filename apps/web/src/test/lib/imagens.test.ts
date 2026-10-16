import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * O contrato das fotos dos produtos.
 *
 * O defeito que estes testes travam: as fotos vieram com proporções diferentes
 * entre si (a cadeira 0,75, o teclado 1,51) e o cartão do produto tem caixa
 * fixa. Com `cover` a caixa preenchia cortando as pontas, e o corte caía em
 * cima do produto — o teclado virava uma faixa de teclas e a cadeira perdia o
 * encosto. A saída foi acertar os arquivos, não a caixa.
 *
 * Sem teste, o defeito volta na próxima foto que alguém soltar na pasta: é um
 * problema visual, e problema visual não quebra build nem suíte de API.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const pastaImagens = path.resolve(aqui, "../../../public/imagens");
// Cinco níveis: `lib/` -> `test/` -> `src/` -> `web/` -> `apps/` -> raiz.
const arquivoSeed = path.resolve(aqui, "../../../../../apps/api/src/seed.ts");

/**
 * Lê largura e altura de um JPEG sem dependência externa.
 *
 * O SOI do JPEG é seguido dos marcadores; o marcador SOFn (0xFFC0 a 0xFFCF,
 * menos C4/C8/CC, que não são SOF) carrega altura e largura em big endian.
 */
function dimensoesJpeg(arquivo: string): { largura: number; altura: number } {
  const buffer = readFileSync(arquivo);
  let posicao = 2; // pula o SOI (FFD8)

  while (posicao < buffer.length - 1) {
    if (buffer[posicao] !== 0xff) {
      posicao++;
      continue;
    }
    const marcador = buffer[posicao + 1]!;
    // Marcadores sem payload: avançam um byte só.
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      posicao += 2;
      continue;
    }
    const tamanho = buffer.readUInt16BE(posicao + 2);
    const eSOf = marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador);
    if (eSOf) {
      return { altura: buffer.readUInt16BE(posicao + 5), largura: buffer.readUInt16BE(posicao + 7) };
    }
    posicao += 2 + tamanho;
  }

  throw new Error(`Não achei as dimensões de ${arquivo}.`);
}

const fotos = readdirSync(pastaImagens).filter((nome) => nome.endsWith(".jpg"));

describe("fotos dos produtos", () => {
  it("tem foto para todo produto do seed, e o caminho existe de verdade", () => {
    // Um arquivo renomeado ou apagado só apareceria como foto quebrada na loja,
    // e a API devolveria 200 do mesmo jeito — o teste é a única hora que isso
    // aparece antes de alguém abrir a página.
    const caminhos = [...readFileSync(arquivoSeed, "utf8").matchAll(/"\/imagens\/([^"]+)"/g)].map((m) => m[1]!);

    expect(caminhos.length).toBeGreaterThan(0);
    for (const caminho of caminhos) {
      expect(existsSync(path.join(pastaImagens, caminho)), `falta a foto ${caminho}`).toBe(true);
    }
  });

  it("é quadrada, para o cartão não cortar o produto", () => {
    // O banner de topo é a exceção: ele vive numa caixa deitada, e é 3:2.
    const produtos = fotos.filter((nome) => nome !== "banner.jpg");

    expect(produtos.length).toBeGreaterThan(0);
    for (const nome of produtos) {
      const { largura, altura } = dimensoesJpeg(path.join(pastaImagens, nome));
      expect(largura, `${nome} é ${largura}x${altura} e o cartão é quadrado`).toBe(altura);
    }
  });
});
