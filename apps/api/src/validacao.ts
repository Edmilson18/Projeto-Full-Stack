import type { z } from "zod";
import { ErroApp } from "./erros.js";

/** Só a validação explícita da entrada pode produzir um erro 400. */
export function validarEntrada<T extends z.ZodType>(schema: T, dados: unknown): z.output<T> {
  const resultado = schema.safeParse(dados);
  if (!resultado.success) {
    const problema = resultado.error.issues[0];
    const mensagemPadrao: Record<string, string> = {
      invalid_type: "Um ou mais campos têm formato inválido.",
      invalid_value: "Um ou mais valores informados são inválidos.",
      invalid_format: "Um ou mais campos estão em formato inválido.",
      too_small: "Um ou mais campos não atendem ao tamanho mínimo.",
      too_big: "Um ou mais campos ultrapassam o limite permitido.",
    };
    const mensagem = problema?.message ?? "";
    const mensagemEmIngles =
      /^(Invalid input|Invalid value|Too small|Too big|Invalid email|Invalid URL|Unrecognized key|Expected\b)/i.test(
        mensagem,
      );
    throw ErroApp.badRequest(
      mensagemEmIngles
        ? (mensagemPadrao[problema?.code ?? ""] ?? "Um ou mais campos são inválidos.")
        : mensagem || "Dados inválidos.",
    );
  }
  return resultado.data;
}
