import { escopoSessaoAtual, EVENTO_SESSAO_EXPIRADA } from "./sessao.js";

const BASE_URL = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const escopo = escopoSessaoAtual();
  // Comparação estrita dupla em vez de `!= null`: a mesma checagem, sem a
  // comparação frouxa que o oxlint rejeita.
  const hasBody = options?.body !== undefined && options?.body !== null;
  const headers = new Headers(options?.headers);
  if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const resposta = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    if (resposta.status === 401 && url !== "/login" && escopo === escopoSessaoAtual()) {
      window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    }
    throw new ApiError(resposta.status, dados.erro || "Erro inesperado");
  }

  return dados as T;
}

export const api = {
  get: <T>(url: string, options?: RequestInit) => request<T>(url, options),
  post: <T>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) => request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
