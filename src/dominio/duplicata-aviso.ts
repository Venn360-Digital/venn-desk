import type { Duplicata } from './triagem.ts'

/**
 * A nota interna que avisa da suspeita de duplicata.
 *
 * Nota interna, e não ação: nada é fechado nem vinculado automaticamente.
 * Fechar por semelhança de texto fecharia o chamado errado uma vez por semana,
 * e o cliente ficaria sem resposta sem que ninguém soubesse. Quem decide é
 * quem lê — a nota só poupa a descoberta.
 *
 * O prefixo do app entra para a nota ser legível fora do contexto (`ODB-1040`
 * diz mais que `1040` numa tela que mostra três produtos).
 */
export function avisoDeDuplicata(duplicatas: Duplicata[], prefixo: string): string | null {
    if (duplicatas.length === 0) return null

    const lista = duplicatas.map((d) => `${prefixo}-${d.numero} (${Math.round(d.nota * 100)}% das palavras)`).join(', ')

    return duplicatas.length === 1
        ? `Possível duplicata: este chamado parece ser o mesmo assunto de ${lista}. Confira antes de responder.`
        : `Possíveis duplicatas: ${lista}. Confira antes de responder.`
}
