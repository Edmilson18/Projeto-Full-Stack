import { aplicarMigracoes, fecharPool } from "./postgres.js";

/**
 * Aplica as migrações pendentes e encerra.
 *
 * Separado do seed para que a migração possa rodar sozinha — é o que o
 * `docker-entrypoint` do deploy faz antes de subir a aplicação nova.
 */
try {
  const aplicadas = await aplicarMigracoes();
  console.log(aplicadas.length > 0 ? `Migrações aplicadas: ${aplicadas.join(", ")}` : "Banco já está atualizado.");
} catch (erro) {
  console.error("Falha ao aplicar migrações:", erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
} finally {
  await fecharPool();
}
