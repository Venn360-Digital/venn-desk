import type { PrismaClient } from '#prisma'

import { appsAtivos } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { limiteDeAnexos, POLITICA_PADRAO, type PoliticaDeRetencao } from '../dominio/retencao.ts'

/**
 * A varredura de retenção (seção 10, Fase 8).
 *
 * Apaga do R2 o anexo que passou do prazo e marca a linha. A linha FICA: um
 * anexo citado numa conversa de três anos atrás viraria link quebrado sem
 * explicação, e com a marca o Console diz "removido pela política de retenção".
 *
 * **Teto por rodada, e por isso ela é diária.** Apagar dez mil arquivos num
 * minuto de cron estouraria o tempo do Worker; cem por app por dia escoa o
 * acúmulo sem nunca ser o trabalho mais caro do minuto.
 *
 * **O que esta varredura NÃO faz:** encerrar chamado velho. O prazo é de cinco
 * anos, o produto tem meses, e escrever agora a regra que vai rodar em 2031
 * seria escrever sem poder testá-la contra nada real.
 */
export const TETO_POR_APP = 100

export interface ResultadoDaRetencao {
    app: string
    expurgados: number
    falhas: number
}

export async function rodarRetencao(
    cliente: PrismaClient,
    opcoes: {
        agora?: Date
        politica?: PoliticaDeRetencao
        /** O bucket. Ausente, a varredura não roda: marcar sem apagar mentiria. */
        bucket?: { delete(chave: string): Promise<void> } | undefined
    }
): Promise<ResultadoDaRetencao[]> {
    if (opcoes.bucket === undefined) return []

    const agora = opcoes.agora ?? new Date()
    const limite = limiteDeAnexos(agora, opcoes.politica ?? POLITICA_PADRAO)
    const resultados: ResultadoDaRetencao[] = []

    for (const app of await appsAtivos(cliente)) {
        const escopo = escopoDoApp(cliente, app.id)
        let expurgados = 0
        let falhas = 0

        try {
            for (const anexo of await escopo.anexos.aExpurgar(limite, TETO_POR_APP)) {
                try {
                    await opcoes.bucket.delete(anexo.chave)
                    /**
                     * A marca vem DEPOIS de apagar, nunca antes.
                     *
                     * Marcar primeiro e falhar no R2 deixaria o arquivo lá para
                     * sempre, com a linha dizendo que ele saiu — o pior dos dois
                     * mundos, porque ninguém voltaria a olhar.
                     */
                    await escopo.anexos.marcarExpurgado(anexo.id, agora)
                    expurgados += 1
                } catch (erro) {
                    falhas += 1
                    console.error('[retencao] não apaguei o anexo:', anexo.id, erro)
                }
            }
        } catch (erro) {
            console.error(`[retencao] falhou em ${app.slug}:`, erro)
        }

        if (expurgados > 0 || falhas > 0) resultados.push({ app: app.slug, expurgados, falhas })
    }

    return resultados
}
