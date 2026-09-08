export type ProdutoInput = { nome: string; preco: number; quantidade: number; categoriaId: string; descricao?: string; imagem?: string };

export function validarProduto(input: ProdutoInput): string | null {
  if (input.nome.trim().length < 2) return "Informe um nome válido para o produto.";
  if (!input.categoriaId.trim()) return "Selecione uma categoria.";
  if (!Number.isFinite(input.preco) || input.preco < 0) return "O preço deve ser um número não negativo.";
  if (!Number.isInteger(input.quantidade) || input.quantidade < 0) return "A quantidade deve ser um inteiro não negativo.";
  if (input.descricao && input.descricao.trim().length > 800) return "A descrição pode ter no máximo 800 caracteres.";
  if (input.imagem) {
    try {
      const url = new URL(input.imagem);
      if (!['http:', 'https:'].includes(url.protocol)) return "A imagem deve usar um endereço http ou https.";
    } catch {
      return "Informe uma URL de imagem válida.";
    }
  }
  return null;
}

export function validarCadastro(nome: string, email: string, senha: string): string | null {
  if (nome.trim().length < 2) return "Informe seu nome completo.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Informe um e-mail válido.";
  if (senha.length < 6) return "A senha deve ter pelo menos 6 caracteres.";
  return null;
}
