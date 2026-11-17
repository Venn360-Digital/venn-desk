import type { AvisoDaSala } from './sala.ts'

/**
 * Empurra um aviso para quem está olhando aquele chamado.
 *
 * **Nunca lança.** O tempo real é conforto: se a sala não responder, o widget
 * continua relendo pela API. Deixar uma falha aqui derrubar a gravação de uma
 * mensagem seria trocar o essencial pelo acessório.
 */
export async function publicarNaSala(
    salas: DurableObjectNamespace | undefined,
    ticketId: string,
    aviso: AvisoDaSala
): Promise<void> {
    if (salas === undefined) return

    try {
        const id = salas.idFromName(ticketId)
        await salas.get(id).fetch('https://sala/publicar', {
            method: 'POST',
            body: JSON.stringify(aviso),
        })
    } catch (erro) {
        console.error('[tempo-real] falha ao publicar:', erro)
    }
}
