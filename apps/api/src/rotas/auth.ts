import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cadastroBody,
  loginBody,
  recuperarSenhaBody,
  redefinirSenhaBody,
  usuarioPublico,
  type Role,
} from "@loja/shared";
import {
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  criarSessao,
  encerrarSessao,
  expirarSessao,
  obterSessao,
  criarTokenRedefinicaoSenha,
  criarUsuario,
  redefinirSenhaComToken,
  atualizarSenhaUsuario,
  verificarSenha,
} from "../database.js";
import { ErroApp } from "../erros.js";

export const COOKIE_SESSAO = "loja_session";
const DURACAO_SESSAO_MS = 1000 * 60 * 60 * 12;

export type SessaoUsuario = { id: string; nome: string; email: string; role: Role };

/** Hash do token do cookie, que é o que fica gravado no banco. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Usuário da requisição atual, ou `undefined` para visitante anônimo. */
export async function usuarioDaRequisicao(req: FastifyRequest): Promise<SessaoUsuario | undefined> {
  const token = req.cookies[COOKIE_SESSAO];
  if (!token) return undefined;

  // A sessão está no banco desde a Fase 5. Antes era um Map em memória,
  // que perdia tudo a cada reinício do processo e não compartilhava estado
  // entre instâncias em serverless.
  const usuarioId = await obterSessao(hashToken(token));
  if (!usuarioId) return undefined;

  const usuario = await buscarUsuarioPorId(usuarioId);
  return usuario ? { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role as Role } : undefined;
}

/** Exige sessão. Responde 401 quando não há. */
export async function exigirSessao(req: FastifyRequest): Promise<SessaoUsuario> {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) throw ErroApp.naoAutenticado("Faça login para continuar.");
  return usuario;
}

/** Exige sessão com papel de administrador. Responde 401 ou 403. */
export async function exigirAdmin(req: FastifyRequest): Promise<SessaoUsuario> {
  const usuario = await exigirSessao(req);
  if (usuario.role !== "admin") throw ErroApp.semPermissao("Acesso restrito ao administrador.");
  return usuario;
}

function definirCookieSessao(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_SESSAO_MS / 1000,
    // `secure` e obrigatorio em producao: sem isso o cookie trafega em claro
    // em qualquer conexao que nao seja HTTPS.
    secure: process.env.NODE_ENV === "production",
  });
}

/** Limpa todas as sessões. Usado entre cenários de teste. */
export function limparSessoes() {
  return expirarSessao();
}

export async function registrarRotasAuth(app: FastifyInstance) {
  app.post("/api/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { email, senha } = loginBody.parse(req.body);

    const usuario = await buscarUsuarioPorEmail(email);
    // Mesma resposta para e-mail inexistente e senha errada: responder
    // diferente permitiria enumerar quais contas existem.
    if (!usuario || !verificarSenha(senha, usuario.senha)) {
      throw new ErroApp(401, "E-mail ou senha inválidos.", "credenciais_invalidas");
    }

    // Migra senhas antigas para scrypt no primeiro login bem-sucedido.
    if (!usuario.senha.startsWith("scrypt$")) await atualizarSenhaUsuario(usuario.id, senha);

    const token = randomBytes(32).toString("hex");
    await criarSessao(token, usuario.id, DURACAO_SESSAO_MS);
    definirCookieSessao(reply, token);

    // O envelope `{ usuario }` é o contrato que o frontend já consome. Trocá-lo
    // aqui quebraria `App.tsx` sem que nada no servidor indicasse o problema.
    return {
      usuario: usuarioPublico.parse({ id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role }),
    };
  });

  app.post("/api/logout", async (req, reply) => {
    const token = req.cookies[COOKIE_SESSAO];
    if (token) await encerrarSessao(hashToken(token));
    reply.clearCookie(COOKIE_SESSAO, { path: "/" });
    return { mensagem: "Sessão encerrada." };
  });

  app.get("/api/sessao", async (req) => ({ usuario: (await usuarioDaRequisicao(req)) ?? null }));

  app.post("/api/cadastro", async (req, reply) => {
    const { nome, email, senha } = cadastroBody.parse(req.body);

    if (await buscarUsuarioPorEmail(email)) throw ErroApp.conflito("Este e-mail já está cadastrado.");

    const id = randomUUID();
    try {
      await criarUsuario({ id, nome, email, senha });
    } catch (erro) {
      // A restrição UNIQUE do banco cobre duas tentativas simultâneas, que
      // passam pelo `if` acima sem ver nada.
      if (/unique|constraint/i.test(erro instanceof Error ? erro.message : "")) {
        throw ErroApp.conflito("Este e-mail já está cadastrado.");
      }
      throw erro;
    }

    const token = randomBytes(32).toString("hex");
    await criarSessao(token, id, DURACAO_SESSAO_MS);
    definirCookieSessao(reply, token);
    reply.code(201);
    return { usuario: { id, nome, email, role: "cliente" as const } };
  });

  app.post(
    "/api/recuperar-senha",
    { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } },
    async (req, reply) => {
      const { email } = recuperarSenhaBody.parse(req.body);
      const token = await criarTokenRedefinicaoSenha(email);

      // Fora de produção o token volta na resposta, para não precisar de e-mail
      // durante o desenvolvimento. A flag precisa ser explícita: sem
      // NODE_ENV definido o padrão seria desenvolvimento, e o token vazaria
      // em qualquer ambiente que não a tenha definido.
      const exporToken = process.env.NODE_ENV !== "production";
      if (token && exporToken) {
        req.log.info({ email }, `Link de redefinição (desenvolvimento): /?resetToken=${token}`);
      }

      reply.code(200);
      return {
        mensagem: "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.",
        ...(exporToken && token ? { token } : {}),
      };
    },
  );

  app.post("/api/redefinir-senha", async (req) => {
    const { token, senha } = redefinirSenhaBody.parse(req.body);

    if (!(await redefinirSenhaComToken(token, senha))) {
      throw ErroApp.badRequest("O link de recuperação é inválido ou expirou.", "token_invalido");
    }
    return { mensagem: "Senha redefinida com sucesso. Faça login com a nova senha." };
  });
}
