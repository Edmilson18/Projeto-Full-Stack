import { useCallback, useEffect, useRef, useState } from "react";
import type { CepResponse } from "@loja/shared";
import { api } from "../lib/api.js";

type UseLocalizacaoOptions = {
  /**
   * Só pergunta quando há sessão. Sem conta não existe endereço para preencher,
   * e o navegador não faz ideia do motivo — ele apenas mostra um pedido de
   * permissão que não serve para nada e marca o site como invasivo.
   */
  usuarioLogado: boolean;
};

const TEMPO_LIMITE_MS = 10_000;

/** Estado da permissão de geolocalização, do ponto de vista do navegador. */
type EstadoPermissao = "granted" | "denied" | "prompt";

/**
 * Pergunta ao navegador se a permissão de geolocalização já foi concedida.
 *
 * A Permissions API é a única forma de saber disso **antes** de ler a posição.
 * `getCurrentPosition` não serve para o propósito: quando a permissão está
 * negada ele simplesmente falha, e quando está concedida devolve a posição sem
 * nunca perguntar — não dá para distinguir "não perguntou porque já tem" de
 * "não perguntou e mesmo assim leu".
 *
 * `"desconhecido"` quando a API não existe (navegadores antigos ou Firefox
 * com a Permissions API parcial). Aí a decisão fica com o `getCurrentPosition`,
 * que só entrega a posição se a permissão permitir.
 */
async function consultarPermissao(): Promise<EstadoPermissao | "desconhecido"> {
  const permissoes = navigator?.permissions;
  if (!permissoes?.query) return "desconhecido";

  try {
    // `PermissionState` do TypeScript já é exatamente este trio, então o
    // estado volta sem cast.
    const permissao = await permissoes.query({ name: "geolocation" });
    return permissao.state;
  } catch {
    // Safari e outros devolvem erro ao consultar uma permissão que não
    // reconhecem. Não é motivo para pular a checagem: o `getCurrentPosition`
    // ainda decide.
    return "desconhecido";
  }
}

/**
 * Preenche o endereço a partir da posição do navegador.
 *
 * A permissão é do **navegador**, não desta função: `getCurrentPosition` abre o
 * diálogo do próprio navegador e é ele que decide. Aqui só há duas
 * responsabilidades — não perguntar quando não há conta, e transformar a
 * coordenada em endereço pelas rotas da API.
 *
 * A posição não é enviada a outro lugar além da geocodificação reversa: a
 * coordenada vai para `api/localizacao/reversa`, que a resolve pelo Nominatim e
 * devolve CEP, rua, bairro, cidade e estado. O navegador já sabe dessa posição,
 * e guardá-la no banco seria um dado a mais sem uso no pedido.
 *
 * Quem nega recebe um silêncio. Negar permissão é uma resposta legítima, e um
 * aviso de erro a cada visita treina a pessoa a clicar em "não".
 */
export function useLocalizacao({ usuarioLogado }: UseLocalizacaoOptions) {
  const [detectando, setDetectando] = useState(false);
  // Um pedido por sessão. Sem isto, o efeito reage a cada re-renderização do
  // App e o navegador pode abrir o diálogo várias vezes seguidas.
  // Zera no logout: "ao entrar na conta" deve ter a chance de pedir novamente.
  const jaTentou = useRef(false);

  useEffect(() => {
    if (!usuarioLogado) {
      jaTentou.current = false;
      setDetectando(false);
    } else {
      jaTentou.current = false;
    }
  }, [usuarioLogado]);

  const detectarEndereco = useCallback(async (): Promise<CepResponse | null> => {
    if (!usuarioLogado || jaTentou.current) return null;
    if (typeof navigator === "undefined" || !navigator.geolocation) return null;

    jaTentou.current = true;

    // A permissão é do navegador e já foi decidida em algum momento por causa
    // da origem: o diálogo aparece uma vez só e a escolha fica guardada por
    // `localhost`. Por isso é preciso perguntar o estado antes de ler a posição —
    // quando está em `denied`, chamar `getCurrentPosition` não abre nada e é
    // justamente o que não queremos fazer.
    const estado = await consultarPermissao();
    if (estado === "denied") return null;

    setDetectando(true);

    try {
      const posicao = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: TEMPO_LIMITE_MS,
          // Só usado quando a permissão já vale. Com `granted` a posição em
          // cache evita a segunda leitura exata do GPS, que é lenta e consome
          // bateria sem ganho de precisão para um endereço.
          maximumAge: 5 * 60 * 1000,
          enableHighAccuracy: false,
        });
      });

      return await api.get<CepResponse>(
        `/localizacao/reversa?latitude=${posicao.coords.latitude}&longitude=${posicao.coords.longitude}`,
      );
    } catch {
      // Recusado, indisponível ou tempo esgotado: os três são fim de caminho
      // para o preenchimento automático, e a pessoa ainda pode usar o CEP.
      return null;
    } finally {
      setDetectando(false);
    }
  }, [usuarioLogado]);

  return { detectando, detectarEndereco };
}
