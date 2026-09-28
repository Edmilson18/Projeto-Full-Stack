/**
 * Contratos compartilhados entre a API e o frontend.
 *
 * Este é o motivo de o projeto ser um monorepo: a mesma definição valida a
 * requisição no servidor e, por inferência, o tipo correspondente chega ao
 * componente React sem nenhuma anotação manual.
 *
 * `./schemas.ts` tem as entradas, validadas a cada requisição.
 * `./respostas.ts` tem as saídas, também validadas, porque é o que impede um
 * campo renomeado de virar `undefined` silencioso na tela.
 */

export * from "./schemas.js";
export * from "./respostas.js";
