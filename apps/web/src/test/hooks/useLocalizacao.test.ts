import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLocalizacao } from "../../hooks/useLocalizacao.js";

const get = vi.fn();

vi.mock("../../lib/api.js", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }

  return {
    api: {
      get: (...args: unknown[]) => get(...args),
    },
    ApiError,
  };
});

const ENDERECO = {
  cep: "01001-000",
  rua: "Praça da Sé",
  bairro: "Sé",
  cidade: "São Paulo",
  estado: "SP",
};

/** Instala um `navigator.geolocation` que responde imediatamente. */
function stubGeolocation(implementacao?: GeolocationCallback) {
  const pedir = vi
    .fn()
    .mockImplementation((sucesso: PositionCallback) =>
      sucesso({ coords: { latitude: -23.55, longitude: -46.63 } } as GeolocationPosition),
    );
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition: implementacao ?? pedir },
  });
  return pedir;
}

/**
 * Os dois callbacks de `getCurrentPosition` juntos: o stub recebe um só
 * argumento e decide se responde pela posição ou pelo erro.
 */
type GeolocationCallback = (
  sucesso: (posicao: GeolocationPosition) => void,
  falha: (erro: GeolocationPositionError) => void,
) => void;

/** Objeto de erro mínimo, com as constantes que a interface exige. */
function erroDePosicao(code: number, message: string): GeolocationPositionError {
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
}

/**
 * A permissão é do navegador, mas a decisão de perguntar é nossa. Estes testes
 * travam a regra que o usuário pediu: sem sessão não há pedido de permissão nem
 * chamada à API, e com sessão a posição vai para a rota de geocodificação
 * reversa.
 */
describe("useLocalizacao", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue(ENDERECO);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("não pede permissão nem chama a API quando não há sessão", async () => {
    const pedir = stubGeolocation();

    const { result } = renderHook(() => useLocalizacao({ usuarioLogado: false }));

    await act(async () => {
      await result.current.detectarEndereco();
    });

    expect(pedir).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(result.current.detectando).toBe(false);
  });

  it("pede a posição e converte em endereço quando há sessão", async () => {
    const pedir = stubGeolocation();
    const { result } = renderHook(() => useLocalizacao({ usuarioLogado: true }));

    let detectado: typeof ENDERECO | null = null;
    await act(async () => {
      detectado = await result.current.detectarEndereco();
    });

    expect(pedir).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/localizacao/reversa?latitude=-23.55&longitude=-46.63");
    expect(detectado).toEqual(ENDERECO);
  });

  it("pergunta uma vez só, mesmo chamando de novo", async () => {
    const pedir = stubGeolocation();
    const { result } = renderHook(() => useLocalizacao({ usuarioLogado: true }));

    await act(async () => {
      await result.current.detectarEndereco();
      await result.current.detectarEndereco();
    });

    expect(pedir).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("volta vazio quando a permissão é negada, sem levantar erro", async () => {
    stubGeolocation((_sucesso: PositionCallback, falha: PositionErrorCallback) =>
      falha(erroDePosicao(1, "usuário negado")),
    );
    const { result } = renderHook(() => useLocalizacao({ usuarioLogado: true }));

    let detectado: unknown = "não chamou";
    await act(async () => {
      detectado = await result.current.detectarEndereco();
    });

    expect(detectado).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(result.current.detectando).toBe(false);
  });

  it("volta vazio quando a API de geocodificação falha", async () => {
    stubGeolocation();
    get.mockRejectedValueOnce(new Error("sem rede"));
    const { result } = renderHook(() => useLocalizacao({ usuarioLogado: true }));

    let detectado: unknown = "não chamou";
    await act(async () => {
      detectado = await result.current.detectarEndereco();
    });

    expect(detectado).toBeNull();
  });

  it("não tenta nada quando o navegador não expõe geolocalização", async () => {
    vi.stubGlobal("navigator", {});
    const { result } = renderHook(() => useLocalizacao({ usuarioLogado: true }));

    let detectado: unknown = "não chamou";
    await act(async () => {
      detectado = await result.current.detectarEndereco();
    });

    expect(detectado).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
