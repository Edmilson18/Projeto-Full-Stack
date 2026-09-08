import type { Cupom, Produto, ResultadoCarrinho, Usuario } from "./models.js";

export function calcularCarrinho(
    itens: Produto[],
    usuario?: Usuario,
    codigoCupom?: string
): ResultadoCarrinho {
    if (itens.some((item) => item.preco < 0)) {
        throw new Error("O preço dos produtos não pode ser negativo.");
    }

    const agrupados = itens.reduce<Record<string, Produto & { quantidade: number }>>(
        (produtos, item) => {
            const produto = produtos[item.id];
            if (produto) {
                produto.quantidade += 1;
            } else {
                produtos[item.id] = { ...item, quantidade: 1 };
            }
            return produtos;
        },
        {}
    );

    const itensAgrupados = Object.values(agrupados).map((item) => ({
        ...item,
        subtotal: item.preco * item.quantidade,
    }));
    const subtotal = itensAgrupados.reduce((total, item) => total + item.subtotal, 0);
    const cupom = codigoCupom
        ? usuario?.cuponsPossuidos.find((item) => item.codigo === codigoCupom)
        : undefined;
    const percentual = Math.min(Math.max(cupom?.porcentagemDesconto ?? 0, 0), 100);
    const desconto = subtotal * (percentual / 100);
    const frete = subtotal > 150 ? 0 : 20;
    const totalFinal = subtotal - desconto + frete;

    return {
        itensAgrupados,
        subtotal,
        desconto,
        frete,
        totalFinal
    };
}