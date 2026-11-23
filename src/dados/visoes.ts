import type { PrismaClient } from '#prisma'
import { z } from 'zod'

/**
 * As visões salvas da fila (Fase 7).
 *
 * Fora do `escopoDoApp` de propósito, como a contabilidade de gastos: a fila do
 * Console é única e cruza os três produtos, então uma visão não pertence a app
 * nenhum. O recorte por app, quando existe, é só mais um filtro dentro dela.
 *
 * Quem vê o quê: a visão do time (sem agente) aparece para todos, e a pessoal só
 * para quem a criou. Mesma regra das macros, pelo mesmo motivo — o filtro que
 * alguém usa para organizar o próprio dia não é informação do time.
 */

/**
 * Os filtros aceitos, e só eles.
 *
 * `strict` porque uma chave desconhecida salva aqui viraria parâmetro ignorado
 * na query: a visão abriria a fila inteira e pareceria que o filtro deixou de
 * funcionar.
 */
export const esquemaDosFiltros = z
    .object({
        app: z.string().trim().max(40).optional(),
        empresa: z.string().trim().max(60).optional(),
        conta: z.string().trim().max(60).optional(),
        status: z.string().trim().max(120).optional(),
        prioridade: z.string().trim().max(60).optional(),
        numero: z.string().trim().max(20).optional(),
        sla: z.enum(['em_risco', 'estourado']).optional(),
        limite: z.number().int().min(1).max(200).optional(),
    })
    .strict()

export type FiltrosDaVisao = z.infer<typeof esquemaDosFiltros>

export interface VisaoSalva {
    id: string
    nome: string
    filtros: FiltrosDaVisao
    /** `true` quando é do time: todos veem. */
    doTime: boolean
}

export async function listarVisoes(cliente: PrismaClient, agenteId: string): Promise<VisaoSalva[]> {
    const linhas = await cliente.visaoSalva.findMany({
        where: { excluidoEm: null, OR: [{ agenteId: null }, { agenteId }] },
        orderBy: [{ agenteId: 'asc' }, { criadoEm: 'asc' }],
    })

    return linhas.flatMap((l) => {
        const filtros = esquemaDosFiltros.safeParse(l.filtros)
        /// Visão com filtro inválido é omitida, não quebra a lista: o esquema
        /// pode ter mudado desde que ela foi salva.
        if (!filtros.success) return []
        return [{ id: l.id, nome: l.nome, filtros: filtros.data, doTime: l.agenteId === null }]
    })
}

export async function criarVisao(
    cliente: PrismaClient,
    dados: { nome: string; filtros: FiltrosDaVisao; agenteId: string | null }
): Promise<{ id: string }> {
    return cliente.visaoSalva.create({
        data: {
            nome: dados.nome,
            filtros: dados.filtros as never,
            ...(dados.agenteId === null ? {} : { agenteId: dados.agenteId }),
        },
        select: { id: true },
    })
}

/**
 * Exclui a visão, se ela for de quem pede — ou do time, para quem pode.
 *
 * A checagem de dono mora aqui, e não na rota, porque é a mesma pergunta que a
 * listagem responde: sem ela, qualquer agente apagaria a visão pessoal de outro
 * sabendo o id.
 */
export async function excluirVisao(
    cliente: PrismaClient,
    id: string,
    quem: { agenteId: string; podeMexerNoTime: boolean },
    agora: Date
): Promise<boolean> {
    const alvo = await cliente.visaoSalva.findFirst({ where: { id, excluidoEm: null } })
    if (alvo === null) return false

    const minha = alvo.agenteId === quem.agenteId
    const doTime = alvo.agenteId === null
    if (!minha && !(doTime && quem.podeMexerNoTime)) return false

    const { count } = await cliente.visaoSalva.updateMany({
        where: { id, excluidoEm: null },
        data: { excluidoEm: agora },
    })
    return count === 1
}
