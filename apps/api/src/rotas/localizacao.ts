import type { FastifyInstance } from "fastify";
import { cepResponse } from "@loja/shared";

/**
 * Consulta de CEP via ViaCEP.
 *
 * Serviço gratuito que não requer API key.
 * Documentaçao: https://viacep.com.br/
 */
/**
 * Extrai a sigla do estado a partir do código de subdivisão do Nominatim.
 *
 * Com `addressdetails=1` ele devolve `ISO3166-2-lvl4` como `BR-SP`, que é o
 * único campo com a sigla. O `state` traz o nome por extenso ("São Paulo"), e
 * o schema de endereço exige duas letras — mandar o nome inteiro faria o
 * preenchimento automático falhar na hora de salvar.
 *
 * Sem o código de subdivisão, resta o `state`: se já vierem duas letras serve
 * como está, e um nome extenso vira string vazia, que o formulário trata como
 * campo a preencher à mão.
 */
function ufDe(subdivisao: string | undefined, estado: string | undefined): string {
  if (subdivisao) {
    const partes = subdivisao.split("-");
    const sigla = partes.at(-1);
    if (sigla && /^[A-Za-z]{2}$/.test(sigla)) return sigla.toUpperCase();
  }
  if (estado && /^[A-Za-z]{2}$/.test(estado)) return estado.toUpperCase();
  return "";
}

export async function registrarRotasLocalizacao(app: FastifyInstance) {
  app.get("/api/cep/:cep", async (req, reply) => {
    const { cep } = req.params as { cep: string };
    const cepLimpo = cep.replace(/\D/g, "");

    if (cepLimpo.length !== 8) {
      return reply.code(400).send({ erro: "CEP inválido. Informe 8 dígitos." });
    }

    try {
      const resposta = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);

      if (!resposta.ok) {
        return reply.code(502).send({ erro: "Serviço de CEP indisponível." });
      }

      const dados = (await resposta.json()) as {
        erro?: string;
        cep?: string;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };

      if (dados.erro) {
        return reply.code(404).send({ erro: "CEP não encontrado." });
      }

      return cepResponse.parse({
        cep: dados.cep ?? cepLimpo,
        rua: dados.logradouro ?? "",
        bairro: dados.bairro ?? "",
        cidade: dados.localidade ?? "",
        estado: dados.uf ?? "",
      });
    } catch {
      return reply.code(502).send({ erro: "Não foi possível consultar o CEP." });
    }
  });

  /**
   * Geocoding reverso via Nominatim (OpenStreetMap).
   *
   * Serviço gratuito que não requer API key. Tem limite de 1 requisição por
   * segundo, então é adequado para uso em desenvolvimento e demonstração.
   *
   * Documentaçao: https://nominatim.org/release-docs/develop/api/Reverse/
   */
  app.get("/api/localizacao/reversa", async (req, reply) => {
    const { latitude, longitude } = req.query as { latitude?: string; longitude?: string };

    if (!latitude || !longitude) {
      return reply.code(400).send({ erro: "Informe latitude e longitude." });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return reply.code(400).send({ erro: "Latitude e longitude inválidas." });
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return reply.code(400).send({ erro: "Coordenadas fora do intervalo válido." });
    }

    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("lat", lat.toString());
      url.searchParams.set("lon", lon.toString());
      url.searchParams.set("format", "json");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("accept-language", "pt-BR");

      const resposta = await fetch(url.toString(), {
        headers: {
          "User-Agent": "LojaTech/1.0 (projeto educacional)",
        },
      });

      if (!resposta.ok) {
        return reply.code(502).send({ erro: "Serviço de localização indisponível." });
      }

      const dados = (await resposta.json()) as {
        address?: {
          postcode?: string;
          road?: string;
          suburb?: string;
          city?: string;
          town?: string;
          village?: string;
          municipality?: string;
          state?: string;
          "ISO3166-2-lvl4"?: string;
        };
      };

      const endereco = dados.address;
      if (!endereco) {
        return reply.code(404).send({ erro: "Endereço não encontrado para estas coordenadas." });
      }

      return cepResponse.parse({
        cep: endereco.postcode ?? "",
        rua: endereco.road ?? "",
        bairro: endereco.suburb ?? "",
        cidade: endereco.municipality ?? endereco.city ?? endereco.town ?? endereco.village ?? "",
        estado: ufDe(endereco["ISO3166-2-lvl4"], endereco.state),
      });
    } catch {
      return reply.code(502).send({ erro: "Não foi possível consultar o serviço de localização." });
    }
  });
}
