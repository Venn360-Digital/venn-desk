/**
 * Quantos chamados reais existem, e com que desfecho.
 *
 * Existe para responder UMA pergunta antes de montar o conjunto de dúvidas: há
 * chamado real suficiente para servir de gabarito? Montar 150 dúvidas rotuladas
 * por mim mediria se o agente concorda comigo; montá-las a partir do desfecho
 * real mede se ele faz o que a equipe fez.
 *
 *   AMBIENTE=production node scripts/censo-de-chamados.mjs
 *
 * Só conta e agrupa. Não imprime conteúdo de chamado: isto roda no terminal e
 * assunto de cliente não precisa passar por tela nenhuma para eu saber quantos
 * existem.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const AMBIENTE = process.env.AMBIENTE ?? 'stg'

const arquivo = join(
    homedir(),
    '.venn360-secrets/venn-desk',
    AMBIENTE === 'production' ? 'neon-production.env' : 'neon-staging.env'
)

const linha = readFileSync(arquivo, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('export DATABASE_URL_APP='))
if (linha === undefined) throw new Error(`DATABASE_URL_APP não está em ${arquivo}`)

/// `criarCliente` recebe a URL por ARGUMENTO, não pelo ambiente: no Worker ela
/// vem do binding, e o módulo não lê `process.env` em lugar nenhum.
const url = linha.slice('export DATABASE_URL_APP='.length).trim().replace(/^['"]|['"]$/g, '')

const { criarCliente, descartarCliente } = await import('../src/dados/cliente.ts')
const cliente = criarCliente(url)

try {
    const apps = await cliente.app.findMany({ select: { id: true, slug: true } })

    console.log(`Censo em ${AMBIENTE}\n`)
    console.log('  app          total  resolvidos  com resposta  escalados')

    let totalGeral = 0

    for (const app of apps) {
        const [total, resolvidos, comResposta, escalados] = await Promise.all([
            cliente.ticket.count({ where: { appId: app.id, excluidoEm: null } }),
            cliente.ticket.count({
                where: { appId: app.id, excluidoEm: null, status: { in: ['RESOLVIDO', 'FECHADO'] } },
            }),
            /// Chamado que recebeu ao menos uma mensagem pública da equipe ou
            /// da IA: é o que caracteriza "foi respondido" de verdade.
            cliente.ticket.count({
                where: {
                    appId: app.id,
                    excluidoEm: null,
                    /// `messages`, e os autores são `IA` e `HUMANO` — escrevi
                    /// `mensagens` e `AGENTE` de memória, e o Prisma recusou os
                    /// dois. O esquema é em inglês nas relações e em português
                    /// nos campos.
                    messages: {
                        some: { visibilidade: 'PUBLICA', autor: { in: ['HUMANO', 'IA'] }, rascunho: false },
                    },
                },
            }),
            cliente.ticketEvent.count({
                where: { ticket: { appId: app.id }, evento: { startsWith: 'escalar:' } },
            }),
        ])

        totalGeral += total
        console.log(
            `  ${app.slug.padEnd(12)} ${String(total).padStart(5)}  ${String(resolvidos).padStart(10)}  ${String(comResposta).padStart(12)}  ${String(escalados).padStart(9)}`
        )
    }

    console.log(`\n  ${totalGeral} chamado(s) ao todo.`)
    console.log(
        totalGeral >= 150
            ? '  Dá para montar as 50 por app a partir de chamado real.'
            : '  NÃO dá: o conjunto teria de ser inventado, e dúvida inventada mede concordância comigo.'
    )
} finally {
    await descartarCliente(cliente)
}
