import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api.js";
import { EVENTO_SESSAO_EXPIRADA, renovarEscopoSessao } from "../../lib/sessao.js";
import { respostaPendente } from "../ajuda.js";

describe("expiração da sessão nas requisições", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("avisa quando uma requisição da sessão atual recebe 401", async () => {
    const aviso = vi.fn();
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aviso);
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ erro: "Sessão expirada" }), { status: 401 })),
      );
      await expect(api.get("/conta")).rejects.toThrow("Sessão expirada");
      expect(aviso).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aviso);
    }
  });

  it("uma resposta antiga não encerra uma sessão nova", async () => {
    const pendente = respostaPendente<Response>();
    const aviso = vi.fn();
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aviso);
    try {
      vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendente.promise));
      const consulta = api.get("/conta");
      const rejeicao = expect(consulta).rejects.toMatchObject({ status: 401 });
      renovarEscopoSessao();
      pendente.resolver(new Response("{}", { status: 401 }));
      await rejeicao;
      expect(aviso).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aviso);
    }
  });

  it("credenciais incorretas não são tratadas como sessão expirada", async () => {
    const aviso = vi.fn();
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aviso);
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
      await expect(api.post("/login", { email: "a@exemplo.com", senha: "incorreta" })).rejects.toMatchObject({
        status: 401,
      });
      expect(aviso).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aviso);
    }
  });
});

describe("mensagens de erro da API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra o limite de tentativas em português mesmo se o servidor responder em inglês", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ erro: "Rate limit exceeded, retry in 1 minute" }), { status: 429 }),
        ),
    );

    await expect(api.post("/login", { email: "a@exemplo.com", senha: "incorreta" })).rejects.toMatchObject({
      status: 429,
      message: "Você fez muitas tentativas. Aguarde um minuto e tente novamente.",
    });
  });

  it("traduz falha de conexão para uma mensagem clara", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(api.get("/conta")).rejects.toMatchObject({
      status: 0,
      message: "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
    });
  });
});
