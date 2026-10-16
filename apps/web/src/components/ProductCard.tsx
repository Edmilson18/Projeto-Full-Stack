import { Heart } from "lucide-react";
import type { ProdutoResponse } from "@loja/shared";
import { formatarMoeda, imagemDe } from "../lib/utils.js";

type ProductCardProps = {
  produto: ProdutoResponse;
  variante?: "featured" | "default" | "compact";
  favorito?: boolean;
  onAbrir: (produto: ProdutoResponse) => void;
  onFavoritar: (id: string) => void;
  onAdicionar: (produto: ProdutoResponse) => void;
};

export function ProductCard({
  produto,
  variante = "default",
  favorito = false,
  onAbrir,
  onFavoritar,
  onAdicionar,
}: ProductCardProps) {
  if (variante === "compact") {
    return (
      <article className="product-card compact" onClick={() => onAbrir(produto)}>
        <img src={imagemDe(produto)} alt={produto.nome} />
        <div className="product-body">
          <h4>{produto.nome}</h4>
          <strong>{formatarMoeda(produto.preco)}</strong>
        </div>
      </article>
    );
  }

  return (
    <article className={`product-card ${variante === "featured" ? "featured" : ""}`} onClick={() => onAbrir(produto)}>
      <img src={imagemDe(produto)} alt={produto.nome} />
      <div className="product-body">
        <span className="tag">{produto.categoria}</span>
        <h4>{produto.nome}</h4>
        <p>{produto.descricao}</p>
        <div className="card-bottom">
          <strong>{formatarMoeda(produto.preco)}</strong>
          <div className="card-actions">
            <button
              className="favorite-btn"
              type="button"
              aria-label={favorito ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              aria-pressed={favorito}
              onClick={(e) => {
                e.stopPropagation();
                onFavoritar(produto.id);
              }}
            >
              <Heart size={17} fill={favorito ? "currentColor" : "none"} />
            </button>
            <button
              className="small-btn"
              onClick={(e) => {
                e.stopPropagation();
                onAdicionar(produto);
              }}
            >
              Adicionar
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
