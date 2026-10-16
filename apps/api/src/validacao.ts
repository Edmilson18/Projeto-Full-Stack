import type { z } from "zod";
import { ErroApp } from "./erros.js";

/** Só a validação explícita da entrada pode produzir um erro 400. */
export function validarEntrada<T extends z.ZodType>(schema: T, dados: unknown): z.output<T> {
  const resultado = schema.safeParse(dados);
  if (!resultado.success) {
    throw ErroApp.badRequest(resultado.error.issues[0]?.message ?? "Dados inválidos.");
  }
  return resultado.data;
}
