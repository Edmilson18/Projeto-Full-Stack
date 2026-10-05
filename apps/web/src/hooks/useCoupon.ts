import { useCallback, useState } from "react";
import type { ResultadoCupom } from "@loja/shared";
import { api } from "../lib/api.js";

type CupomStatus = {
  tipo: "idle" | "erro" | "sucesso";
  mensagem: string;
};

/**
 * Valida um cupom contra `/api/cupons/validar`.
 *
 * A rota responde **200 mesmo quando o cupom é recusado** — o resultado vem no
 * corpo como `{ valido: false, erro }`, discriminado por `valido`. Ler o corpo
 * como se fosse sucesso era o que tratava um cupom inexistente, expirado ou
 * inativo como aplicado.
 */
export function useCoupon() {
  const [status, setStatus] = useState<CupomStatus>({ tipo: "idle", mensagem: "" });
  const [validando, setValidando] = useState(false);

  const validar = useCallback(async (codigo: string): Promise<boolean> => {
    if (!codigo.trim()) {
      setStatus({ tipo: "idle", mensagem: "" });
      return true;
    }

    setValidando(true);
    try {
      const resultado = await api.post<ResultadoCupom>("/cupons/validar", { codigo });

      // O `valido: false` chega dentro do 200, então só o `catch` não basta.
      if (!resultado.valido) {
        setStatus({ tipo: "erro", mensagem: resultado.erro });
        return false;
      }

      setStatus({ tipo: "sucesso", mensagem: `Cupom ${resultado.codigo} aplicado com sucesso.` });
      return true;
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : "Cupom inválido.";
      setStatus({ tipo: "erro", mensagem });
      return false;
    } finally {
      setValidando(false);
    }
  }, []);

  const limpar = useCallback(() => {
    setStatus({ tipo: "idle", mensagem: "" });
  }, []);

  return { status, validando, validar, limpar };
}
