import { formatarMoeda } from "../lib/utils.js";

type PaymentSummaryProps = {
  subtotal: number;
  frete: number;
  total: number;
  metodo: string;
  processando: boolean;
  onVoltar: () => void;
  onConfirmar: () => void;
};

export function PaymentSummary({
  subtotal,
  frete,
  total,
  metodo,
  processando,
  onVoltar,
  onConfirmar,
}: PaymentSummaryProps) {
  return (
    <div className="confirm-backdrop" onClick={onVoltar}>
      <section className="payment-summary" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <span className="eyebrow">Resumo do pedido</span>
        <h2>Confirme sua compra</h2>
        <div className="summary-list">
          <div>
            <span>Produtos</span>
            <strong>{formatarMoeda(subtotal)}</strong>
          </div>
          <div>
            <span>Frete</span>
            <strong>{frete === 0 ? "Grátis" : formatarMoeda(frete)}</strong>
          </div>
          <div>
            <span>Método</span>
            <strong>{metodo.toUpperCase()}</strong>
          </div>
          <div className="summary-total">
            <span>Total final</span>
            <strong>{formatarMoeda(total)}</strong>
          </div>
        </div>
        <div className="confirm-actions">
          <button className="secondary-btn" type="button" onClick={onVoltar}>
            Voltar
          </button>
          <button className="primary-btn" type="button" disabled={processando} onClick={onConfirmar}>
            {processando ? "Confirmando..." : "Confirmar compra"}
          </button>
        </div>
      </section>
    </div>
  );
}
