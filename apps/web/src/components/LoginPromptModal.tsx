import { LogIn } from "lucide-react";

type LoginPromptModalProps = {
  titulo: string;
  mensagem: string;
  onIrParaLogin: () => void;
  onFechar: () => void;
};

export function LoginPromptModal({ titulo, mensagem, onIrParaLogin, onFechar }: LoginPromptModalProps) {
  return (
    <div className="modal-backdrop" onClick={onFechar}>
      <div
        className="login-prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-prompt-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="login-prompt-icon">
          <LogIn size={22} />
        </span>
        <h3 id="login-prompt-titulo">{titulo}</h3>
        <p>{mensagem}</p>
        <div className="login-prompt-actions">
          <button className="secondary-btn" onClick={onFechar}>
            Continuar navegando
          </button>
          <button className="primary-btn" onClick={onIrParaLogin}>
            Fazer login
          </button>
        </div>
      </div>
    </div>
  );
}
