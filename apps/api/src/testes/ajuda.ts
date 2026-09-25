import type { Server } from "node:http";
import { criarServidor, limparSessoes } from "../server.js";

/**
 * Cliente HTTP mínimo para os testes de integração.
 *
 * Reproduz o que o navegador faz e o que a biblioteca de requisição simples
 * não faz: guarda o cookie de sessão e o reenvia. Sem isso, cada requisição
 * pareceria anônima e não daria para testar a autorização.
 */
export type Cliente = {
  base: string;
  cookie: string | null;
  get(rota: string): Promise<Resposta>;
  post(rota: string, corpo?: unknown): Promise<Resposta>;
  put(rota: string, corpo?: unknown): Promise<Resposta>;
  patch(rota: string, corpo?: unknown): Promise<Resposta>;
  delete(rota: string): Promise<Resposta>;
};

export type Resposta = {
  status: number;
  // `any` aqui e proposital, e e a divida que estes testes existem para medir: a
  // API nao tem contrato tipado, entao o corpo de qualquer resposta e
  // estruturalmente desconhecido. Quando o schema Zod entrar, na Fase 3, este
  // vira o tipo inferido e os `as` somem junto.
  // eslint-disable-next-line typescript/no-explicit-any
  corpo: any;
};

export async function iniciarServidor(): Promise<{
  servidor: Server;
  cliente: () => Cliente;
  encerrar: () => Promise<void>;
}> {
  const servidor = criarServidor();
  limparSessoes();

  await new Promise<void>((resolve) => servidor.listen(0, resolve));
  const endereco = servidor.address();
  if (!endereco || typeof endereco === "string")
    throw new Error("Não foi possível descobrir a porta do servidor de teste.");
  const base = `http://127.0.0.1:${endereco.port}`;

  const criarCliente = (): Cliente => {
    let cookie: string | null = null;

    const enviar = async (metodo: string, rota: string, corpo?: unknown): Promise<Resposta> => {
      const cabecalhos: Record<string, string> = {};
      if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
      if (cookie) cabecalhos.Cookie = cookie;

      const resposta = await fetch(`${base}${rota}`, {
        method: metodo,
        headers: cabecalhos,
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        redirect: "manual",
      });

      const definido = resposta.headers.getSetCookie?.() ?? [];
      const primeiro = definido[0];
      const [valor] = primeiro ? primeiro.split(";") : [];
      if (valor) {
        // Set-Cookie com Max-Age=0 limpa a sessao.
        cookie = valor.endsWith("=") ? null : valor;
      }

      const texto = await resposta.text();
      let dados: unknown = texto;
      try {
        dados = JSON.parse(texto);
      } catch {
        // resposta nao-JSON (ex.: arquivo estatico) segue como texto
      }
      return { status: resposta.status, corpo: dados };
    };

    return {
      base,
      get cookie() {
        return cookie;
      },
      get: (rota) => enviar("GET", rota),
      post: (rota, corpo) => enviar("POST", rota, corpo),
      put: (rota, corpo) => enviar("PUT", rota, corpo),
      patch: (rota, corpo) => enviar("PATCH", rota, corpo),
      delete: (rota) => enviar("DELETE", rota),
    };
  };

  return {
    servidor,
    cliente: criarCliente,
    encerrar: () => new Promise<void>((resolve, reject) => servidor.close((erro) => (erro ? reject(erro) : resolve()))),
  };
}

/** Autentica um cliente novo com as credenciais passadas. */
export async function clienteAutenticado(
  criar: () => Cliente,
  email: string,
  senha: string,
  // eslint-disable-next-line typescript/no-explicit-any
): Promise<{ cliente: Cliente; usuario: any }> {
  const cliente = criar();
  const resposta = await cliente.post("/api/login", { email, senha });
  if (resposta.status !== 200) throw new Error(`Falha no login de ${email}: ${resposta.status}`);
  return { cliente, usuario: resposta.corpo.usuario };
}

export const ADMIN = { email: "admin@lojaficticia.com", senha: "admin123" };
