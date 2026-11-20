import { z } from 'zod'

import { ancorar } from './ancorar.ts'
import type { Extrator } from './com-modelo.ts'
import { ErroDeExtracao, type Extracao } from '../tipos.ts'

/**
 * Os e-mails que o sistema envia, de `email/billing.ts`.
 *
 * Serve a uma pergunta que chega muito ao suporte e quase nunca tem resposta
 * escrita: "recebi este e-mail, o que ele quer dizer?". O catálogo é um objeto
 * com `subject` e `headline` por evento, com o nome da marca e a palavra do
 * nicho interpolados — então o modelo transcreve com placeholders e a
 * renderização resolve por app.
 */

export const esquemaDosEmails = z
    .object({
        emails: z
            .array(
                z
                    .object({
                        /** A chave do evento no código (`trial_ending`, `payment_received`). */
                        chave: z.string().trim().min(3).max(60),
                        assunto: z.string().trim().min(5).max(160),
                        titulo: z.string().trim().min(3).max(160),
                        /** Quando o sistema o manda, em palavras de quem recebe. */
                        quando: z.string().trim().min(10).max(300),
                    })
                    .strict()
            )
            .min(3),
    })
    .strict()

export type Emails = z.infer<typeof esquemaDosEmails>

const INSTRUCAO = `Você transcreve o catálogo de e-mails automáticos de um produto a partir do código que os define.
Para cada e-mail, devolva: a chave do evento como está no código, o assunto (subject), o título (headline) e "quando" — em que situação o sistema o envia, escrito para a equipe de suporte explicar a quem recebeu.
O nome da marca e as palavras do nicho são interpolados no código: escreva {{marca}} onde aparece BRAND().name, e {{organizacao}} ou {{Organizacao}} onde aparece ORG() ou o vocabulário — a forma exata (minúscula ou maiúscula) do original.
Transcreva o que está escrito; "quando" sai do nome do evento e do texto do próprio e-mail, não de suposição.`

export async function extrairEmails(billingTs: string, extrator: Extrator): Promise<Extracao<Emails>> {
    const { dados, consumo } = await extrator.extrair({
        esquema: esquemaDosEmails,
        instrucao: INSTRUCAO,
        arquivos: [{ caminho: 'packages/core/src/lib/email/billing.ts', conteudo: billingTs }],
        maxTokensSaida: 3_000,
    })

    /// Assunto e título existem no arquivo; "quando" é a tradução pedida.
    const afirmacoes = dados.emails.flatMap((e) => [e.chave, e.assunto, e.titulo])
    const ancoragem = ancorar(afirmacoes, [billingTs], [/\{\{marca\}\}/])
    if (!ancoragem.ok) {
        throw new ErroDeExtracao('emails', `textos que não existem no arquivo: ${ancoragem.soltas.slice(0, 5).join(' | ')}`, consumo)
    }

    return { dados, extraidoPor: 'modelo', consumo }
}
