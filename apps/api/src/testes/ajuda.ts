import type { FastifyInstance } from "fastify";
import { criarApp } from "../app.js";
import { limparSessoes } from "../rotas/auth.js";

/**
 * Cliente HTTP para os testes de integração.
 *
 * Usa `app.inject()`, que faz a requisição pelo ciclo do Fastify sem abrir
 * socket. É mais rápido que subir um servidor e mais fiel que chamar as
 * funções de rota direto, porque percorre hooks, serialização e o tratador
 * de erro — exatamente o caminho de produção.
 */
export type Cliente = {
  /** Cookie de sessão em uso, ou `null` para cliente anônimo. */
  readonly cookie: string | null;
  get(rota: string, cabecalhos?: Record<string, string>): Promise<Resposta>;
  post(rota: string, corpo?: unknown, cabecalhos?: Record<string, string>): Promise<Resposta>;
  put(rota: string, corpo?: unknown, cabecalhos?: Record<string, string>): Promise<Resposta>;
  patch(rota: string, corpo?: unknown, cabecalhos?: Record<string, string>): Promise<Resposta>;
  delete(rota: string, cabecalhos?: Record<string, string>): Promise<Resposta>;
};

export type Resposta = {
  status: number;
  // `any` aqui é proposital, e é a dívida que estes testes existem para medir:
  // a API não tem contrato de resposta tipado. Quando a Fase 3 tipar as
  // respostas, este campo passa a ser o tipo inferido do schema Zod e os `as`
  // do arquivo somem junto.
  // eslint-disable-next-line typescript/no-explicit-any
  corpo: any;
  cookies: Array<{ name: string; value: string }>;
};

export type Contexto = {
  app: FastifyInstance;
  novoCliente: () => Cliente;
  encerrar: () => Promise<void>;
};

/** Lê o valor de um cookie a partir da lista que o `inject` devolve. */
function lerCookie(setCookies: Array<{ name: string; value: string }>, nome: string): string | null {
  return setCookies.find((cookie) => cookie.name === nome)?.value ?? null;
}

export async function iniciarContexto(opcoes: { semRateLimit?: boolean } = {}): Promise<Contexto> {
  const app = criarApp({ semRateLimit: opcoes.semRateLimit ?? true });
  await app.ready();
  limparSessoes();

  const novoCliente = (): Cliente => {
    // Par `nome=valor` do cookie de sessão, ou null para anônimo.
    let cookie: string | null = null;

    const enviar = async (
      metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      rota: string,
      corpo?: unknown,
      cabecalhos?: Record<string, string>,
    ): Promise<Resposta> => {
      const injetados: Record<string, string> = { ...cabecalhos };
      if (corpo !== undefined) injetados["content-type"] = "application/json";
      if (cookie) injetados.cookie = cookie;

      const resposta = await app.inject({ method: metodo, url: rota, payload: corpo as never, headers: injetados });

      const definido = lerCookie(resposta.cookies, "loja_session");
      // Guarda o par `nome=valor` completo, que é o que vai no cabeçalho. É
      // também o que o teste inspeciona, para confirmar que o cookie tem o
      // nome esperado e não só algum valor.
      if (definido !== null) cookie = definido === "" ? null : `loja_session=${definido}`;

      // eslint-disable-next-line typescript/no-explicit-any
      let dados: any = resposta.body;
      try {
        dados = JSON.parse(resposta.body);
      } catch {
        // resposta não-JSON, como um arquivo estático
      }

      return { status: resposta.statusCode, corpo: dados, cookies: resposta.cookies };
    };

    return {
      get cookie() {
        return cookie;
      },
      get: (rota, cabecalhos) => enviar("GET", rota, undefined, cabecalhos),
      post: (rota, corpo, cabecalhos) => enviar("POST", rota, corpo, cabecalhos),
      put: (rota, corpo, cabecalhos) => enviar("PUT", rota, corpo, cabecalhos),
      patch: (rota, corpo, cabecalhos) => enviar("PATCH", rota, corpo, cabecalhos),
      delete: (rota, cabecalhos) => enviar("DELETE", rota, undefined, cabecalhos),
    };
  };

  return {
    app,
    novoCliente,
    encerrar: async () => {
      await app.close();
    },
  };
}

/** Autentica um cliente novo. Lança se o login falhar. */
export async function clienteAutenticado(
  novo: () => Cliente,
  email: string,
  senha: string,
  // eslint-disable-next-line typescript/no-explicit-any
): Promise<{ cliente: Cliente; usuario: any }> {
  const cliente = novo();
  const resposta = await cliente.post("/api/login", { email, senha });
  if (resposta.status !== 200) throw new Error(`Falha no login de ${email}: ${resposta.status}`);
  return { cliente, usuario: resposta.corpo };
}

export const ADMIN = { email: "admin@lojaficticia.com", senha: "admin123" };
