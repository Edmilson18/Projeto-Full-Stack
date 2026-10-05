import { useState } from "react";
import { Trash2, ShoppingCart } from "lucide-react";
import type { ItemCarrinho } from "../hooks/useCarrinho.js";
import { formatarMoeda, imagemDe } from "../lib/utils.js";

type CartPanelProps = {
  carrinho: ItemCarrinho[];
  onAlterarQuantidade: (id: string, delta: number) => void;
  onRemoverItem: (id: string) => void;
  onLimparCarrinho: () => void;
  onFechar: () => void;
  onComprarSelecionados: (ids: string[]) => void;
};

export function CartPanel({
  carrinho,
  onAlterarQuantidade,
  onRemoverItem,
  onLimparCarrinho,
  onFechar,
  onComprarSelecionados,
}: CartPanelProps) {
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [itemParaRemover, setItemParaRemover] = useState<{ id: string; nome: string } | null>(null);
  const [confirmarLimpar, setConfirmarLimpar] = useState(false);

  const abrirConfirmacaoRemover = (id: string, nome: string) => {
    setItemParaRemover({ id, nome });
  };

  const fecharConfirmacaoRemover = () => {
    setItemParaRemover(null);
  };

  const confirmarRemocao = () => {
    if (itemParaRemover) {
      onRemoverItem(itemParaRemover.id);
      setItemParaRemover(null);
    }
  };

  const abrirConfirmacaoLimpar = () => {
    setConfirmarLimpar(true);
  };

  const fecharConfirmacaoLimpar = () => {
    setConfirmarLimpar(false);
  };

  const confirmarLimpeza = () => {
    onLimparCarrinho();
    setConfirmarLimpar(false);
  };

  const toggleSelecao = (id: string) => {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) {
        novo.delete(id);
      } else {
        novo.add(id);
      }
      return novo;
    });
  };

  const selecionarTodos = () => {
    if (selecionados.size === carrinho.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(carrinho.map((item) => item.id)));
    }
  };

  const totalSelecionado = carrinho
    .filter((item) => selecionados.has(item.id))
    .reduce((acc, item) => acc + item.preco * item.quantidadeCarrinho, 0);

  if (carrinho.length === 0) {
    return (
      <div className="cart-backdrop" onClick={onFechar}>
        <aside className="cart-panel" onClick={(e) => e.stopPropagation()}>
          <div className="cart-header">
            <div>
              <span className="eyebrow">Sua seleção</span>
              <h3>Meu carrinho</h3>
            </div>
            <button className="close-btn" onClick={onFechar}>
              ×
            </button>
          </div>
          <p className="cart-empty">
            Seu carrinho está vazio.
            <br />
            Escolha um produto para começar.
          </p>
        </aside>
      </div>
    );
  }

  return (
    <>
      <div className="cart-backdrop" onClick={onFechar}>
        <aside className="cart-panel" onClick={(e) => e.stopPropagation()}>
          <div className="cart-header">
            <div>
              <span className="eyebrow">Sua seleção</span>
              <h3>Meu carrinho</h3>
            </div>
            <button className="close-btn" onClick={onFechar}>
              ×
            </button>
          </div>

          <div className="cart-actions-top">
            <button className="text-btn" onClick={selecionarTodos}>
              {selecionados.size === carrinho.length ? "Desmarcar todos" : "Selecionar todos"}
            </button>
            <button className="text-btn danger" onClick={abrirConfirmacaoLimpar}>
              <Trash2 size={14} /> Limpar carrinho
            </button>
          </div>

          <div className="cart-items">
            {carrinho.map((item) => (
              <div className="cart-item" key={item.id}>
                <input
                  type="checkbox"
                  checked={selecionados.has(item.id)}
                  onChange={() => toggleSelecao(item.id)}
                  className="cart-checkbox"
                  aria-label={`Selecionar ${item.nome}`}
                />
                <img src={imagemDe(item)} alt={item.nome} />
                <div className="cart-item-info">
                  <strong>{item.nome}</strong>
                  <span>{formatarMoeda(item.preco)}</span>
                  <div className="quantity-controls">
                    <button onClick={() => onAlterarQuantidade(item.id, -1)}>-</button>
                    <b>{item.quantidadeCarrinho}</b>
                    <button onClick={() => onAlterarQuantidade(item.id, 1)}>+</button>
                  </div>
                </div>
                <button
                  className="remove-item-btn"
                  onClick={() => abrirConfirmacaoRemover(item.id, item.nome)}
                  aria-label={`Remover ${item.nome}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          {selecionados.size > 0 && (
            <div className="cart-footer">
              <div className="cart-summary">
                <span>
                  {selecionados.size === 1 ? "1 item selecionado" : `${selecionados.size} itens selecionados`}
                </span>
                <strong>{formatarMoeda(totalSelecionado)}</strong>
              </div>
              <button className="primary-btn full" onClick={() => onComprarSelecionados(Array.from(selecionados))}>
                <ShoppingCart size={18} />
                Comprar selecionados
              </button>
            </div>
          )}
        </aside>
      </div>

      {itemParaRemover && (
        <div className="confirm-backdrop" onClick={fecharConfirmacaoRemover}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmar-remover-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="confirm-icon">
              <Trash2 size={19} />
            </span>
            <h3 id="confirmar-remover-titulo">Remover item do carrinho?</h3>
            <p>
              Deseja realmente excluir <strong>{itemParaRemover.nome}</strong> do carrinho?
            </p>
            <div className="confirm-actions">
              <button className="secondary-btn" onClick={fecharConfirmacaoRemover}>
                Cancelar
              </button>
              <button className="primary-btn danger" onClick={confirmarRemocao}>
                <Trash2 size={14} /> Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmarLimpar && (
        <div className="confirm-backdrop" onClick={fecharConfirmacaoLimpar}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmar-limpar-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="confirm-icon">
              <Trash2 size={19} />
            </span>
            <h3 id="confirmar-limpar-titulo">Limpar carrinho?</h3>
            <p>
              Deseja realmente excluir <strong>todos os {carrinho.length} itens</strong> do carrinho?
            </p>
            <div className="confirm-actions">
              <button className="secondary-btn" onClick={fecharConfirmacaoLimpar}>
                Cancelar
              </button>
              <button className="primary-btn danger" onClick={confirmarLimpeza}>
                <Trash2 size={14} /> Limpar tudo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
