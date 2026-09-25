/**
 * Erro de aplicação: o tipo de erro que o código de negócio deve lançar.
 *
 * Qualquer coisa que seja `ErroApp` chega ao cliente com o status e a mensagem
 * que ela carrega. Qualquer outro erro é tratado como falha inesperada e vira
 * 500 sem vazar detalhe interno.
 */
export class ErroApp extends Error {
  readonly status: number;
  readonly codigo: string;

  constructor(status: number, mensagem: string, codigo = "erro") {
    super(mensagem);
    this.name = "ErroApp";
    this.status = status;
    this.codigo = codigo;
  }

  static badRequest(mensagem: string, codigo = "requisicao_invalida") {
    return new ErroApp(400, mensagem, codigo);
  }

  static naoEncontrado(mensagem = "Recurso não encontrado.", codigo = "nao_encontrado") {
    return new ErroApp(404, mensagem, codigo);
  }

  static conflito(mensagem: string, codigo = "conflito") {
    return new ErroApp(409, mensagem, codigo);
  }

  /**
   * 401: não há sessão. Distingue de 403 porque a resposta indica que
   * autenticar resolve o problema, e o cliente pode agir em cima disso.
   */
  static naoAutenticado(mensagem = "Faça login para continuar.", codigo = "nao_autenticado") {
    return new ErroApp(401, mensagem, codigo);
  }

  /** 403: há sessão, mas o papel não permite a operação. */
  static semPermissao(mensagem = "Acesso restrito.", codigo = "sem_permissao") {
    return new ErroApp(403, mensagem, codigo);
  }
}
