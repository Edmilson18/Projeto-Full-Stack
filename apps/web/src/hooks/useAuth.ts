import { useCallback, useEffect, useRef, useState } from "react";
import type { UsuarioPublico } from "@loja/shared";
import { api } from "../lib/api.js";
import { escopoSessaoAtual, renovarEscopoSessao, EVENTO_SESSAO_EXPIRADA } from "../lib/sessao.js";

export function useAuth() {
  const [usuario, setUsuario] = useState<UsuarioPublico | null>(null);
  const [carregando, setCarregando] = useState(true);
  const operacao = useRef(0);

  const invalidarSessao = useCallback(() => {
    operacao.current++;
    renovarEscopoSessao();
    setUsuario(null);
    setCarregando(false);
  }, []);

  useEffect(() => {
    const atual = ++operacao.current;
    const escopo = renovarEscopoSessao();
    const controller = new AbortController();
    api
      .get<{ usuario: UsuarioPublico | null }>("/sessao", { signal: controller.signal })
      .then((dados) => {
        if (atual === operacao.current && escopo === escopoSessaoAtual()) setUsuario(dados.usuario);
      })
      .catch(() => {
        if (atual === operacao.current && escopo === escopoSessaoAtual()) setUsuario(null);
      })
      .finally(() => {
        if (atual === operacao.current && escopo === escopoSessaoAtual()) setCarregando(false);
      });
    return () => {
      operacao.current++;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, invalidarSessao);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, invalidarSessao);
  }, [invalidarSessao]);

  const autenticar = useCallback(async (rota: string, entrada: unknown) => {
    const atual = ++operacao.current;
    const escopo = renovarEscopoSessao();
    try {
      const dados = await api.post<{ usuario: UsuarioPublico }>(rota, entrada);
      if (atual === operacao.current && escopo === escopoSessaoAtual()) setUsuario(dados.usuario);
      return dados.usuario;
    } finally {
      if (atual === operacao.current && escopo === escopoSessaoAtual()) setCarregando(false);
    }
  }, []);

  const login = useCallback((email: string, senha: string) => autenticar("/login", { email, senha }), [autenticar]);

  const cadastrar = useCallback(
    (nome: string, email: string, senha: string) => autenticar("/cadastro", { nome, email, senha }),
    [autenticar],
  );

  const logout = useCallback(async () => {
    const atual = ++operacao.current;
    const escopo = renovarEscopoSessao();
    await api.post("/logout", {});
    if (atual === operacao.current && escopo === escopoSessaoAtual()) {
      setUsuario(null);
      setCarregando(false);
    }
  }, []);

  return { usuario, carregando, login, cadastrar, logout, invalidarSessao };
}
