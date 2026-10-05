import { useCallback, useEffect, useState } from "react";
import type { UsuarioPublico } from "@loja/shared";
import { api } from "../lib/api.js";

export function useAuth() {
  const [usuario, setUsuario] = useState<UsuarioPublico | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api
      .get<{ usuario: UsuarioPublico | null }>("/sessao")
      .then((dados) => setUsuario(dados.usuario))
      .catch(() => setUsuario(null))
      .finally(() => setCarregando(false));
  }, []);

  const login = useCallback(async (email: string, senha: string) => {
    const dados = await api.post<{ usuario: UsuarioPublico }>("/login", { email, senha });
    setUsuario(dados.usuario);
    return dados.usuario;
  }, []);

  const cadastrar = useCallback(async (nome: string, email: string, senha: string) => {
    const dados = await api.post<{ usuario: UsuarioPublico }>("/cadastro", { nome, email, senha });
    setUsuario(dados.usuario);
    return dados.usuario;
  }, []);

  const logout = useCallback(async () => {
    await api.post("/logout", {});
    setUsuario(null);
  }, []);

  return { usuario, setUsuario, carregando, login, cadastrar, logout };
}
