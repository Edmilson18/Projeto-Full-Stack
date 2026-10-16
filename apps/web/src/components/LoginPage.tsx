import { useEffect, useState } from "react";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import type { RecuperarSenhaResponse, UsuarioPublico } from "@loja/shared";
import { limparTokenDaUrl } from "../lib/recuperacao.js";

type LoginPageProps = {
  tema: "claro" | "escuro";
  onToggleTema: () => void;
  onLogin: (email: string, senha: string) => Promise<UsuarioPublico>;
  onCadastrar: (nome: string, email: string, senha: string) => Promise<UsuarioPublico>;
  onRecuperarSenha: (email: string) => Promise<RecuperarSenhaResponse>;
  tokenInicial?: string;
  onRedefinirSenha: (token: string, senha: string) => Promise<void>;
  onFechar: () => void;
  onMensagem: (msg: string) => void;
};

export function LoginPage({
  tema,
  onToggleTema,
  onLogin,
  onCadastrar,
  onRecuperarSenha,
  onRedefinirSenha,
  onFechar,
  onMensagem,
  tokenInicial,
}: LoginPageProps) {
  const [modoCadastro, setModoCadastro] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [recuperacaoAberta, setRecuperacaoAberta] = useState(false);
  const [emailRecuperacao, setEmailRecuperacao] = useState("");
  const [tokenRecuperacao, setTokenRecuperacao] = useState(
    () => tokenInicial ?? new URLSearchParams(window.location.search).get("resetToken") ?? "",
  );
  useEffect(() => {
    limparTokenDaUrl();
  }, []);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmacaoNovaSenha, setConfirmacaoNovaSenha] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    try {
      if (modoCadastro) {
        await onCadastrar(nome, email, senha);
      } else {
        await onLogin(email, senha);
      }
      onFechar();
    } catch (err) {
      onMensagem(err instanceof Error ? err.message : "Erro ao entrar.");
    } finally {
      setCarregando(false);
    }
  };

  const handleRecuperar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    try {
      const resposta = await onRecuperarSenha(emailRecuperacao);
      onMensagem(resposta.mensagem);
      if (resposta.token) setTokenRecuperacao(resposta.token);
      setRecuperacaoAberta(false);
    } catch (err) {
      onMensagem(err instanceof Error ? err.message : "Erro ao recuperar senha.");
    } finally {
      setCarregando(false);
    }
  };

  const handleRedefinir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (novaSenha !== confirmacaoNovaSenha) {
      onMensagem("As senhas não conferem.");
      return;
    }
    setCarregando(true);
    try {
      await onRedefinirSenha(tokenRecuperacao, novaSenha);
      setTokenRecuperacao("");
      setNovaSenha("");
      setConfirmacaoNovaSenha("");
    } catch (err) {
      onMensagem(err instanceof Error ? err.message : "Erro ao redefinir senha.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className={`login-page tema-${tema}`}>
      <button
        className="theme-toggle login-theme-toggle"
        aria-label={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
        title={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
        onClick={onToggleTema}
      >
        {tema === "claro" ? <Moon size={17} strokeWidth={2} /> : <Sun size={17} strokeWidth={2} />}
      </button>
      <div className="login-card">
        <div className="brand-block">
          <span className="badge">Loja Tech</span>
          <h1>Bem-vindo</h1>
          <p>Gerencie seu negócio com tecnologia, velocidade e confiança.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {modoCadastro && (
            <label>
              Nome completo
              <input type="text" required minLength={2} value={nome} onChange={(e) => setNome(e.target.value)} />
            </label>
          )}
          <label>
            E-mail
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          <label>
            Senha
            <span className="password-field">
              <input
                type={mostrarSenha ? "text" : "password"}
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setMostrarSenha((atual) => !atual)}
              >
                {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          <button type="submit" className="primary-btn" disabled={carregando}>
            {carregando ? "Aguarde..." : modoCadastro ? "Criar conta" : "Entrar"}
          </button>
        </form>

        {!modoCadastro && (
          <button type="button" className="text-btn" onClick={() => setRecuperacaoAberta(true)}>
            Esqueci minha senha
          </button>
        )}

        <button
          type="button"
          className="secondary-btn full"
          onClick={() => {
            setModoCadastro((atual) => !atual);
            setNome("");
            setSenha("");
            // O e-mail é preservado de propósito: quem acabou de tentar entrar
            // com um endereço que não tem conta precisa digitá-lo de novo para
            // se cadastrar. A mensagem é limpa junto, senão o erro de login
            // continua na tela acima do formulário de cadastro.
            onMensagem("");
          }}
        >
          {modoCadastro ? "Já tenho uma conta" : "Criar uma nova conta"}
        </button>
        <button
          type="button"
          className="text-btn guest-access"
          onClick={() => {
            onFechar();
          }}
        >
          Continuar sem conta
        </button>
      </div>

      {(recuperacaoAberta || tokenRecuperacao) && (
        <div className="modal-backdrop">
          <form
            className="recovery-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-recuperacao"
            onSubmit={tokenRecuperacao ? handleRedefinir : handleRecuperar}
          >
            <button
              type="button"
              className="close-btn"
              onClick={() => {
                setRecuperacaoAberta(false);
                setTokenRecuperacao("");
              }}
            >
              ×
            </button>
            {tokenRecuperacao ? (
              <>
                <h2 id="titulo-recuperacao">Definir nova senha</h2>
                <p>Crie uma senha com pelo menos 6 caracteres.</p>
                <label>
                  Nova senha
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                  />
                </label>
                <label>
                  Confirmar senha
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmacaoNovaSenha}
                    onChange={(e) => setConfirmacaoNovaSenha(e.target.value)}
                  />
                </label>
                <button className="primary-btn full" disabled={carregando}>
                  {carregando ? "Salvando..." : "Salvar nova senha"}
                </button>
              </>
            ) : (
              <>
                <h2 id="titulo-recuperacao">Recuperar senha</h2>
                <p>A recuperação por e-mail ainda não está disponível nesta demonstração.</p>
                <label htmlFor="email-recuperacao">E-mail da conta</label>
                <input
                  id="email-recuperacao"
                  type="email"
                  required
                  value={emailRecuperacao}
                  onChange={(e) => setEmailRecuperacao(e.target.value)}
                  placeholder="voce@email.com"
                />
                <button className="primary-btn full" disabled={carregando}>
                  {carregando ? "Aguarde..." : "Solicitar recuperação"}
                </button>
              </>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
