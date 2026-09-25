import type { FastifyInstance } from "fastify";
import { produtoInput, CAMPOS_ENDERECO, enderecoInput } from "@loja/shared";
import {
  alternarFavorito,
  buscarPerfilUsuario,
  inativarProduto,
  inserirProduto,
  listarAvaliacoes,
  listarCategorias,
  listarCuponsAtivos,
  listarFavoritos,
  listarMaisVendidos,
  listarPedidosDoUsuario,
  listarProdutos,
  salvarAvaliacao,
  atualizarEnderecoUsuario,
  atualizarProduto,
} from "../database.js";
import { ErroApp } from "../erros.js";
import { exigirAdmin, exigirSessao } from "./auth.js";
import { randomUUID } from "node:crypto";

export async function registrarRotasCatalogo(app: FastifyInstance) {
  // ── Leitura pública ──────────────────────────────────────────────────────

  app.get("/api/produtos", async () => listarProdutos());

  app.get("/api/produtos/mais-vendidos", async () => listarMaisVendidos());

  app.get("/api/categorias", async () => listarCategorias());

  app.get("/api/cupons", async () =>
    (await listarCuponsAtivos()).map((cupom) => ({
      codigo: cupom.codigo,
      tipoDesconto: cupom.tipo_desconto,
      porcentagemDesconto: Number(cupom.porcentagem_desconto ?? 0),
      valorMinimo: Number(cupom.valor_minimo ?? 0),
    })),
  );

  app.get("/api/avaliacoes/:id", async (req) => listarAvaliacoes((req.params as { id: string }).id));

  // ── Conta ────────────────────────────────────────────────────────────────

  app.get("/api/conta", async (req) => {
    const usuario = await exigirSessao(req);
    return {
      perfil: await buscarPerfilUsuario(usuario.id),
      pedidos: await listarPedidosDoUsuario(usuario.id),
      favoritos: await listarFavoritos(usuario.id),
    };
  });

  app.put("/api/conta/endereco", async (req) => {
    const usuario = await exigirSessao(req);
    // O schema garante a UF com 2 letras, o que a validação manual fazia com
    // `endereco.estado?.length !== 2` e podia estourar em runtime.
    const entrada = enderecoInput.parse(req.body);

    await atualizarEnderecoUsuario(
      usuario.id,
      Object.fromEntries(CAMPOS_ENDERECO.map((campo) => [campo, entrada[campo]])),
    );
    return { perfil: await buscarPerfilUsuario(usuario.id) };
  });

  app.post("/api/favoritos/:id", async (req) => {
    const usuario = await exigirSessao(req);
    return { favorito: await alternarFavorito(usuario.id, (req.params as { id: string }).id) };
  });

  app.post("/api/avaliacoes/:id", async (req, reply) => {
    const usuario = await exigirSessao(req);
    const { nota, comentario } = req.body as { nota?: unknown; comentario?: unknown };

    const notaNumero = Number(nota);
    if (!Number.isInteger(notaNumero) || notaNumero < 1 || notaNumero > 5) {
      throw ErroApp.badRequest("A nota deve ser um inteiro de 1 a 5.");
    }
    const texto = String(comentario ?? "").trim();
    if (texto.length > 600) throw ErroApp.badRequest("O comentário pode ter no máximo 600 caracteres.");

    await salvarAvaliacao(usuario.id, (req.params as { id: string }).id, notaNumero, texto);
    reply.code(201);
    return { mensagem: "Avaliação registrada." };
  });

  // ── Administração ────────────────────────────────────────────────────────

  app.get("/api/admin/produtos", async (req) => {
    await exigirAdmin(req);
    return listarProdutos(true);
  });

  app.post("/api/produtos", async (req, reply) => {
    await exigirAdmin(req);
    const entrada = produtoInput.parse(req.body);

    const produto = {
      id: randomUUID(),
      nome: entrada.nome,
      descricao: entrada.descricao || "Produto novo da loja.",
      preco: entrada.preco,
      quantidade: entrada.quantidade,
      categoria_id: entrada.categoriaId,
      imagem: entrada.imagem,
    };

    await inserirProduto(produto);
    reply.code(201);
    return { mensagem: "Produto cadastrado com sucesso.", produto };
  });

  app.put("/api/produtos/:id", async (req) => {
    await exigirAdmin(req);
    const entrada = produtoInput.parse(req.body);
    const { ativo } = (req.body ?? {}) as { ativo?: unknown };

    atualizarProduto((req.params as { id: string }).id, {
      nome: entrada.nome,
      descricao: entrada.descricao,
      preco: entrada.preco,
      quantidade: entrada.quantidade,
      categoria_id: entrada.categoriaId,
      imagem: entrada.imagem,
      ativo: ativo !== false,
    });

    return { mensagem: "Produto atualizado." };
  });

  app.delete("/api/produtos/:id", async (req) => {
    await exigirAdmin(req);
    await inativarProduto((req.params as { id: string }).id);
    return { mensagem: "Produto inativado." };
  });
}
