import { ambiente } from "./config.js";
import { inicializarBanco, limparSessoesExpiradas } from "./database.js";
import { iniciar } from "./app.js";

/**
 * Ponto de entrada do processo.
 *
 * A criação do app fica em `app.ts`, separada deste arquivo, para que os testes
 * possam montar a instância sem abrir a porta. `server.ts` só sobe o processo
 * quando é executado diretamente.
 *
 * A verificação de execução direta é feita pelo TypeScript: este arquivo só é
 * executado diretamente quando é o entrypoint. Se for importado (por testes),
 * o código abaixo não roda.
 */
const executadoDiretamente = process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts");

if (executadoDiretamente) {
  await inicializarBanco();
  // Uma sessão vencida continuaria no banco até alguém reapresentar o token.
  // A limpeza na inicialização custa uma consulta e resolve.
  const { rowCount } = await limparSessoesExpiradas();
  if (rowCount) console.log(`Sessões expiradas removidas: ${rowCount}`);

  if (!process.env.NODE_ENV && !ambiente.producao) {
    console.warn(
      "[aviso] NODE_ENV não definido. Configure development, test ou production explicitamente no ambiente.",
    );
  }

  await iniciar(ambiente.porta);
  console.log(`Servidor da loja rodando em http://localhost:${ambiente.porta}`);
}
