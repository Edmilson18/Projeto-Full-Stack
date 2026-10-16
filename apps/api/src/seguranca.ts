/** A identificação do banco local considera o host, nunca credenciais ou caminho. */
export function bancoLocal(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      !url.searchParams.has("host") &&
      !url.searchParams.has("hostaddr") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Impede que parâmetros da URL rebaixem o TLS explicitamente habilitado. */
export function conexaoPostgres(databaseUrl: string, tls: boolean) {
  if (!tls) return { connectionString: databaseUrl };
  const url = new URL(databaseUrl);
  url.searchParams.set("sslmode", "verify-full");
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true } };
}

export function recuperacaoLocalHabilitada(nodeEnv: string | undefined, permitir: string | undefined): boolean {
  return nodeEnv === "development" && permitir === "true";
}
