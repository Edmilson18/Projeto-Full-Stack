import { LogIn, LogOut, Moon, ShoppingBag, Sun, UserRound } from "lucide-react";
import type { UsuarioPublico } from "@loja/shared";

type HeaderProps = {
  usuario: UsuarioPublico | null;
  tema: "claro" | "escuro";
  quantidadeCarrinho: number;
  onToggleTema: () => void;
  onAbrirLogin: () => void;
  onAbrirConta: () => void;
  onAbrirCarrinho: () => void;
  onSair: () => void;
};

export function Header({
  usuario,
  tema,
  quantidadeCarrinho,
  onToggleTema,
  onAbrirLogin,
  onAbrirConta,
  onAbrirCarrinho,
  onSair,
}: HeaderProps) {
  return (
    <header className="topbar">
      <div className="container nav">
        <div className="brand">Loja Tech</div>
        <nav>
          <a href="#produtos">Produtos</a>
          <a href="#destaques">Destaques</a>
          <a href="#sobre">Sobre</a>
          {usuario ? (
            <button
              className="account-toggle"
              aria-label="Abrir minha conta"
              title="Minha conta"
              onClick={onAbrirConta}
            >
              <UserRound size={17} />
            </button>
          ) : (
            <button className="account-toggle login-toggle" onClick={onAbrirLogin}>
              <LogIn size={17} /> Entrar
            </button>
          )}
          <button
            className="theme-toggle"
            aria-label={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
            title={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
            onClick={onToggleTema}
          >
            {tema === "claro" ? <Moon size={17} strokeWidth={2} /> : <Sun size={17} strokeWidth={2} />}
          </button>
          <button className="cart-toggle" aria-label="Abrir carrinho" title="Abrir carrinho" onClick={onAbrirCarrinho}>
            <ShoppingBag className="icon-cart" size={17} strokeWidth={2} />
            <span>{quantidadeCarrinho}</span>
          </button>
          {usuario && (
            <button className="logout-btn" aria-label="Sair da conta" title="Sair da conta" onClick={onSair}>
              <LogOut size={17} strokeWidth={2} />
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
