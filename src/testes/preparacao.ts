import fs from "node:fs";
import { inicializarBanco } from "../database.js";
import { ambiente } from "../config.js";

/**
 * Roda uma vez antes de qualquer teste.
 *
 * Apaga o banco de teste e recria a partir de `database/schema.sql`, de modo que
 * a suite nunca toque em `database/loja.db`, que é o banco de desenvolvimento.
 */
for (const sufixo of ["", "-journal", "-wal", "-shm"]) {
  fs.rmSync(`${ambiente.banco}${sufixo}`, { force: true });
}

inicializarBanco();
