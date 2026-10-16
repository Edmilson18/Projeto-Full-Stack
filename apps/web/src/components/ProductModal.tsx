import { useState } from "react";
import type { AvaliacaoResponse, ProdutoResponse, UsuarioPublico } from "@loja/shared";
import { formatarMoeda, imagemDe } from "../lib/utils.js";

type ProductModalProps = {
  produto: ProdutoResponse;
  usuario: UsuarioPublico | null;
  avaliacoes: AvaliacaoResponse[];
  /**
   * A pessoa pode avaliar este produto agora? Avaliação é restrita a quem comprou,
   * e a interface mostra o motivo quando a resposta é não.
   */
  podeAvaliar?: boolean;
  onFechar: () => void;
  onAdicionarAoCarrinho: (produto: ProdutoResponse) => void;
  onEnviarAvaliacao: (produtoId: string, nota: number, comentario: string) => Promise<void>;
  onMensagem: (msg: string) => void;
};

export function ProductModal({
  produto,
  usuario,
  avaliacoes,
  podeAvaliar = false,
  onFechar,
  onAdicionarAoCarrinho,
  onEnviarAvaliacao,
  onMensagem,
}: ProductModalProps) {
  const [notaAvaliacao, setNotaAvaliacao] = useState(5);
  const [comentarioAvaliacao, setComentarioAvaliacao] = useState("");
  const [enviando, setEnviando] = useState(false);

  const handleEnviarAvaliacao = async () => {
    if (!usuario) {
      onMensagem("Entre na sua conta para avaliar um produto.");
      return;
    }
    setEnviando(true);
    try {
      await onEnviarAvaliacao(produto.id, notaAvaliacao, comentarioAvaliacao);
      setComentarioAvaliacao("");
    } catch (err) {
      onMensagem(err instanceof Error ? err.message : "Erro ao enviar avaliação.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onFechar}>
          ×
        </button>
        <div className="modal-grid">
          <img src={imagemDe(produto)} alt={produto.nome} />
          {/* `modal-info` é a coluna que rola; a foto ao lado fica fixa. */}
          <div className="modal-info">
            <span className="tag">{produto.categoria}</span>
            <h3>{produto.nome}</h3>
            <p className="modal-price">{formatarMoeda(produto.preco)}</p>
            <p>{produto.descricao}</p>
            <ul className="feature-list">
              <li>Estoque disponível: {produto.quantidade}</li>
              <li>Entrega em até 5 dias úteis</li>
              <li>Pagamento seguro e suporte especializado</li>
            </ul>
            <div className="review-form">
              <strong>Avaliações ({avaliacoes.length})</strong>
              {avaliacoes.length ? (
                <div className="review-list">
                  {avaliacoes.map((avaliacao) => (
                    <article key={`${avaliacao.nome}-${avaliacao.criado_em}`}>
                      <div>
                        <strong>{avaliacao.nome}</strong>
                        <span>
                          {"★".repeat(avaliacao.nota)}
                          {"☆".repeat(5 - avaliacao.nota)}
                        </span>
                      </div>
                      {avaliacao.comentario && <p>{avaliacao.comentario}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="review-empty">Ainda não há avaliações para este produto.</p>
              )}
              {!usuario ? (
                <button className="secondary-btn" type="button" onClick={handleEnviarAvaliacao}>
                  Entre para avaliar
                </button>
              ) : !podeAvaliar ? (
                /* Mostrar o motivo em vez de sumir com o formulário: sem
                   isto a pessoa acha que a página quebrou, e não tem como
                   entender que existe uma regra. */
                <p className="review-locked">
                  <strong>Avalie este produto</strong>A avaliação fica disponível logo após a compra. Se já deixou sua
                  avaliação, uma nova compra permite atualizar a nota.
                </p>
              ) : (
                <>
                  <strong>Avalie este produto</strong>
                  <div>
                    <label>
                      Nota{" "}
                      <select value={notaAvaliacao} onChange={(e) => setNotaAvaliacao(Number(e.target.value))}>
                        {[5, 4, 3, 2, 1].map((nota) => (
                          <option key={nota} value={nota}>
                            {"★".repeat(nota)}
                            {"☆".repeat(5 - nota)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <textarea
                    value={comentarioAvaliacao}
                    onChange={(e) => setComentarioAvaliacao(e.target.value)}
                    maxLength={600}
                    placeholder="Conte sua experiência (opcional)"
                  />
                  <button className="secondary-btn" type="button" disabled={enviando} onClick={handleEnviarAvaliacao}>
                    {enviando ? "Enviando..." : "Enviar avaliação"}
                  </button>
                </>
              )}
            </div>
            <button
              className="primary-btn full"
              disabled={produto.quantidade < 1}
              onClick={() => {
                onAdicionarAoCarrinho(produto);
                onFechar();
              }}
            >
              {produto.quantidade < 1 ? "Produto indisponível" : "Adicionar ao carrinho"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
