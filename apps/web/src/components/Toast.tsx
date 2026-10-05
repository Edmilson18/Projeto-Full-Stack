import { useEffect } from "react";

type ToastProps = {
  mensagem: string;
  /** Chamado quando o aviso expira, para o estado do `App` acompanhar o que está na tela. */
  onFechar: () => void;
  duracaoMs?: number;
};

const DURACAO_PADRAO_MS = 5000;

/**
 * Aviso flutuante. Ele expira sozinho: um aviso que fica preso na tela deixa de
 * ser aviso e vira decoração, e o usuário passa a não saber se aquilo ainda
 * importa. O papel de `status` faz leitores de tela anunciarem a mensagem sem
 * tirar o foco de quem está digitando.
 */
export function Toast({ mensagem, onFechar, duracaoMs = DURACAO_PADRAO_MS }: ToastProps) {
  useEffect(() => {
    if (!mensagem) return undefined;

    const timer = setTimeout(onFechar, duracaoMs);
    // Limpa o timer ao desmontar ou quando a mensagem muda, para o aviso
    // anterior não derrubar o novo que entrou no lugar dele.
    return () => clearTimeout(timer);
  }, [mensagem, duracaoMs, onFechar]);

  if (!mensagem) return null;

  return (
    <div className="toast-message" role="status">
      {mensagem}
    </div>
  );
}
