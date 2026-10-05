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
  // Comparação estrita dupla em vez de `!= null`: a mesma checagem, sem a
  // comparação frouxa que o oxlint rejeita.
  const hasBody = options?.body !== undefined && options?.body !== null;
  const resposta = await fetch(`${BASE_URL}${url}`, {
    headers: hasBody ? { "Content-Type": "application/json" } : {},
    credentials: "include",
    ...options,
  });

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new ApiError(resposta.status, dados.erro || "Erro inesperado");
  }

  return dados as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) => request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
