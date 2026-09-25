import path from "node:path";
import { fileURLToPath } from "node:url";
import { ambiente } from "./config.js";
import { inicializarBanco, limparSessoesExpiradas } from "./database.js";
import { iniciar } from "./app.js";

/**
 * Ponto de entrada do processo.
 *
 * A criação do app fica em `app.ts`, separada deste arquivo, para que os testes
 * possam montar a instância sem abrir a porta. `server.ts` só sobe o processo
 * quando é executado diretamente.
 */
const executadoDiretamente =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  await inicializarBanco();
  // Uma sessão vencida continuaria no banco até alguém reapresentar o token.
  // A limpeza na inicialização custa uma consulta e resolve.
  const { rowCount } = await limparSessoesExpiradas();
  if (rowCount) console.log(`Sessões expiradas removidas: ${rowCount}`);

  if (!process.env.NODE_ENV) {
    console.warn(
      "[aviso] NODE_ENV não definido. Assumindo 'development', o que expõe o token de " +
        "redefinição de senha na resposta de /api/recuperar-senha. Defina NODE_ENV no .env.",
    );
  }

  await iniciar(ambiente.porta);
  console.log(`Servidor da loja rodando em http://localhost:${ambiente.porta}`);
}
