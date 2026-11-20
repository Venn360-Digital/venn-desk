/**
 * Roda a bateria de atendimento contra o modelo de verdade, com a base de
 * verdade. É o aceite da Fase 4.
 *
 *   AMBIENTE=stg node scripts/avaliar-bateria.mjs odontobox
 *   node scripts/avaliar-bateria.mjs odontobox --amostra        # o arquivo de amostra
 *   node scripts/avaliar-bateria.mjs odontobox --caso uso-...-1 # um caso só
 *
 * **A busca aqui é a por palavra, sem vetor** (o Workers AI vive no Worker).
 * Isso faz da bateria o PIOR caso: o que passa aqui passa em produção, onde a
 * busca é híbrida. Sai no relatório, para ninguém ler o número como teto.
 *
 * A chave sai do cofre e não é impressa. Exit 1 quando o aceite não é atingido.
 */
import { readFileSync } from 'node:fs'
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
if (!app) { console.error('informe o slug do app'); process.exit(2) }

const doCofre = (arquivo, nome) => {
    const linha = readFileSync(join(homedir(), '.venn360-secrets/venn-desk', arquivo), 'utf8')
        .split('\n').find((l) => l.startsWith(`export ${nome}=`))
    if (!linha) throw new Error(`${nome} não está em ${arquivo}`)
    return linha.slice(`export ${nome}=`.length).trim().replace(/^['"]|['"]$/g, '')
}

const casos = JSON.parse(readFileSync(`src/avaliacao/baterias/${app}${AMOSTRA ? '-amostra' : ''}.json`, 'utf8'))
    .filter((c) => SO_ESTE === null || c.id === SO_ESTE)
if (casos.length === 0) { console.error('nenhum caso'); process.exit(2) }

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
await cliente.end()

const modelo = createAnthropic({ apiKey: doCofre(`worker-${AMBIENTE === 'stg' ? 'stg' : 'production'}.env`, 'ANTHROPIC_API_KEY') })('claude-sonnet-5')
const tarifa = { entradaPorMilhao: 3, saidaPorMilhao: 15 }
const appDoBanco = { ...apps[0], modoSombra: false, instrucoesDoAgente: apps[0]?.instrucoes_do_agente ?? null, nome: apps[0]?.nome, prefixo: apps[0]?.prefixo }

console.log(`Bateria de ${app} em ${AMBIENTE}: ${casos.length} caso(s), ${artigos.length} artigo(s) na base, busca por palavra (pior caso)\n`)

const fila = [...casos]
const resultados = []
const trabalhador = async () => {
    for (let caso = fila.shift(); caso !== undefined; caso = fila.shift()) {
        try {
            const r = await rodarCasoDaBateria({ caso, modelo, app: appDoBanco, artigos, tarifa })
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
console.log(`falhas duras (desfecho ou conteúdo proibido): ${relatorio.falhasDuras} · de redação (não usou o termo esperado): ${relatorio.falhasDeRedacao}\n`)

console.log('por categoria:')
for (const [categoria, c] of Object.entries(relatorio.porCategoria)) {
    const pct = Math.round((c.passaram / c.total) * 100)
    console.log(`  ${categoria.padEnd(11)} ${String(c.passaram).padStart(3)}/${String(c.total).padEnd(3)} ${pct}%`)
}

if (relatorio.reprovados.length > 0) {
    console.log(`\n${relatorio.reprovados.length} reprovado(s):`)
    for (const r of relatorio.reprovados) {
        console.log(`\n  [${r.caso.categoria}] ${r.caso.id} (${r.natureza === 'dura' ? 'FALHA DURA' : 'redação — leia antes de mexer no gabarito'})`)
        console.log(`  pergunta: ${r.caso.mensagem.slice(0, 150)}`)
        console.log(`  falhou: ${r.falhas.join(' · ')}`)
        console.log(`  respondeu: ${(r.aoCliente || '(nada)').replace(/\n/g, ' ').slice(0, 220)}`)
        if (r.caso.gabarito.artigoEsperado) console.log(`  artigo esperado: ${r.caso.gabarito.artigoEsperado} | leu: ${r.artigosLidos.join(', ') || '(nenhum)'}`)
    }
}

const passou = passouNoAceite(relatorio)
console.log(`\n${passou ? '✓' : '✗'} aceite da Fase 4 (${Math.round(PISO_DE_ACEITE * 100)}%): ${passou ? 'atingido' : 'NÃO atingido'}`)
process.exit(passou ? 0 : 1)
