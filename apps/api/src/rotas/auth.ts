import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  criarTokenRedefinicaoSenha,
  criarUsuario,
  redefinirSenhaComToken,
  atualizarSenhaUsuario,
  verificarSenha,
} from "../database.js";
import { ErroApp } from "../erros.js";
import { randomUUID } from "node:crypto";

const COOKIE_SESSAO = "loja_session";
const DURACAO_SESSAO_MS = 1000 * 60 * 60 * 12;

/**
 * Sessões em memória. Um `Map` não sobrevive a reinício e não é compartilhado
 * entre instâncias: a Fase 5 move isso para o banco.
 */
const sessoes = new Map<string, { usuarioId: string; expiraEm: number }>();

export type SessaoUsuario = { id: string; nome: string; email: string; role: Role };

/** Usuário da requisição atual, ou `undefined` para visitante anônimo. */
export function usuarioDaRequisicao(req: FastifyRequest): SessaoUsuario | undefined {
  const token = req.cookies[COOKIE_SESSAO];
  if (!token) return undefined;

  const sessao = sessoes.get(token);
  if (!sessao) return undefined;
  if (sessao.expiraEm < Date.now()) {
    sessoes.delete(token);
    return undefined;
  }

  const usuario = buscarUsuarioPorId(sessao.usuarioId);
  return usuario ? { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role as Role } : undefined;
}

/** Exige sessão. Responde 401 quando não há. */
export function exigirSessao(req: FastifyRequest): SessaoUsuario {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario) throw ErroApp.naoAutenticado("Faça login para continuar.");
  return usuario;
}

/** Exige sessão com papel de administrador. Responde 401 ou 403. */
export function exigirAdmin(req: FastifyRequest): SessaoUsuario {
  const usuario = exigirSessao(req);
  if (usuario.role !== "admin") throw ErroApp.semPermissao("Acesso restrito ao administrador.");
  return usuario;
}

function criarSessao(reply: FastifyReply, usuarioId: string, seguro: boolean) {
  const token = randomUUID() + randomUUID();
  sessoes.set(token, { usuarioId, expiraEm: Date.now() + DURACAO_SESSAO_MS });

  reply.setCookie(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_SESSAO_MS / 1000,
    // `secure` é obrigatório em produção: sem isso o cookie trafega em claro
    // em qualquer conexão que não seja HTTPS.
    secure: seguro,
  });
}

/** Limpa todas as sessões. Usado entre cenários de teste. */
export function limparSessoes(): void {
  sessoes.clear();
}

export async function registrarRotasAuth(app: FastifyInstance) {
  const seguro = process.env.NODE_ENV === "production";

  app.post("/api/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { email, senha } = loginBody.parse(req.body);

    const usuario = buscarUsuarioPorEmail(email);
    // Mesma resposta para e-mail inexistente e senha errada: responder
    // diferente permitiria enumerar quais contas existem.
    if (!usuario || !verificarSenha(senha, usuario.senha)) {
      throw new ErroApp(401, "E-mail ou senha inválidos.", "credenciais_invalidas");
    }

    // Migra senhas antigas para scrypt no primeiro login bem-sucedido.
    if (!usuario.senha.startsWith("scrypt$")) atualizarSenhaUsuario(usuario.id, senha);

    criarSessao(reply, usuario.id, seguro);
    // O envelope `{ usuario }` é o contrato que o frontend já consome. Trocá-lo
    // aqui quebraria `App.tsx` sem que nenhuma waivedchange no servidor
    // indicasse o problema.
    return {
      usuario: usuarioPublico.parse({ id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role }),
    };
  });

  app.post("/api/logout", async (_req, reply) => {
    const token = _req.cookies[COOKIE_SESSAO];
    if (token) sessoes.delete(token);
    reply.clearCookie(COOKIE_SESSAO, { path: "/" });
    return { mensagem: "Sessão encerrada." };
  });

  app.get("/api/sessao", async (req) => ({ usuario: usuarioDaRequisicao(req) ?? null }));

  app.post("/api/cadastro", async (req, reply) => {
    const { nome, email, senha } = cadastroBody.parse(req.body);

    if (buscarUsuarioPorEmail(email)) throw ErroApp.conflito("Este e-mail já está cadastrado.");

    const id = randomUUID();
    try {
      criarUsuario({ id, nome, email, senha });
    } catch (erro) {
      // A restrição UNIQUE do banco cobre duas tentativas simultâneas, que
      // passam pelo `if` acima sem ver nada.
      if (/unique|constraint/i.test(erro instanceof Error ? erro.message : "")) {
        throw ErroApp.conflito("Este e-mail já está cadastrado.");
      }
      throw erro;
    }

    criarSessao(reply, id, seguro);
    reply.code(201);
    return { usuario: { id, nome, email, role: "cliente" as const } };
  });

  app.post(
    "/api/recuperar-senha",
    { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } },
    async (req, reply) => {
      const { email } = recuperarSenhaBody.parse(req.body);
      const token = criarTokenRedefinicaoSenha(email);

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

    if (!redefinirSenhaComToken(token, senha)) {
      throw ErroApp.badRequest("O link de recuperação é inválido ou expirou.", "token_invalido");
    }
    return { mensagem: "Senha redefinida com sucesso. Faça login com a nova senha." };
  });
}
