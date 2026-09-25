import type { FastifyInstance } from "fastify";
import { cupomInvalido, cupomValidado, pedidoInput, statusPedido, metodoPagamento } from "@loja/shared";
import {
  criarPedido,
  listarDashboard,
  listarPedidosAdmin,
  atualizarStatusPedido,
  listarAuditoria,
  registrarAuditoria,
  validarCupomCodigo,
} from "../database.js";
import { ErroApp } from "../erros.js";
import { exigirAdmin, exigirSessao } from "./auth.js";

export async function registrarRotasPedidos(app: FastifyInstance) {
  // ── Cliente ──────────────────────────────────────────────────────────────

  app.post("/api/pedidos", async (req, reply) => {
    const usuario = await exigirSessao(req);
    const entrada = pedidoInput.parse(req.body);

    // Reuso de cupom é uma operação de escrita, e Limitador simples não
    // resolve: duas requisições no mesmo instante passam. A Fase 7 traz chave
    // de idempotência.
    let pedido;
    try {
      pedido = await criarPedido(usuario.id, entrada.itens, entrada.cupomCodigo, entrada.metodoPagamento);
    } catch (erro) {
      throw ErroApp.badRequest(erro instanceof Error ? erro.message : "Não foi possível concluir o pedido.");
    }

    await registrarAuditoria({
      entidade: "pedido",
      entidadeId: pedido.id,
      acao: "criado",
      depois: { status: pedido.status, total_final: pedido.total_final },
      usuarioId: usuario.id,
    });

    reply.code(201);
    return { pedido };
  });

  app.post("/api/cupons/validar", async (req) => {
    const { codigo } = (req.body ?? {}) as { codigo?: unknown };
    const texto = String(codigo ?? "").trim();
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
    return listarDashboard();
  });

  app.get("/api/admin/pedidos", async (req) => {
    await exigirAdmin(req);
    return listarPedidosAdmin();
  });

  app.patch("/api/admin/pedidos/:id", async (req) => {
    const usuario = await exigirAdmin(req);
    const { status } = (req.body ?? {}) as { status?: unknown };

    // O schema garante que o status é um dos quatro conhecidos, o que antes
    // dependia de uma lista de strings dentro de uma função do banco.
    const novo = statusPedido.parse(status);
    const id = (req.params as { id: string }).id;

    // O estado anterior vem da própria listagem, para que a auditoria registre
    // a transição real e não só o valor novo.
    const anteriores = await listarPedidosAdmin();
    const anterior = anteriores.find((pedido) => pedido.id === id);

    try {
      await atualizarStatusPedido(id, novo);
    } catch (erro) {
      throw ErroApp.badRequest(erro instanceof Error ? erro.message : "Não foi possível atualizar o pedido.");
    }

    await registrarAuditoria({
      entidade: "pedido",
      entidadeId: id,
      acao: "status_alterado",
      antes: anterior ? { status: anterior.status } : null,
      depois: { status: novo },
      usuarioId: usuario.id,
    });

    return { mensagem: "Status atualizado." };
  });

  app.get("/api/admin/pedidos/:id/auditoria", async (req) => {
    await exigirAdmin(req);
    return listarAuditoria("pedido", (req.params as { id: string }).id);
  });
}

export const metodosPagamentoAceitos = metodoPagamento.options;
