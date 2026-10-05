import { describe, it, expect } from "vitest";
import { normalizar } from "../../lib/utils.js";

/**
 * A busca do catálogo compara com `includes`, que é literal. Se a normalização
 * não tirar acento e caixa, o usuário precisa digitar o nome exatamente como está
 * cadastrado — "Cadeira Ergonômica" com maiúsculas e acento.
 */
describe("normalizar", () => {
  it("tira o acento", () => {
    expect(normalizar("Ergonômica")).toBe("ergonomica");
    expect(normalizar("Cadeira Ergonômica")).toBe("cadeira ergonomica");
  });

  it("baixa a caixa", () => {
    expect(normalizar("CADEIRA ERGONÔMICA")).toBe("cadeira ergonomica");
  });

  it("resolve o caso real: busca sem acento acha o nome com acento", () => {
    const nome = "Cadeira Ergonômica";
    const digitado = "cadeira ergonomica";
    expect(nome.includes(digitado)).toBe(false);
    expect(normalizar(nome).includes(normalizar(digitado))).toBe(true);
  });

  it("trata os outros acentos do português", () => {
    // Ç, ã, é, í, ó, ú e â aparecem nos produtos da loja.
    expect(normalizar("Câmera de Segurança 4K")).toBe("camera de seguranca 4k");
    expect(normalizar("Mouse Gamer")).toBe("mouse gamer");
    expect(normalizar("Informática")).toBe("informatica");
    expect(normalizar("Eletrônicos")).toBe("eletronicos");
  });

  it("resolve a trema do ç, que não é diacrítico combinante", () => {
    // `NFD` não decompõe o cedilha; vem de `latin1`. Sem este caso, "coracao"
    // continuaria sem achar "Coração".
    expect(normalizar("Coração")).toBe("coracao");
  });

  it("não altera texto sem acento", () => {
    expect(normalizar("Mouse Gamer HyperX")).toBe("mouse gamer hyperx");
  });

  it("mantém o texto vazio e o espaço", () => {
    expect(normalizar("")).toBe("");
    expect(normalizar("   ")).toBe("   ");
  });
});
