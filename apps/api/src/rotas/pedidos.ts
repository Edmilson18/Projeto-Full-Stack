import type { FastifyInstance } from "fastify";
import {
  cupomInvalido,
  cupomValidado,
  cupomValidarInput,
  dashboard as dashboardSchema,
  listaAuditoria,
  listaPedidosAdmin,
  mensagem,
  pedidoCriado,
  pedidoInput,
  statusPedidoInput,
} from "@loja/shared";
import {
  criarPedido,
  listarDashboard,
  listarPedidosAdmin,
  atualizarStatusPedido,
  listarAuditoria,
  validarCupomCodigo,
} from "../database.js";
import { ErroApp } from "../erros.js";
import { validarEntrada } from "../validacao.js";
import { exigirAdmin, exigirSessao } from "./auth.js";

export async function registrarRotasPedidos(app: FastifyInstance) {
  // ── Cliente ──────────────────────────────────────────────────────────────

  app.post("/api/pedidos", async (req, reply) => {
    const usuario = await exigirSessao(req);
    const entrada = validarEntrada(pedidoInput, req.body);

    // Sem `try/catch`: as regras de negócio lançam `ErroApp` e o tratador
    // global já devolve 4xx com a mensagem. O `catch` genérico que existia
    // convertia em 400 também o erro do banco, expondo o nome da constraint na
    // resposta e escondendo falha de infraestrutura como se fosse erro do
    // cliente.
    const pedido = await criarPedido(
      usuario.id,
      entrada.itens,
      entrada.cupomCodigo,
      entrada.metodoPagamento,
      entrada.chaveIdempotencia,
    );

    reply.code(201);
    return { pedido: pedidoCriado.parse(pedido) };
  });

  app.post("/api/cupons/validar", async (req) => {
    const { codigo } = validarEntrada(cupomValidarInput, req.body);
    const texto = codigo.trim();
    if (!texto) throw ErroApp.badRequest("Informe um código de cupom.");

    const resultado = await validarCupomCodigo(texto);
    if (!resultado.valido) {
      return cupomInvalido.parse({ valido: false, erro: resultado.erro ?? "Cupom inválido." });
    }
    return cupomValidado.parse(resultado);
  });

  // ── Administração ────────────────────────────────────────────────────────

  app.get("/api/dashboard", async (req) => {
    await exigirAdmin(req);
    // Validar a saída é o que impede um campo renomeado de chegar como
    // `undefined` no gráfico do painel, onde viraria `NaN` sem aviso.
    return dashboardSchema.parse(await listarDashboard());
  });

  app.get("/api/admin/pedidos", async (req) => {
    await exigirAdmin(req);
    return listaPedidosAdmin.parse(await listarPedidosAdmin());
  });

  app.patch("/api/admin/pedidos/:id", async (req) => {
    const usuario = await exigirAdmin(req);
    const { status } = validarEntrada(statusPedidoInput, req.body);
    const id = String((req.params as Record<string, unknown>).id ?? "");

    // O estado anterior e a auditoria são resolvidos dentro da transação de
    // `atualizarStatusPedido`. Antes, a rota chamava `listarPedidosAdmin()` —
    // carregava todos os pedidos do banco inteiro — para achar um, e a
    // auditoria ficava fora da transação: uma falha nela devolvia 500 depois
    // do status já ter mudado.
    await atualizarStatusPedido(id, status, usuario.id);

    return mensagem.parse({ mensagem: "Status atualizado." });
  });

  app.get("/api/admin/pedidos/:id/auditoria", async (req) => {
    await exigirAdmin(req);
    return listaAuditoria.parse(await listarAuditoria("pedido", (req.params as { id: string }).id));
  });
}
