import { useCallback, useEffect, useRef, useState } from "react";
import type { FavoritoResponse } from "@loja/shared";
import { api, ApiError } from "../lib/api.js";

type UseFavoritosOptions = {
  usuarioLogado: boolean;
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
export function useFavoritos({ usuarioLogado, onErro }: UseFavoritosOptions) {
  const [favoritos, setFavoritos] = useState<string[]>([]);

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
    if (!usuarioLogado) setFavoritos([]);
  }, [usuarioLogado]);

  const alternarFavorito = useCallback(
    async (produtoId: string) => {
      // Sem sessão não há onde persistir o favorito, então a função é um no-op
      // em vez de pintar um coração que o servidor nunca vai confirmar.
      if (!usuarioLogado) return;

      const anterior = favoritos;
      const estavaFavorito = anterior.includes(produtoId);

      // A tela continua calculando o estado novo para responder na hora, mas o
      // servidor recebe o estado **desejado**, não um "alternar". Se a chamada
      // for repetida — clique duplo, retry de rede — o resultado é o mesmo, em
      // vez de o favorito ficar invertido.
      setFavoritos(estavaFavorito ? anterior.filter((id) => id !== produtoId) : [...anterior, produtoId]);

      try {
        await (estavaFavorito
          ? api.delete<FavoritoResponse>(`/favoritos/${encodeURIComponent(produtoId)}`)
          : api.put<FavoritoResponse>(`/favoritos/${encodeURIComponent(produtoId)}`, {}));
      } catch (err) {
        // Reverte ao estado anterior: o servidor é a fonte da verdade, e o
        // `catch` impede que a tela mostre um favorito que o banco não aceitou.
        setFavoritos(anterior);
        const avisar = onErroRef.current;
        if (err instanceof ApiError && err.status === 401) {
          avisar?.("Sua sessão expirou. Faça login novamente.");
        } else if (err instanceof Error) {
          avisar?.(err.message);
        }
      }
    },
    [favoritos, usuarioLogado],
  );

  return { favoritos, alternarFavorito, setFavoritos };
}
