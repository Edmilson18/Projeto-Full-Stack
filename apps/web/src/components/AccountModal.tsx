import { useEffect, useRef, useState } from "react";
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
  const [cep, setCep] = useState(dadosConta?.perfil.cep ?? "");
  const [rua, setRua] = useState(dadosConta?.perfil.rua ?? "");
  const [numero, setNumero] = useState(dadosConta?.perfil.numero ?? "");
  const [complemento, setComplemento] = useState(dadosConta?.perfil.complemento ?? "");
  const [bairro, setBairro] = useState(dadosConta?.perfil.bairro ?? "");
  const [cidade, setCidade] = useState(dadosConta?.perfil.cidade ?? "");
  const [estado, setEstado] = useState(dadosConta?.perfil.estado ?? "");
  const [salvando, setSalvando] = useState(false);

  // O endereço detectado chega depois do primeiro render, então o preenchimento
  // acontece em efeito. Só o que está vazio: quem já tem rua e número
  // cadastrados não deve ver o formulário sobrescrito pela rua do quarteirão,
  // que vem sem número e sem complemento.
  //
  // O `jaPreenchiu` corta o efeito na segunda passada. Sem ele, o efeito roda
  // de novo a cada tecla nos campos, porque eles estão na lista de dependências
  // — aí uma detecção atrasada sobrescreveria o que a pessoa já começou a
  // digitar.
  const jaPreenchiu = useRef(false);
  useEffect(() => {
    if (!enderecoSugerido || jaPreenchiu.current) return;
    jaPreenchiu.current = true;
    if (!cep && enderecoSugerido.cep) setCep(enderecoSugerido.cep);
    if (!rua && enderecoSugerido.rua) setRua(enderecoSugerido.rua);
    if (!bairro && enderecoSugerido.bairro) setBairro(enderecoSugerido.bairro);
    if (!cidade && enderecoSugerido.cidade) setCidade(enderecoSugerido.cidade);
    if (!estado && enderecoSugerido.estado) setEstado(enderecoSugerido.estado);
  }, [enderecoSugerido, cep, rua, bairro, cidade, estado]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await onSalvarEndereco({ cep, rua, numero, complemento, bairro, cidade, estado });
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
                      value={
                        campo === "cep"
                          ? cep
                          : campo === "rua"
                            ? rua
                            : campo === "numero"
                              ? numero
                              : campo === "complemento"
                                ? complemento
                                : campo === "bairro"
                                  ? bairro
                                  : campo === "cidade"
                                    ? cidade
                                    : estado
                      }
                      onChange={(e) => {
                        const valor = e.target.value;
                        if (campo === "cep") setCep(valor);
                        else if (campo === "rua") setRua(valor);
                        else if (campo === "numero") setNumero(valor);
                        else if (campo === "complemento") setComplemento(valor);
                        else if (campo === "bairro") setBairro(valor);
                        else if (campo === "cidade") setCidade(valor);
                        else if (campo === "estado") setEstado(valor);
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
                  {dadosConta.favoritos.map((produto, indice) => (
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
                        <img src={imagemDe(produto, indice)} alt="" />
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
