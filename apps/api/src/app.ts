import path from "node:path";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import type { FastifyReply } from "fastify";
import { ambiente } from "./config.js";
import { ErroApp } from "./erros.js";
import { registrarRotasAuth } from "./rotas/auth.js";
import { registrarRotasCatalogo } from "./rotas/catalogo.js";
import { registrarRotasPedidos } from "./rotas/pedidos.js";

const TIPOS_CONTEUDO: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Arquivos estáticos servidos a partir da raiz do repositório. */
const PAGINAS_RAIZ = new Set(["/", "/index.html", "/admin.html", "/dashboard.html", "/login.html", "/style.css"]);

async function servirArquivo(res: FastifyReply, rota: string) {
  const normalizada = rota === "/" || rota === "/login.html" ? "/index.html" : rota;
  const ehFrontend = normalizada === "/index.html" || normalizada.startsWith("/assets/");
  // `/build/` continua resolvendo da raiz: é de onde `admin.html` e
  // `dashboard.html` carregam os painéis antigos, até a Fase 6 removê-los.
  const ehLegado = normalizada.startsWith("/build/");

  const caminho = ehFrontend
    ? path.join(ambiente.dist, normalizada.replace(/^\//, ""))
    : ehLegado
      ? path.join(ambiente.buildLegado, normalizada.replace(/^\/build\//, ""))
      : path.join(ambiente.raiz, normalizada.replace(/^\//, ""));

  try {
    const conteudo = await fs.readFile(caminho);
    res.header("Content-Type", TIPOS_CONTEUDO[path.extname(caminho).toLowerCase()] ?? "application/octet-stream");
    res.send(conteudo);
  } catch {
    res.code(404).type("text/plain; charset=utf-8").send("Arquivo não encontrado.");
  }
}

export type OpcoesApp = {
  /**
   * Desliga o rate limit global. A suíte dispara dezenas de requisições em
   * poucos segundos e esbarraria no limite, produzindo 429 no lugar da resposta
   * que o teste quer verificar. O limite em si é testado à parte, com um app
   * que o mantém ligado.
   */
  semRateLimit?: boolean;
};

export function criarApp(opcoes: OpcoesApp = {}) {
  const app = Fastify({
    logger: ambiente.producao
      ? { level: "info" }
      : {
          level: "info",
          // O log de requisição do Pino usa req/res, que o Fastify serializa
          // inteiro. Sem isso, cada requisição despeja o corpo inteiro no console.
          serializers: {
            req: (req) => ({ method: req.method, url: req.url }),
            res: (res) => ({ status: res.statusCode }),
          },
        },
    bodyLimit: 1_000_000,
    trustProxy: ambiente.producao,
  });

  app.register(cookie, { secret: ambiente.cookieSecret });
  app.register(cors, {
    origin: ambiente.producao ? true : ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  });
  app.register(helmet, { contentSecurityPolicy: ambiente.producao });
  if (!opcoes.semRateLimit) {
    app.register(rateLimit, { max: 120, timeWindow: "1 minute", global: true });
  }

  /**
   * Verificação de `Origin` nas rotas que alteram dados.
   *
   * `SameSite=Lax` já barra o cookie em requisições de origem cruzada na
   * maioria das navegações, mas não em todas: um `<form>` apontando para a API
   * conta como requisição de primeira parte em alguns navegadores. Comparar o
   * `Origin` declarado com a origem esperada fecha esse resto.
   *
   * Só para métodos que mudam estado: `GET` é seguro por definição, e exigir
   * `Origin` em leitura quebraria o compartilhamento de link.
   */
  const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

  app.addHook("onRequest", async (req, reply) => {
    if (METODOS_SEGUROS.has(req.method)) return;

    const origem = req.headers.origin;
    // Ausente de requisições que não vêm de navegador (curl, health check).
    if (!origem) return;

    const permitida = ambiente.producao
      ? origem === ambiente.origemPermitida
      : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem);

    if (!permitida) {
      reply.code(403).send({ erro: "Origem não permitida." });
    }
  });

  /**
   * Tratador único de erro.
   *
   * `ErroApp` chega ao cliente com o status e a mensagem que carrega. `ZodError`
   * vira 400 com a mensagem do primeiro problema. Qualquer outra coisa é 500
   * sem detalhe interno, e o motivo vai só para o log.
   */
  app.setErrorHandler((erro, req, reply) => {
    if (erro instanceof ErroApp) {
      return reply.code(erro.status).send({ erro: erro.message });
    }

    if (erro instanceof ZodError) {
      const primeiro = erro.issues[0];
      return reply.code(400).send({ erro: primeiro?.message ?? "Dados inválidos." });
    }

    // Erros do próprio Fastify (payload grande, JSON malformado) trazem
    // `statusCode`. Eles são do cliente, não do servidor, e a mensagem pode
    // ser repassada.
    const possivelHttp = erro as { statusCode?: unknown; message?: unknown };
    if (
      typeof possivelHttp.statusCode === "number" &&
      possivelHttp.statusCode < 500 &&
      typeof possivelHttp.message === "string"
    ) {
      return reply.code(possivelHttp.statusCode).send({ erro: possivelHttp.message });
    }

    req.log.error({ err: erro }, "erro não tratado");
    return reply.code(500).send({ erro: "Erro interno do servidor." });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ erro: "Rota não encontrada." });
    }
    return servirArquivo(reply, req.url);
  });

  app.register(registrarRotasAuth);
  app.register(registrarRotasCatalogo);
  app.register(registrarRotasPedidos);

  // Páginas estáticas. A ordem importa: o `setNotFoundHandler` cobre o resto.
  app.get("/build/*", (req, reply) => servirArquivo(reply, req.url));
  for (const pagina of PAGINAS_RAIZ) {
    if (pagina === "/") continue;
    app.get(pagina, (_req, reply) => servirArquivo(reply, pagina));
  }
  app.get("/", (_req, reply) => servirArquivo(reply, "/"));

  return app;
}

export type App = ReturnType<typeof criarApp>;

export async function iniciar(porta: number): Promise<Server> {
  const app = criarApp();
  await app.listen({ port: porta, host: "0.0.0.0" });
  return app.server;
}
