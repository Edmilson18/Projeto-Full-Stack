import { aplicarMigracoes, fecharPool } from "./postgres.js";

/**
 * Aplica as migrações pendentes e encerra.
 *
 * Separado do seed para que a migração possa rodar sozinha — é o que o
 * `docker-entrypoint` do deploy faz antes de subir a aplicação nova.
 */
const aplicadas = await aplicarMigracoes();
console.log(aplicadas.length > 0 ? `Migrações aplicadas: ${aplicadas.join(", ")}` : "Banco já está atualizado.");
await fecharPool();
