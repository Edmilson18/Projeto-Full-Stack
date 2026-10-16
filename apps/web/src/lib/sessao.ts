export const EVENTO_SESSAO_EXPIRADA = "loja:sessao-expirada";

let versao = 0;

/** Invalida respostas iniciadas antes de uma transição de autenticação. */
export function renovarEscopoSessao(): number {
  return ++versao;
}

export function escopoSessaoAtual(): number {
  return versao;
}
