import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Toast } from "../../components/Toast.js";

/**
 * O aviso precisa sumir sozinho. Preso na tela, ele deixa de comunicar e passa
 * a parecer parte da tela, e o usuário não descobre mais se algo está errado.
 */
describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("não renderiza nada sem mensagem", () => {
    const { container } = render(<Toast mensagem="" onFechar={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("avisa ao expirar o tempo configurado", () => {
    vi.useFakeTimers();
    const onFechar = vi.fn();
    render(<Toast mensagem="E-mail ou senha inválidos." onFechar={onFechar} duracaoMs={5000} />);

    expect(screen.getByRole("status")).toHaveTextContent("E-mail ou senha inválidos.");

    vi.advanceTimersByTime(4999);
    expect(onFechar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it("reinicia a contagem quando a mensagem muda", () => {
    vi.useFakeTimers();
    const onFechar = vi.fn();
    const { rerender } = render(<Toast mensagem="primeira" onFechar={onFechar} duracaoMs={5000} />);

    vi.advanceTimersByTime(4000);
    rerender(<Toast mensagem="segunda" onFechar={onFechar} duracaoMs={5000} />);

    // O timer da mensagem anterior foi descartado: sem isso, a segunda
    // desapareceria 1s depois de aparecer.
    vi.advanceTimersByTime(4000);
    expect(onFechar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it("cancela o timer ao desmontar", () => {
    vi.useFakeTimers();
    const onFechar = vi.fn();
    const { unmount } = render(<Toast mensagem="aviso" onFechar={onFechar} duracaoMs={5000} />);

    unmount();
    vi.advanceTimersByTime(10_000);

    expect(onFechar).not.toHaveBeenCalled();
  });
});
