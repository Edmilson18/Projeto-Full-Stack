import { useMemo, useState } from "react";
import { Star } from "lucide-react";

/** Produto que a pessoa acabou de comprar e pode avaliar. */
export type AvaliacaoPendente = {
  produtoId: string;
  nome: string;
};

/** Avaliação que a pessoa já deixou nesse produto, se deixou. */
export type AvaliacaoExistente = {
  produtoId: string;
  nota: number;
  comentario: string | null;
};

export type NotaEnviada = {
  produtoId: string;
  nota: number;
  comentario: string;
};

type AvaliarCompraModalProps = {
  itens: AvaliacaoPendente[];
  /**
   * Avaliações que a pessoa já deixou. É o que transforma o campo em
   * "atualizar": sem isto, comprar de novo faria a mesma pessoa avaliar o mesmo
   * produto como se fosse a primeira vez.
   */
  jaAvaliadas?: readonly AvaliacaoExistente[];
  /** Resolve quando terminar; a mensagem devolvida é mostrada como aviso. */
  onEnviar: (notas: NotaEnviada[]) => Promise<string>;
  onFechar: () => void;
};

const NOTAS = [1, 2, 3, 4, 5];

/** Referência estável: um `[]` como padrão de prop nasce a cada render. */
const SEM_AVALIACAO: readonly AvaliacaoExistente[] = [];

/** Junta a lista de avaliações em um índice por produto. */
function indexar(avaliacoes: readonly AvaliacaoExistente[]): Map<string, AvaliacaoExistente> {
  return new Map(avaliacoes.map((avaliacao) => [avaliacao.produtoId, avaliacao]));
}

/**
 * Pede a avaliação logo depois da compra.
 *
 * A pergunta aparece no momento em que a pessoa ainda lembra da experiência:
 * a nota escrita agora vale mais do que a mesma nota guardada para a próxima
 * visita. Por isso a pergunta é um passo só, sem link para "depois" escondido —
 * quem não quiser, fecha.
 *
 * A nota começa em 0 **para produto novo** e na nota anterior **para quem já
 * avaliou**. Pré-marcada em 5, qualquer envio sem escolha viraria nota máxima —
 * e aí a média deixa de dizer alguma coisa, que é o que esta janela existe para
 * evitar.
 */
export function AvaliarCompraModal({
  itens,
  jaAvaliadas = SEM_AVALIACAO,
  onEnviar,
  onFechar,
}: AvaliarCompraModalProps) {
  const anteriores = useMemo(() => indexar(jaAvaliadas), [jaAvaliadas]);

  // O `useState` com função inicial só roda na montagem, e a janela é montada
  // nova a cada abertura — então é aqui que a avaliação anterior entra.
  const [notas, setNotas] = useState<Record<string, number>>(() =>
    Object.fromEntries(itens.map((item) => [item.produtoId, anteriores.get(item.produtoId)?.nota ?? 0])),
  );
  const [comentarios, setComentarios] = useState<Record<string, string>>(() =>
    Object.fromEntries(itens.map((item) => [item.produtoId, anteriores.get(item.produtoId)?.comentario ?? ""])),
  );
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const escolhidas = itens.filter((item) => notas[item.produtoId]);
  /** Quantas das escolhidas já tinham avaliação: essas viram atualização. */
  const atualizacoes = escolhidas.filter((item) => anteriores.has(item.produtoId)).length;
  const novas = escolhidas.length - atualizacoes;

  const podeEnviar = escolhidas.length > 0 && !enviando;

  const rotuloEnviar =
    escolhidas.length === 0
      ? "Escolha uma nota"
      : novas === 0
        ? atualizacoes === 1
          ? "Atualizar avaliação"
          : `Atualizar ${atualizacoes} avaliações`
        : novas === 1
          ? "Enviar avaliação"
          : `Enviar ${novas} avaliações`;

  const enviar = async () => {
    if (!podeEnviar) return;
    setEnviando(true);
    setErro("");
    try {
      await onEnviar(
        escolhidas.map((item) => ({
          produtoId: item.produtoId,
          nota: notas[item.produtoId] ?? 5,
          comentario: (comentarios[item.produtoId] ?? "").trim(),
        })),
      );
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível enviar a avaliação.");
      setEnviando(false);
    }
  };

  return (
    <div className="confirm-backdrop" onClick={onFechar}>
      <section
        className="rate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-avaliar"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="close-btn" onClick={onFechar} aria-label="Fechar avaliação">
          ×
        </button>
        <span className="eyebrow">SUA OPINIÃO IMPORTA</span>
        <h2 id="titulo-avaliar">{atualizacoes > 0 ? "Atualize sua avaliação" : "O que você achou?"}</h2>
        <p className="rate-intro">
          {atualizacoes > 0 && atualizacoes === itens.length
            ? "Você já avaliou estes produtos. Ajuste a nota ou o comentário se algo mudou."
            : itens.length === 1
              ? "Conte como foi sua experiência com o produto que você acabou de comprar."
              : "Conte como foi sua experiência com os produtos que você acabou de comprar."}
        </p>

        <div className="rate-list">
          {itens.map((item) => (
            <div className={`rate-item ${anteriores.has(item.produtoId) ? "reavaliando" : ""}`} key={item.produtoId}>
              <strong>{item.nome}</strong>
              {anteriores.has(item.produtoId) && (
                <span className="rate-reevaliar">Sua avaliação atual: {anteriores.get(item.produtoId)?.nota} ★</span>
              )}
              <div className="rate-stars" role="group" aria-label={`Nota para ${item.nome}`}>
                {NOTAS.map((nota) => (
                  <button
                    key={nota}
                    type="button"
                    className={`rate-star ${(notas[item.produtoId] ?? 0) >= nota ? "ligada" : ""}`}
                    aria-label={`${nota} ${nota === 1 ? "estrela" : "estrelas"}`}
                    aria-pressed={(notas[item.produtoId] ?? 0) === nota}
                    onClick={() =>
                      setNotas((atual) => ({
                        ...atual,
                        // Clicar de novo na mesma nota desmarca, em vez de
                        // exigir um clique extra para limpar.
                        [item.produtoId]: atual[item.produtoId] === nota ? 0 : nota,
                      }))
                    }
                  >
                    <Star size={26} fill="currentColor" />
                  </button>
                ))}
              </div>
              <textarea
                value={comentarios[item.produtoId] ?? ""}
                onChange={(event) => setComentarios((atual) => ({ ...atual, [item.produtoId]: event.target.value }))}
                maxLength={600}
                placeholder="Comentário (opcional)"
                aria-label={`Comentário sobre ${item.nome}`}
              />
            </div>
          ))}
        </div>

        {erro && <p className="rate-erro">{erro}</p>}

        <div className="rate-actions">
          <button className="ghost-btn" type="button" onClick={onFechar} disabled={enviando}>
            Agora não
          </button>
          <button className="primary-btn" type="button" onClick={enviar} disabled={!podeEnviar}>
            {enviando ? "Enviando..." : rotuloEnviar}
          </button>
        </div>
      </section>
    </div>
  );
}
