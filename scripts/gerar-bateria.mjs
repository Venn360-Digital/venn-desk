/**
 * Gera a bateria de atendimento a partir da base viva.
 *
 *   AMBIENTE=stg node scripts/gerar-bateria.mjs odontobox
 *   node scripts/gerar-bateria.mjs odontobox --quantos 20   # amostra, para revisar
 *
 * Grava em `src/avaliacao/baterias/<app>.json`. O arquivo é versionado de
 * propósito: a bateria precisa ser a MESMA entre rodadas, senão a comparação
 * entre dois dias mede duas baterias. Gerá-la de novo é uma decisão, com commit.
 *
 * As perguntas saem dos artigos; os dez casos técnicos são escritos à mão (ver
 * `src/avaliacao/bateria-tecnicos.ts`). A chave sai do cofre e não é impressa.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createAnthropic } from '@ai-sdk/anthropic'
import { Client } from 'pg'

import { DISTRIBUICAO } from '../src/avaliacao/bateria.ts'
import { fonteDaCategoria, gerarCasosDeArtigo, tecnicosDoApp } from '../src/avaliacao/gerar-bateria.ts'
import { extratorDaAnthropic } from '../src/conhecimento/extrair/com-modelo.ts'

const AMBIENTE = process.env.AMBIENTE ?? 'production'
const app = process.argv.slice(2).find((a) => !a.startsWith('--'))
const quantosArg = process.argv.indexOf('--quantos')
const LIMITE = quantosArg === -1 ? Infinity : Number(process.argv[quantosArg + 1])
if (!app) { console.error('informe o slug do app'); process.exit(2) }

const doCofre = (arquivo, nome) => {
    const linha = readFileSync(join(homedir(), '.venn360-secrets/venn-desk', arquivo), 'utf8')
        .split('\n').find((l) => l.startsWith(`export ${nome}=`))
    if (!linha) throw new Error(`${nome} não está em ${arquivo}`)
    return linha.slice(`export ${nome}=`.length).trim().replace(/^['"]|['"]$/g, '')
}

const banco = AMBIENTE === 'stg' ? 'neon-staging.env' : 'neon-production.env'
const cliente = new Client({ connectionString: doCofre(banco, 'DATABASE_URL_APP') })
await cliente.connect()

const { rows: artigos } = await cliente.query(
    `select k.chave, k.titulo, k.corpo, (k.dados->>'rota') rota
     from kb_articles k join apps a on a.id = k.app_id
     where a.slug = $1 and k.origem = 'DERIVADO' and k.status = 'PUBLICADO' and k.chave is not null
     order by k.chave`,
    [app]
)
await cliente.end()

/// Agrupa os artigos pela categoria que cada família alimenta. O mapa técnico e
/// as novidades ficam de fora: um é interno, o outro muda a cada dia.
const porCategoria = {}
for (const artigo of artigos) {
    const categoria = fonteDaCategoria(artigo.chave)
    if (categoria === null) continue
    ;(porCategoria[categoria] ??= []).push(artigo)
}

console.log(`Artigos por categoria em ${app} (${AMBIENTE}):`)
for (const [categoria, lista] of Object.entries(porCategoria)) {
    console.log(`  ${categoria}: ${lista.length} artigo(s), meta de ${DISTRIBUICAO[categoria]} pergunta(s)`)
}

const extrator = extratorDaAnthropic(
    createAnthropic({ apiKey: doCofre(`worker-${AMBIENTE === 'stg' ? 'stg' : 'production'}.env`, 'ANTHROPIC_API_KEY') })('claude-sonnet-5')
)

const casos = []
let gastos = 0

for (const [categoria, lista] of Object.entries(porCategoria)) {
    const meta = Math.min(DISTRIBUICAO[categoria] ?? 0, LIMITE === Infinity ? Infinity : LIMITE)
    if (meta === 0 || lista.length === 0) continue

    /// Espalha a meta pelos artigos: um artigo que renda cinco perguntas e
    /// outro nenhuma daria uma bateria que mede uma tela só.
    const porArtigo = Math.max(1, Math.ceil(meta / lista.length))
    for (const artigo of lista) {
        if (casos.filter((c) => c.categoria === categoria).length >= meta) break
        try {
            const novos = await gerarCasosDeArtigo({
                artigo,
                app,
                categoria,
                quantas: porArtigo,
                extrator,
                ...(artigo.rota ? { rota: artigo.rota } : {}),
            })
            casos.push(...novos)
            gastos += 1
            process.stdout.write(`\r  gerando… ${casos.length} caso(s), ${gastos} chamada(s)   `)
        } catch (erro) {
            console.log(`\n  ! ${artigo.chave}: ${erro.message.slice(0, 120)}`)
        }
    }
}

/// Corta cada categoria na meta e acrescenta os técnicos.
const finais = []
for (const [categoria, meta] of Object.entries(DISTRIBUICAO)) {
    if (categoria === 'tecnico') continue
    const daCategoria = casos.filter((c) => c.categoria === categoria).slice(0, LIMITE === Infinity ? meta : Math.min(meta, LIMITE))
    finais.push(...daCategoria)
}
finais.push(...(LIMITE === Infinity ? tecnicosDoApp(app) : tecnicosDoApp(app).slice(0, LIMITE)))

mkdirSync('src/avaliacao/baterias', { recursive: true })
const destino = `src/avaliacao/baterias/${app}${LIMITE === Infinity ? '' : '-amostra'}.json`
writeFileSync(destino, `${JSON.stringify(finais, null, 2)}\n`)

console.log(`\n\n${finais.length} caso(s) em ${destino}`)
const contagem = {}
for (const c of finais) contagem[c.categoria] = (contagem[c.categoria] ?? 0) + 1
console.log('por categoria:', JSON.stringify(contagem))
const semGabarito = finais.filter((c) => c.gabarito.desfecho === 'respondeu' && (c.gabarito.precisaDizer ?? []).length === 0)
if (semGabarito.length > 0) console.log(`⚠ ${semGabarito.length} caso(s) sem termo no gabarito (só o desfecho será conferido)`)
