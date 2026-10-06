import { afterEach, describe, expect, it, vi } from "vitest";
import { enderecoInput } from "@loja/shared";
import { registrarRotasLocalizacao } from "../rotas/localizacao.js";
import type { FastifyInstance } from "fastify";

/**
 * These tests do not touch the database: the geocoding route only calls out to
 * Nominatim. What matters here is the translation of Nominatim's response into
 * the shape the address form expects — in particular the state, which arrives
 * spelled out and has to leave as a two-letter UF.
 */

/** Builds the shape of a Nominatim `/reverse` response. */
function respostaDoNominatim(endereco: Record<string, string> | undefined) {
  return {
    ok: true,
    json: async () => ({ address: endereco }),
  } as unknown as Response;
}

/** Handlers registrados pela rota, para chamar direto sem subir o servidor. */
const rotas = new Map<string, Tratar>();

/**
 * Como o handler real: recebe `req.query` já como objeto e um `reply` que
 * encadeia `code().send()`.
 */
type Tratar = (req: { query: Record<string, string> }, reply: { code: (status: number) => Reply }) => unknown;

type Reply = { send: (corpo: unknown) => unknown };

/**
 * Roda a rota com o `fetch` apontado para uma resposta falsa do Nominatim.
 *
 * A rota não é testada pelo `inject` porque ela faz uma chamada externa: o
 * `inject` não ajuda a controlar o `fetch`. Registrar a rota num objeto mínimo
 * deixa o teste sobre a tradução da resposta, que é a parte que tem regra.
 */
async function consultar(query: string, corpoNominatim: Record<string, string> | undefined) {
  const app = {
    get: (rota: string, handler: Tratar) => {
      rotas.set(rota, handler);
    },
  } as unknown as FastifyInstance;

  await registrarRotasLocalizacao(app);

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaDoNominatim(corpoNominatim)));

  const replyEncadeado: Reply & { code: (n: number) => typeof replyEncadeado } = {
    send: (corpo) => corpo,
    code: function (n) {
      void n;
      return replyEncadeado;
    },
  };

  // A rota lê `req.query` como objeto, e não como texto de URL.
  const parametros = Object.fromEntries(new URLSearchParams(query));

  const handler = rotas.get("/api/localizacao/reversa");
  const resultado = (await handler?.({ query: parametros }, replyEncadeado)) as Record<string, string> | undefined;

  return resultado ?? {};
}

describe("geocodificação reversa", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tira a UF do código de subdivisão, e não do nome do estado", async () => {
    const resultado = await consultar("latitude=-23.55&longitude=-46.63", {
      postcode: "01016-020",
      road: "Rua Santa Teresa",
      suburb: "Glicério",
      city: "São Paulo",
      // O Nominatim devolve o nome por extenso; o formulário exige duas letras.
      state: "São Paulo",
      "ISO3166-2-lvl4": "BR-SP",
    });

    expect(resultado).toEqual({
      cep: "01016-020",
      rua: "Rua Santa Teresa",
      bairro: "Glicério",
      cidade: "São Paulo",
      estado: "SP",
    });
  });

  it("deixa a UF vazia quando o estado vem extenso e não há subdivisão", async () => {
    const resultado = await consultar("latitude=-33.86&longitude=151.2", {
      road: "Martin Place",
      city: "Sydney",
      state: "New South Wales",
    });

    // String vazia, e não "New South Wales": é o que o formulário já trata
    // como "campo a preencher à mão".
    expect(resultado.estado).toBe("");
  });

  it("aceita o estado quando ele já vem em duas letras", async () => {
    const resultado = await consultar("latitude=-23.55&longitude=-46.63", {
      city: "São Paulo",
      state: "sp",
    });

    expect(resultado.estado).toBe("SP");
  });

  it("prefere municipality a city no nome da cidade", async () => {
    const resultado = await consultar("latitude=-8.04&longitude=-34.87", {
      municipality: "Recife",
      city: "Recife",
      "ISO3166-2-lvl4": "BR-PE",
    });

    expect(resultado.cidade).toBe("Recife");
  });

  it("devolve um endereço que o schema de salvamento aceita", async () => {
    const resultado = await consultar("latitude=-23.55&longitude=-46.63", {
      postcode: "01016-020",
      road: "Rua Santa Teresa",
      suburb: "Glicério",
      city: "São Paulo",
      state: "São Paulo",
      "ISO3166-2-lvl4": "BR-SP",
    });

    // A integração que quebrou: `estado` chega com o nome inteiro e o
    // `enderecoInput` exige duas letras, então salvar falharia.
    expect(() =>
      enderecoInput.parse({
        ...resultado,
        cep: resultado.cep?.replace(/\D/g, "") ?? "",
        numero: "1",
        complemento: "",
      }),
    ).not.toThrow();
  });

  it("recusa coordenadas fora do intervalo", async () => {
    const resposta = await consultar("latitude=200&longitude=0", {});
    expect(resposta).toEqual({ erro: "Coordenadas fora do intervalo válido." });
  });

  it("recusa coordenadas que não são número", async () => {
    const resposta = await consultar("latitude=abc&longitude=0", {});
    expect(resposta).toEqual({ erro: "Latitude e longitude inválidas." });
  });

  it("recusa requisição sem coordenadas", async () => {
    const resposta = await consultar("", {});
    expect(resposta).toEqual({ erro: "Informe latitude e longitude." });
  });
});
