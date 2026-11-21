import type { PrismaClient } from '#prisma'

import { appsAtivos } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { resumirConsultas } from '../dominio/consultas.ts'
import type { Fila } from '../lib/ambiente.ts'
import { elegivel, OCORRENCIAS_PARA_VIRAR_LACUNA } from './sugerir.ts'

/**
 * A varredura diária que alimenta a biblioteca de casos.
 *
 * Não gera artigo: enfileira. O que custa modelo roda na fila, uma mensagem
 * por caso, com o teto da fila valendo — senão um dia de muitos chamados
 * viraria uma conta de muitos dólares dentro de um cron de um minuto.
 *
 * Roda uma vez por dia porque é disso que se trata: um chamado que fechou hoje
 * não melhora por ser lido às três da manhã. O gancho do CSAT, que é imediato,
 * cuida da pressa; a varredura cuida do que ficou sem nota.
 */

export const DIAS_DE_VARREDURA = 30
/** Teto por rodada e por app, para o pior dia não virar uma conta grande. */
export const TETO_DA_VARREDURA = { chamados: 10, lacunas: 5 }

export interface AcaoDaVarredura {
    app: string
    chamadosEnfileirados: number
    lacunasEnfileiradas: number
    /** Por que os demais candidatos ficaram de fora, para o Console. */
    recusas: Record<string, number>
}

export async function varrerCandidatosASugestao(
    cliente: PrismaClient,
    p: { agora: Date; fila: Fila | undefined }
): Promise<AcaoDaVarredura[]> {
    if (p.fila === undefined) return []

    const desde = new Date(p.agora.getTime() - DIAS_DE_VARREDURA * 24 * 60 * 60 * 1000)
    const acoes: AcaoDaVarredura[] = []

    for (const app of await appsAtivos(cliente)) {
        const escopo = escopoDoApp(cliente, app.id)
        const recusas: Record<string, number> = {}

        /**
         * Os já vistos saem do caminho antes de a fila receber qualquer coisa.
         * A idempotência do `criarSugerido` cobriria o duplicado, mas só depois
         * de pagar o modelo — e a varredura roda todo dia sobre os mesmos
         * trinta dias.
         */
        const jaSugeridos = new Set(
            (await escopo.artigos.listar({ origem: 'SUGERIDO' })).map((a) => a.chave).filter((c): c is string => c !== null)
        )

        const candidatos = await escopo.chamados.candidatosASugestao(desde, 200)
        let chamados = 0
        for (const chamado of candidatos) {
            if (chamados >= TETO_DA_VARREDURA.chamados) break
            if (jaSugeridos.has(`sugerido:chamado:${chamado.id}`)) continue

            const veredito = elegivel(chamado, p.agora)
            if (!veredito.ok) {
                recusas[veredito.motivo] = (recusas[veredito.motivo] ?? 0) + 1
                continue
            }

            await p.fila.send({ tipo: 'sugerir-de-chamado', appId: app.id, ticketId: chamado.id })
            chamados += 1
        }

        const resumo = resumirConsultas(await escopo.artigos.consultas(desde))
        const lacunas = resumo.lacunas
            .filter((l) => l.vezes >= OCORRENCIAS_PARA_VIRAR_LACUNA)
            .slice(0, TETO_DA_VARREDURA.lacunas)

        for (const lacuna of lacunas) {
            await p.fila.send({ tipo: 'sugerir-de-lacuna', appId: app.id, exemplo: lacuna.exemplo, vezes: lacuna.vezes })
        }

        if (chamados > 0 || lacunas.length > 0 || Object.keys(recusas).length > 0) {
            acoes.push({ app: app.slug, chamadosEnfileirados: chamados, lacunasEnfileiradas: lacunas.length, recusas })
        }
    }

    return acoes
}
