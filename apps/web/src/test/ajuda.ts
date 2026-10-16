/** Controla a ordem das respostas sem depender de temporizadores ou rede. */
export function respostaPendente<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promise, resolver, rejeitar };
}
