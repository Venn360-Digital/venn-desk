/**
 * Roda a bateria de atendimento contra o modelo de verdade, com a base de
 * verdade. É o aceite da Fase 4.
 *
 *   AMBIENTE=stg node scripts/avaliar-bateria.mjs odontobox --confirmar
 *   node scripts/avaliar-bateria.mjs odontobox --amostra        # o arquivo de amostra
 *   node scripts/avaliar-bateria.mjs odontobox --caso uso-...-1 # um caso só
 *   node scripts/avaliar-bateria.mjs odontobox --recorte        # só o que difere entre apps
 *
 * **Isto gasta dinheiro de verdade, e muito.** Cada caso é um atendimento
 * completo: 6 a 12 passos, 40 mil tokens de entrada, cerca de US$ 0,27. Cem
 * casos são US$ 27 por rodada e por app, e em 20/11/2026 as rodadas de
 * calibração somaram US$ 229 num dia sem ninguém ver a conta crescer, porque o
 * custo só era impresso na tela.
 *
 * Três freios, desde então:
 * 1. a estimativa aparece ANTES e, acima de `AVISO_USD`, exige `--confirmar`;
 * 2. `TETO_USD` interrompe a rodada quando o acumulado passa do teto;
 * 3. toda rodada é registrada em `docs/medicoes/bateria.jsonl`.
 *
 * **A busca aqui é a por palavra, sem vetor** (o Workers AI vive no Worker).
 * Isso faz da bateria o PIOR caso: o que passa aqui passa em produção, onde a
 * busca é híbrida. Sai no relatório, para ninguém ler o número como teto.
 *
 * A chave sai do cofre e não é impressa. Exit 1 quando o aceite não é atingido.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createAnthropic } from '@ai-sdk/anthropic'
import { Client } from 'pg'

import { montarRelatorio, passouNoAceite, PISO_DE_ACEITE } from '../src/avaliacao/bateria.ts'
import { rodarCasoDaBateria } from '../src/avaliacao/rodar-bateria.ts'

const AMBIENTE = process.env.AMBIENTE ?? 'production'
const argumentos = process.argv.slice(2)
const app = argumentos.find((a) => !a.startsWith('--'))
const AMOSTRA = argumentos.includes('--amostra')
const SO_ESTE = argumentos.includes('--caso') ? argumentos[argumentos.indexOf('--caso') + 1] : null
const PARALELO = Number(process.env.PARALELO ?? '4')
const RECORTE = argumentos.includes('--recorte')
const CONFIRMADO = argumentos.includes('--confirmar')
/** Custo médio por caso, medido em 20/11/2026 (US$ 27,13 em 100 casos). */
const USD_POR_CASO = 0.27
const AVISO_USD = Number(process.env.AVISO_USD ?? '5')
const TETO_USD = Number(process.env.TETO_USD ?? '35')
if (!app) { console.error('informe o slug do app'); process.exit(2) }

const doCofre = (arquivo, nome) => {
    const linha = readFileSync(join(homedir(), '.venn360-secrets/venn-desk', arquivo), 'utf8')
        .split('\n').find((l) => l.startsWith(`export ${nome}=`))
    if (!linha) throw new Error(`${nome} não está em ${arquivo}`)
    return linha.slice(`export ${nome}=`.length).trim().replace(/^['"]|['"]$/g, '')
}

const todosOsCasos = JSON.parse(readFileSync(`src/avaliacao/baterias/${app}${AMOSTRA ? '-amostra' : ''}.json`, 'utf8'))
    .filter((c) => SO_ESTE === null || c.id === SO_ESTE)
if (todosOsCasos.length === 0) { console.error('nenhum caso'); process.exit(2) }

const banco = AMBIENTE === 'stg' ? 'neon-staging.env' : 'neon-production.env'
const cliente = new Client({ connectionString: doCofre(banco, 'DATABASE_URL_APP') })
await cliente.connect()
const { rows: artigos } = await cliente.query(
    `select k.id, k.chave, k.titulo, k.corpo, k.tags, k.status, k.origem, k.fonte, k.dados, k.sincronizado_em "sincronizadoEm"
     from kb_articles k join apps a on a.id = k.app_id
     where a.slug = $1 and k.status = 'PUBLICADO'`,
    [app]
)
const { rows: apps } = await cliente.query('select * from apps where slug = $1', [app])

/**
 * O recorte: num app secundário só vale medir o que DIFERE entre apps.
 *
 * Medido em 21/11/2026: 87 dos 100 casos são o mesmo caso com outro
 * vocabulário, e 97% dos artigos de tela são idênticos entre apps depois de
 * dobrar o vocabulário. Rodar os 100 nos três pagava três vezes pela mesma
 * prova. Ficam os casos cujo artigo de origem divergiu de fato e os que usam
 * uma palavra do vocabulário, que é o que muda a recuperação da busca.
 */
let casos = todosOsCasos
if (RECORTE) {
    const { rows } = await cliente.query(
        `select a.slug, a.nome, k.chave, k.titulo, k.corpo, s.resultado
         from kb_articles k join apps a on a.id = k.app_id
         left join lateral (
             select resultado from kb_sincronizacoes x
             where x.app_id = a.id and x.estado = 'concluida' order by x.terminada_em desc limit 1
         ) s on true
         where k.origem = 'DERIVADO' and k.status = 'PUBLICADO' and k.chave is not null`
    )
    const { chavesDoRecorte } = await import('../src/avaliacao/recorte.ts')
    const recorte = chavesDoRecorte(rows, app)
    casos = todosOsCasos.filter((c) => recorte.vale(c))
    console.log(`Recorte: ${casos.length} de ${todosOsCasos.length} casos (${recorte.porque})`)
}
await cliente.end()

const estimado = casos.length * USD_POR_CASO
console.log(`Estimativa: ${casos.length} caso(s) × US$ ${USD_POR_CASO.toFixed(2)} ≈ US$ ${estimado.toFixed(2)} (teto de corte: US$ ${TETO_USD.toFixed(2)})`)
if (estimado > AVISO_USD && !CONFIRMADO) {
    console.error(`\nIsto gasta cerca de US$ ${estimado.toFixed(2)} de verdade. Repita com --confirmar.`)
    process.exit(2)
}

const modelo = createAnthropic({ apiKey: doCofre(`worker-${AMBIENTE === 'stg' ? 'stg' : 'production'}.env`, 'ANTHROPIC_API_KEY') })('claude-sonnet-5')
const tarifa = { entradaPorMilhao: 3, saidaPorMilhao: 15 }
const appDoBanco = { ...apps[0], modoSombra: false, instrucoesDoAgente: apps[0]?.instrucoes_do_agente ?? null, nome: apps[0]?.nome, prefixo: apps[0]?.prefixo }

console.log(`Bateria de ${app} em ${AMBIENTE}: ${casos.length} caso(s), ${artigos.length} artigo(s) na base, busca por palavra (pior caso)\n`)

const fila = [...casos]
const resultados = []
let gasto = 0
let interrompida = false
const trabalhador = async () => {
    for (let caso = fila.shift(); caso !== undefined; caso = fila.shift()) {
        /// O teto corta a rodada, não o caso: estourar o orçamento é motivo
        /// para parar e olhar, nunca para seguir mais barato.
        if (gasto >= TETO_USD) { interrompida = true; break }
        try {
            const r = await rodarCasoDaBateria({ caso, modelo, app: appDoBanco, artigos, tarifa })
            gasto += r.custoEstimado ?? 0
            resultados.push(r)
            process.stdout.write(`${r.passou ? '.' : 'x'}`)
        } catch (erro) {
            resultados.push({ caso, passou: false, falhas: [`erro: ${erro.message.slice(0, 160)}`], aoCliente: '', desfecho: 'nada', artigosLidos: [], custoEstimado: 0 })
            process.stdout.write('!')
        }
    }
}
await Promise.all(Array.from({ length: PARALELO }, trabalhador))

const relatorio = montarRelatorio(app, resultados)
console.log(`\n\n${relatorio.passaram} de ${relatorio.total} (${Math.round((relatorio.passaram / relatorio.total) * 100)}%) · US$ ${relatorio.custoTotal.toFixed(2)}`)
console.log(`falhas: ${relatorio.falhasDuras} · passaram sem usar nenhum termo esperado: ${relatorio.comSinal} (vale ler uma amostra)\n`)

console.log('por categoria:')
for (const [categoria, c] of Object.entries(relatorio.porCategoria)) {
    const pct = Math.round((c.passaram / c.total) * 100)
    console.log(`  ${categoria.padEnd(11)} ${String(c.passaram).padStart(3)}/${String(c.total).padEnd(3)} ${pct}%`)
}

if (relatorio.reprovados.length > 0) {
    console.log(`\n${relatorio.reprovados.length} reprovado(s):`)
    for (const r of relatorio.reprovados) {
        console.log(`\n  [${r.caso.categoria}] ${r.caso.id}`)
        console.log(`  pergunta: ${r.caso.mensagem.slice(0, 150)}`)
        console.log(`  falhou: ${r.falhas.join(' · ')}`)
        console.log(`  respondeu: ${(r.aoCliente || '(nada)').replace(/\n/g, ' ').slice(0, 220)}`)
        if (r.caso.gabarito.artigoEsperado) console.log(`  artigo esperado: ${r.caso.gabarito.artigoEsperado} | leu: ${r.artigosLidos.join(', ') || '(nenhum)'}`)
    }
}

if (interrompida) {
    console.log(`\n⚠ rodada INTERROMPIDA pelo teto de US$ ${TETO_USD.toFixed(2)}: ${fila.length + 1} caso(s) não rodaram. O número abaixo não é aceite.`)
}

/**
 * O registro que faltava.
 *
 * Em 20/11/2026 o custo da bateria existia só no terminal, e ao fim do dia
 * ninguém sabia dizer quanto as rodadas de calibração tinham somado. Uma linha
 * por rodada, versionada, responde isso para sempre.
 */
mkdirSync('docs/medicoes', { recursive: true })
appendFileSync(
    'docs/medicoes/bateria.jsonl',
    `${JSON.stringify({
        em: new Date().toISOString(),
        app,
        ambiente: AMBIENTE,
        casos: relatorio.total,
        doArquivo: todosOsCasos.length,
        recorte: RECORTE,
        passaram: relatorio.passaram,
        custoUsd: Number(relatorio.custoTotal.toFixed(2)),
        interrompida,
    })}\n`
)

const passou = passouNoAceite(relatorio) && !interrompida
console.log(`\n${passou ? '✓' : '✗'} aceite da Fase 4 (${Math.round(PISO_DE_ACEITE * 100)}%): ${passou ? 'atingido' : 'NÃO atingido'}`)
process.exit(passou ? 0 : 1)
