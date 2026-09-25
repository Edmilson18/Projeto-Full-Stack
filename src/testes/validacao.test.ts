import { describe, expect, it } from "vitest";
import { validarCadastro, validarProduto } from "../validacao.js";

const produtoValido = {
  nome: "Teclado Mecânico",
  preco: 599.9,
  quantidade: 15,
  categoriaId: "cat-informatica",
  descricao: "Switches lineares e iluminação RGB.",
  imagem: "https://exemplo.com/teclado.jpg",
};

describe("validarProduto", () => {
  it("aceita um produto completo e válido", () => {
    expect(validarProduto(produtoValido)).toBeNull();
  });

  it("exige nome com pelo menos 2 caracteres", () => {
    expect(validarProduto({ ...produtoValido, nome: "A" })).toMatch(/nome/i);
    expect(validarProduto({ ...produtoValido, nome: "  " })).toMatch(/nome/i);
  });

  it("exige uma categoria selecionada", () => {
    expect(validarProduto({ ...produtoValido, categoriaId: "  " })).toMatch(/categoria/i);
  });

  it("recusa preço negativo ou não numérico", () => {
    expect(validarProduto({ ...produtoValido, preco: -1 })).toMatch(/preço/i);
    expect(validarProduto({ ...produtoValido, preco: Number.NaN })).toMatch(/preço/i);
    expect(validarProduto({ ...produtoValido, preco: Number.POSITIVE_INFINITY })).toMatch(/preço/i);
  });

  it("recusa quantidade fracionária ou negativa", () => {
    expect(validarProduto({ ...produtoValido, quantidade: 1.5 })).toMatch(/quantidade/i);
    expect(validarProduto({ ...produtoValido, quantidade: -3 })).toMatch(/quantidade/i);
  });

  it("limita a descrição a 800 caracteres", () => {
    expect(validarProduto({ ...produtoValido, descricao: "a".repeat(801) })).toMatch(/800/);
    expect(validarProduto({ ...produtoValido, descricao: "a".repeat(800) })).toBeNull();
  });

  it("aceita imagem opcional, mas só com protocolo http ou https", () => {
    expect(validarProduto({ ...produtoValido, imagem: undefined })).toBeNull();

    expect(validarProduto({ ...produtoValido, imagem: "javascript:alert(1)" })).toMatch(/http/i);
    expect(validarProduto({ ...produtoValido, imagem: "ftp://exemplo.com/a.jpg" })).toMatch(/http/i);
    expect(validarProduto({ ...produtoValido, imagem: "nao-e-url" })).toMatch(/URL/i);
  });
});

describe("validarCadastro", () => {
  it("aceita nome, e-mail e senha válidos", () => {
    expect(validarCadastro("Ana Souza", "ana@exemplo.com", "senha123")).toBeNull();
  });

  it("exige nome completo", () => {
    expect(validarCadastro("A", "ana@exemplo.com", "senha123")).toMatch(/nome/i);
  });

  it("exige e-mail com formato plausível", () => {
    const invalidos = ["ana", "ana@", "@exemplo.com", "ana exemplo.com", "ana@exemplo"];
    for (const email of invalidos) {
      expect(validarCadastro("Ana Souza", email, "senha123")).toMatch(/e-mail/i);
    }
  });

  it("exige senha com pelo menos 6 caracteres", () => {
    expect(validarCadastro("Ana Souza", "ana@exemplo.com", "12345")).toMatch(/senha/i);
    expect(validarCadastro("Ana Souza", "ana@exemplo.com", "123456")).toBeNull();
  });
});
