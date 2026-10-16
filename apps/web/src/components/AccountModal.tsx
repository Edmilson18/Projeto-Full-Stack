import { useState } from "react";
import { Heart } from "lucide-react";
import type { CepResponse, Conta, UsuarioPublico } from "@loja/shared";
import { formatarMoeda, imagemDe } from "../lib/utils.js";

type AccountModalProps = {
  usuario: UsuarioPublico;
  dadosConta: Conta | null;
  onFechar: () => void;
  onSalvarEndereco: (endereco: Record<string, string>) => Promise<void>;
  /**
   * Endereço vindo da geolocalização, quando a pessoa autorizou. Só entra nos
   * campos que estão vazios: um endereço já salvo é uma escolha dela e o
   * geocoding devolve a rua do quarteirão, que perderia número e complemento.
   */
  enderecoSugerido?: CepResponse | null;
  onDesfavoritar: (produtoId: string) => void;
  /**
   * Recebe o **id**, e não o produto. O favorito chega aqui sem a `categoria`
   * (vem de `ProdutoSemCategoria`), e o `ProductModal` mostra a categoria —
   * quem resolve para o produto completo é o App, que já tem o catálogo.
   */
  onAbrirProduto: (produtoId: string) => void;
  onMensagem: (msg: string) => void;
};

// Rótulos para os campos de endereço, na ordem em que aparecem no formulário.
const ROTULOS_ENDERECO: Record<string, string> = {
  cep: "CEP",
  rua: "Rua",
  numero: "Número",
  complemento: "Complemento",
  bairro: "Bairro",
  cidade: "Cidade",
  estado: "UF",
};

export function AccountModal({
  usuario,
  dadosConta,
  onFechar,
  onSalvarEndereco,
  enderecoSugerido,
  onDesfavoritar,
  onAbrirProduto,
  onMensagem,
}: AccountModalProps) {
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  // Perfil recebido depois da montagem preenche os campos ainda não editados.
  // Até um campo apagado pela pessoa prevalece sobre perfil e geolocalização.
  const endereco: Record<string, string> = {
    cep: dadosConta?.perfil.cep || enderecoSugerido?.cep || "",
    rua: dadosConta?.perfil.rua || enderecoSugerido?.rua || "",
    numero: dadosConta?.perfil.numero ?? "",
    complemento: dadosConta?.perfil.complemento ?? "",
    bairro: dadosConta?.perfil.bairro || enderecoSugerido?.bairro || "",
    cidade: dadosConta?.perfil.cidade || enderecoSugerido?.cidade || "",
    estado: dadosConta?.perfil.estado || enderecoSugerido?.estado || "",
    ...rascunho,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await onSalvarEndereco(endereco);
      onMensagem("Endereço salvo com sucesso.");
    } catch (err) {
      onMensagem(err instanceof Error ? err.message : "Erro ao salvar endereço.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onFechar}>
      <section
        className="account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-conta"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="close-btn" onClick={onFechar}>
          ×
        </button>
        <span className="eyebrow">MINHA CONTA</span>
        <h3 id="titulo-conta">Olá, {usuario.nome} 👋</h3>
        {!dadosConta ? (
          <p className="loading">Carregando sua conta...</p>
        ) : (
          <div className="account-grid">
            <div>
              <h4>Meus pedidos</h4>
              {dadosConta.pedidos.length ? (
                <div className="order-list">
                  {dadosConta.pedidos.map((pedido) => (
                    <article key={pedido.id} className="order-card">
                      <strong>#{pedido.id.slice(0, 8)}</strong>
                      <span>{pedido.status}</span>
                      <b>{formatarMoeda(pedido.total_final)}</b>
                      <small>
                        {(pedido.metodo_pagamento ?? "pix").toUpperCase()} · {pedido.status_pagamento ?? "pendente"}
                      </small>
                      <div>
                        {pedido.itens?.map((item) => (
                          <p key={item.produto_id}>
                            {item.quantidade}× {item.nome}
                          </p>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>Você ainda não fez pedidos.</p>
              )}
            </div>
            <div>
              <h4>Endereço de entrega</h4>
              <form className="address-form" onSubmit={handleSubmit}>
                {Object.entries(ROTULOS_ENDERECO).map(([campo, rotulo]) => (
                  <label key={campo}>
                    {rotulo}
                    <input
                      name={campo}
                      value={endereco[campo] ?? ""}
                      onChange={(e) => {
                        const valor = e.target.value;
                        setRascunho((anterior) => ({
                          ...anterior,
                          [campo]: campo === "estado" ? valor.toUpperCase() : valor,
                        }));
                      }}
                      inputMode={campo === "cep" ? "numeric" : undefined}
                      maxLength={campo === "cep" ? 9 : campo === "estado" ? 2 : undefined}
                      required={campo !== "complemento"}
                    />
                  </label>
                ))}
                <button className="primary-btn" type="submit" disabled={salvando}>
                  {salvando ? "Salvando..." : "Salvar endereço"}
                </button>
              </form>
              <div className="favorites-head">
                <h4>Favoritos</h4>
                {dadosConta.favoritos.length > 0 && (
                  <span className="favorites-count">{dadosConta.favoritos.length}</span>
                )}
              </div>
              {dadosConta.favoritos.length ? (
                <ul className="fav-list">
                  {dadosConta.favoritos.map((produto) => (
                    <li key={produto.id} className="fav-item">
                      {/* A imagem e o texto são um botão só, e o remover fica
                          ao lado como botão separado: aninhar um `<button>`
                          dentro de outro é HTML inválido, e o clique no remover
                          acabaria abrindo o produto. */}
                      <button
                        className="fav-abrir"
                        type="button"
                        aria-label={`Ver ${produto.nome}`}
                        onClick={() => onAbrirProduto(produto.id)}
                      >
                        <img src={imagemDe(produto)} alt="" />
                        <span className="fav-info">
                          <strong>{produto.nome}</strong>
                          <span>{formatarMoeda(produto.preco)}</span>
                          {produto.quantidade === 0 ? (
                            <small className="fav-tag sem-estoque">Indisponível</small>
                          ) : produto.quantidade <= 5 ? (
                            <small className="fav-tag pouco-estoque">Só {produto.quantidade} restantes</small>
                          ) : null}
                        </span>
                      </button>
                      <button
                        className="fav-remover"
                        type="button"
                        aria-label={`Remover ${produto.nome} dos favoritos`}
                        title="Remover dos favoritos"
                        onClick={() => onDesfavoritar(produto.id)}
                      >
                        <Heart size={15} fill="currentColor" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="fav-vazio">Nenhum favorito ainda. Toque no coração de um produto para salvá-lo aqui.</p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
