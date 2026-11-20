import { z } from 'zod'

/**
 * Os tipos de campo que todo esquema de extração usa.
 *
 * **Por que num lugar só, e folgados.** Cada esquema que eu escrevi com limites
 * apertados custou uma rodada: `max(80)` num rótulo e `min(10)` numa frase
 * derrubaram 9 das 33 telas com "response did not match schema" — e a tela
 * INTEIRA, não o campo. Depois o mesmo erro voltou em papéis e em novidades,
 * porque escrevi aqueles esquemas antes de aprender. Centralizar é o que
 * impede a terceira vez.
 *
 * **O esquema é a forma, não o juízo.** Ele existe para o JSON ter os campos
 * certos nos tipos certos. Quem barra invenção é a ancoragem (`ancorar.ts`),
 * quem barra vazamento de detalhe interno é o detector de cada fonte. Apertar
 * limite aqui não protege nada: só troca uma extração boa por um erro.
 *
 * **`min` em lista é a forma mais traiçoeira disso.** `papeis: min(1)` numa
 * capacidade derrubou a fonte de permissões três vezes, porque existe uma
 * capacidade que de fato não pertence a papel nenhum (`daPlataforma`) — o
 * modelo devolvia a lista vazia com razão. Antes de escrever `min(1)`, pergunte
 * se o vazio é impossível ou só improvável; se for improvável, não é forma.
 */

/** Rótulo, nome, título: uma linha. */
export const curto = z.string().trim().min(1).max(160)

/** Uma ou duas frases de explicação. */
export const frase = z.string().trim().min(3).max(600)

/** Um parágrafo. */
export const texto = z.string().trim().min(3).max(2_000)

/** Trecho literal do arquivo que sustenta uma afirmação. */
export const evidencia = z.string().trim().min(3).max(400)

/** Quantos itens uma lista de extração aceita antes de ser erro de forma. */
export const MUITOS = 60
