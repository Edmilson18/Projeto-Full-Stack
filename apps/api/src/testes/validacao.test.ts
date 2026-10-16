import { describe, expect, it } from "vitest";
import {
  mensagem,
  loginBody,
  produto,
  produtoResponse,
  sessao,
  sessaoResponse,
  pedido,
  pedidoResponse,
} from "@loja/shared";
import { criarApp } from "../app.js";
import { validarEntrada } from "../validacao.js";

describe("validação de entrada e saída", () => {
  it("modelos e respostas compartilham a representação de produto, sessão e pagamento", () => {
    expect(produtoResponse).toBe(produto);
    expect(sessaoResponse).toBe(sessao);
    const base = { id: "pedido", subtotal: 10, desconto: 0, frete: 0, total_final: 10, status: "processando" };
    expect(pedido.safeParse({ ...base, metodo_pagamento: "inventado" }).success).toBe(false);
    expect(pedidoResponse.safeParse({ ...base, metodo_pagamento: "inventado" }).success).toBe(false);
    expect(pedidoResponse.parse({ ...base, metodo_pagamento: "pix" }).metodo_pagamento).toBe("pix");
  });
  it("entrada inválida responde 400 e saída inválida responde 500 sem expor detalhes", async () => {
    const app = criarApp({ semRateLimit: true });
    app.post("/api/teste-entrada", (req) => validarEntrada(loginBody, req.body));
    app.get("/api/teste-saida", () => mensagem.parse({ mensagem: 123 }));
    try {
      const entrada = await app.inject({
        method: "POST",
        url: "/api/teste-entrada",
        payload: { email: "invalido", senha: "curta" },
      });
      expect(entrada.statusCode).toBe(400);
      const saida = await app.inject({ method: "GET", url: "/api/teste-saida" });
      expect(saida.statusCode).toBe(500);
      expect(saida.json()).toEqual({ erro: "Erro interno do servidor." });
    } finally {
      await app.close();
    }
  });
});
