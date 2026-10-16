import { useCallback, useEffect, useRef, useState } from "react";
import type { FavoritoResponse } from "@loja/shared";
import { api, ApiError } from "../lib/api.js";
import { escopoSessaoAtual } from "../lib/sessao.js";

type UseFavoritosOptions = {
  usuarioLogado: boolean;
  usuarioId?: string | null;
  onErro?: (msg: string) => void;
};

/**
 * Chave usada pela versão anterior do app, que guardava os favoritos no
 * `localStorage`. Ninguém mais escreve nela, mas o valor continua no navegador
 * de quem usou aquela versão. É apagada na montagem para não deixar um dado
 * órfão que algum código futuro pode acabar lendo de novo.
 */
const CHAVE_FAVORITOS_LEGADA = "favoritosLoja";

/**
 * Os favoritos têm uma fonte da verdade só: o servidor.
 *
 * Com sessão, a lista vem de `GET /conta`. Sem sessão, a lista é vazia — o
 * clique no coração abre o pedido de login e não chega a favoritar nada, então
 * não existe favorito anônimo para guardar.
 *
 * Antes esta lista também era espelhada no `localStorage`, e essa segunda
 * fonte só sabia discordar do banco: nada a escrevia sem sessão e nada a
 * limpava no logout, então quem saía da conta continuava vendo o coração
 * marcado.
 */
export function useFavoritos({ usuarioLogado, usuarioId, onErro }: UseFavoritosOptions) {
  const dono = usuarioLogado ? (usuarioId ?? "sessao") : null;
  const [estado, setEstado] = useState<{ dono: string | null; ids: string[] }>({ dono, ids: [] });
  const favoritos = estado.dono === dono ? estado.ids : [];
  const donoAtual = useRef(dono);
  const geracao = useRef(0);
  const numeroOperacao = useRef(0);
  const confirmados = useRef(new Set<string>());
  const intencoes = useRef(new Map<string, { numero: number; desejado: boolean }>());
  const filas = useRef(new Map<string, Promise<void>>());

  // O `onErro` chega como `setMensagem`, que o React garante estável, mas a
  // assinatura permite qualquer função. Guardar numa ref deixa o `catch` usar
  // sempre a versão atual sem colocar a dependência no `useCallback` — assim o
  // `alternarFavorito` não é recriado a cada troca de callback do consumidor.
  // A escrita na ref fica no efeito, e não no corpo do render, porque valor de
  // ref lido durante a renderização é o que a regra `react(refs)` proíbe.
  const onErroRef = useRef(onErro);
  useEffect(() => {
    onErroRef.current = onErro;
  }, [onErro]);

  useEffect(() => {
    localStorage.removeItem(CHAVE_FAVORITOS_LEGADA);
  }, []);

  // Ao encerrar a sessão a lista é descartada. Sem este efeito, os favoritos
  // da conta que saiu continuavam visíveis para quem não entrou em conta
  // nenhuma — e a chamada é idempotente, então rodar com a lista já vazia não
  // provoca renderização extra.
  useEffect(() => {
    donoAtual.current = dono;
    geracao.current++;
    confirmados.current.clear();
    intencoes.current.clear();
    filas.current.clear();
    setEstado({ dono, ids: [] });
    return () => {
      geracao.current++;
    };
  }, [dono]);

  const setFavoritos = useCallback(
    (ids: string[]) => {
      if (!dono || donoAtual.current !== dono) return;
      confirmados.current = new Set(ids);
      const atuais = new Set(ids);
      for (const [id, intencao] of intencoes.current) {
        if (intencao.desejado) atuais.add(id);
        else atuais.delete(id);
      }
      setEstado({ dono, ids: [...atuais] });
    },
    [dono],
  );

  const alternarFavorito = useCallback(
    async (produtoId: string) => {
      // Sem sessão não há onde persistir o favorito, então a função é um no-op
      // em vez de pintar um coração que o servidor nunca vai confirmar.
      if (!dono || donoAtual.current !== dono) return;
      const desejado = !favoritos.includes(produtoId);
      const numero = ++numeroOperacao.current;
      const atual = geracao.current;
      const escopo = escopoSessaoAtual();
      const vigente = () => atual === geracao.current && escopo === escopoSessaoAtual();
      intencoes.current.set(produtoId, { numero, desejado });
      setEstado((anterior) => {
        const ids = new Set(anterior.dono === dono ? anterior.ids : []);
        if (desejado) ids.add(produtoId);
        else ids.delete(produtoId);
        return { dono, ids: [...ids] };
      });

      // Escritas do mesmo produto seguem a ordem dos cliques; outros produtos são independentes.
      const operacao = (filas.current.get(produtoId) ?? Promise.resolve())
        .then(async () => {
          if (!vigente()) return;
          await (desejado
            ? api.put<FavoritoResponse>(`/favoritos/${encodeURIComponent(produtoId)}`, {})
            : api.delete<FavoritoResponse>(`/favoritos/${encodeURIComponent(produtoId)}`));
          if (!vigente()) return;
          if (desejado) confirmados.current.add(produtoId);
          else confirmados.current.delete(produtoId);
        })
        .catch((err: unknown) => {
          if (!vigente() || intencoes.current.get(produtoId)?.numero !== numero) return;
          const confirmado = confirmados.current.has(produtoId);
          setEstado((anterior) => {
            if (anterior.dono !== dono) return anterior;
            const ids = new Set(anterior.ids);
            if (confirmado) ids.add(produtoId);
            else ids.delete(produtoId);
            return { dono, ids: [...ids] };
          });
          const avisar = onErroRef.current;
          if (err instanceof ApiError && err.status === 401) avisar?.("Sua sessão expirou. Faça login novamente.");
          else if (err instanceof Error) avisar?.(err.message);
        })
        .finally(() => {
          if (vigente() && intencoes.current.get(produtoId)?.numero === numero) intencoes.current.delete(produtoId);
          if (filas.current.get(produtoId) === operacao) filas.current.delete(produtoId);
        });
      filas.current.set(produtoId, operacao);
      await operacao;
    },
    [favoritos, dono],
  );

  return { favoritos, alternarFavorito, setFavoritos };
}
