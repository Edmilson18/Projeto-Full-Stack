import type { FastifyInstance } from "fastify";
import {
  CAMPOS_ENDERECO,
  enderecoInput,
  listaAvaliacoes,
  listaCategorias,
  listaCupons,
  listaProdutos,
  produtoCriadoResponse,
  produtoInput,
  conta,
  avaliacaoInput,
  avaliacaoCriadaResponse,
  favoritoResponse,
  mensagem,
  maisVendido,
  enderecoSalvoResponse,
} from "@loja/shared";
import {
  desfavoritarProduto,
  favoritarProduto,
  buscarPerfilUsuario,
  buscarProduto,
  categoriaExiste,
  inativarProduto,
  inserirProduto,
  listarAvaliacoes,
  listarAvaliacoesDoUsuario,
  listarCategorias,
  listarCuponsAtivos,
  listarFavoritos,
  listarMaisVendidos,
  listarPedidosDoUsuario,
  listarProdutos,
  produtoExiste,
  salvarAvaliacao,
  atualizarEnderecoUsuario,
  atualizarProduto,
} from "../database.js";
import { ErroApp } from "../erros.js";
import { validarEntrada } from "../validacao.js";
import { exigirAdmin, exigirSessao } from "./auth.js";
import { randomUUID } from "node:crypto";

/**
 * `favoritos` e `avaliacoes` têm chave estrangeira para `produtos`. Sem esta
 * checagem, um id inexistente deixaria o banco recusar a escrita e a rota
 * viraria 500, como se a falha fosse de infraestrutura em vez de entrada
 * inválida.
 *
 * No escopo do módulo porque não captura nada do escopo da função de registro:
 * dentro dela a função seria recriada a cada chamada.
 */
async function exigirProdutoExistente(produtoId: string) {
  if (!(await produtoExiste(produtoId))) throw ErroApp.naoEncontrado("Produto não encontrado.");
  return produtoId;
}

export async function registrarRotasCatalogo(app: FastifyInstance) {
  // ── Leitura pública ──────────────────────────────────────────────────────
  //
  // Cada rota valida a própria saída. Sem isso, um campo renomeado no banco
  // chegaria como `undefined` na tela sem nenhum sinal, e o `String(x)` do
  // frontend mascararia o problema.

  app.get("/api/produtos", async () => listaProdutos.parse(await listarProdutos()));

  app.get("/api/produtos/mais-vendidos", async () => {
    const linhas = await listarMaisVendidos();
    return linhas.map((linha) => maisVendido.parse({ ...linha, vendidos: Number(linha.vendidos) }));
  });

  app.get("/api/categorias", async () => listaCategorias.parse(await listarCategorias()));

  app.get("/api/cupons", async () =>
    listaCupons.parse(
      (await listarCuponsAtivos()).map((cupom) => ({
        codigo: cupom.codigo,
        tipoDesconto: cupom.tipo_desconto,
        porcentagemDesconto: Number(cupom.porcentagem_desconto ?? 0),
        desconto: Number(cupom.desconto_centavos ?? 0) / 100,
        valorMinimo: Number(cupom.valor_minimo_centavos ?? 0) / 100,
      })),
    ),
  );

  app.get("/api/avaliacoes/:id", async (req) =>
    listaAvaliacoes.parse(await listarAvaliacoes((req.params as { id: string }).id)),
  );

  // ── Conta ────────────────────────────────────────────────────────────────

  app.get("/api/conta", async (req) => {
    const usuario = await exigirSessao(req);
    return conta.parse({
      perfil: await buscarPerfilUsuario(usuario.id),
      pedidos: await listarPedidosDoUsuario(usuario.id),
      // Permite à interface reconhecer a própria avaliação e oferecer
      // "atualizar" em vez de pedir uma segunda vez.
      minhasAvaliacoes: await listarAvaliacoesDoUsuario(usuario.id),
      favoritos: (await listarFavoritos(usuario.id)).map((linha) => ({
        ...linha,
        preco: Number(linha.preco ?? 0),
        descricao: linha.descricao ?? "",
        imagem: linha.imagem ?? null,
      })),
    });
  });

  app.put("/api/conta/endereco", async (req) => {
    const usuario = await exigirSessao(req);
    // O schema garante a UF com 2 letras, o que a validação manual fazia com
    // `endereco.estado?.length !== 2` e podia estourar em runtime.
    const entrada = validarEntrada(enderecoInput, req.body);

    await atualizarEnderecoUsuario(
      usuario.id,
      Object.fromEntries(CAMPOS_ENDERECO.map((campo) => [campo, entrada[campo]])),
    );
    return enderecoSalvoResponse.parse({ perfil: await buscarPerfilUsuario(usuario.id) });
  });

  // Estado desejado em vez de "alternar": as duas rotas são idempotentes, e
  // repetir a mesma chamada não inverte o favorito. Ver `favoritarProduto`.
  app.put("/api/favoritos/:id", async (req) => {
    const usuario = await exigirSessao(req);
    const produtoId = await exigirProdutoExistente((req.params as { id: string }).id);

    return favoritoResponse.parse({ favorito: await favoritarProduto(usuario.id, produtoId) });
  });

  app.delete("/api/favoritos/:id", async (req) => {
    const usuario = await exigirSessao(req);
    const produtoId = await exigirProdutoExistente((req.params as { id: string }).id);

    return favoritoResponse.parse({ favorito: await desfavoritarProduto(usuario.id, produtoId) });
  });

  app.post("/api/avaliacoes/:id", async (req, reply) => {
    const usuario = await exigirSessao(req);
    const entrada = validarEntrada(avaliacaoInput, req.body);
    const produtoId = (req.params as { id: string }).id;

    // Mesma razão do favorito: `avaliacoes.produto_id` é chave estrangeira.
    await exigirProdutoExistente(produtoId);

    // Elegibilidade e gravação são protegidas pela mesma transação no banco.
    await salvarAvaliacao(usuario.id, produtoId, entrada.nota, entrada.comentario);
    reply.code(201);
    return avaliacaoCriadaResponse.parse({ mensagem: "Avaliação registrada." });
  });

  // ── Administração ────────────────────────────────────────────────────────

  app.get("/api/admin/produtos", async (req) => {
    await exigirAdmin(req);
    return listaProdutos.parse(await listarProdutos(true));
  });

  app.post("/api/produtos", async (req, reply) => {
    await exigirAdmin(req);
    const entrada = validarEntrada(produtoInput, req.body);

    // `categoriaId` é uma chave estrangeira: sem esta checagem, uma categoria
    // inexistente deixava o banco recusar a inserção e a rota respondia 500,
    // como se a falha fosse de infraestrutura em vez de entrada inválida.
    if (!(await categoriaExiste(entrada.categoriaId))) {
      throw ErroApp.badRequest("Categoria inexistente.");
    }

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

    // Relê o produto para devolver o `categoria` (que é o nome, não o id) e o
    // preço em reais, no mesmo formato da listagem.
    const criado = await buscarProduto(produto.id);
    if (!criado) throw ErroApp.naoEncontrado("Produto não encontrado após a criação.");

    reply.code(201);
    return produtoCriadoResponse.parse({ mensagem: "Produto cadastrado com sucesso.", produto: criado });
  });

  app.put("/api/produtos/:id", async (req) => {
    await exigirAdmin(req);
    const entrada = validarEntrada(produtoInput, req.body);
    const { ativo } = (req.body ?? {}) as { ativo?: unknown };
    const id = (req.params as { id: string }).id;

    if (!(await categoriaExiste(entrada.categoriaId))) {
      throw ErroApp.badRequest("Categoria inexistente.");
    }
    if (!(await produtoExiste(id))) throw ErroApp.naoEncontrado("Produto não encontrado.");

    await atualizarProduto(id, {
      nome: entrada.nome,
      descricao: entrada.descricao,
      preco: entrada.preco,
      quantidade: entrada.quantidade,
      categoria_id: entrada.categoriaId,
      imagem: entrada.imagem,
      ativo: ativo !== false,
    });

    return mensagem.parse({ mensagem: "Produto atualizado." });
  });

  app.delete("/api/produtos/:id", async (req) => {
    await exigirAdmin(req);
    const id = (req.params as { id: string }).id;

    // Antes respondia 200 com "inativado" para um id que não existe, o que
    // fazia o cliente acreditar que a ação aconteceu.
    if (!(await produtoExiste(id))) throw ErroApp.naoEncontrado("Produto não encontrado.");

    await inativarProduto(id);
    return mensagem.parse({ mensagem: "Produto inativado." });
  });
}
