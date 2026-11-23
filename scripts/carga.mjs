/**
 * Teste de carga do Venn Desk (Fase 8).
 *
 * Mede as rotas de LEITURA com concorrência: a fila do Console e a página de
 * status são o que todo mundo abre ao mesmo tempo quando algo dá errado, e é
 * nessa hora que a lentidão aparece.
 *
 * **Escrita é opt-in (`--escrever`) e só em homologação.** Um teste de carga que
 * escreve em produção deixa rastro permanente: aqui nada é apagado, então mil
 * chamados de teste ficariam mil chamados para sempre.
 *
 * Uso:
 *   node scripts/carga.mjs --url https://venn-desk.andre-7ee.workers.dev --n 200 --paralelo 20
 */
const argumento = (nome, padrao) => {
    const i = process.argv.indexOf(`--${nome}`)
    return i < 0 ? padrao : process.argv[i + 1]
}

const base = (argumento('url', '') ?? '').replace(/\/+$/, '')
if (base === '') {
    console.error('uso: --url <base> [--n 200] [--paralelo 20]')
    process.exit(2)
}

const total = Number(argumento('n', '200'))
const paralelo = Number(argumento('paralelo', '20'))

/**
 * As rotas públicas, que é o que dá para medir sem credencial.
 *
 * O Console e o widget exigem sessão e JWT; medi-los exigiria credencial neste
 * script, e uma credencial num script de carga é uma credencial que vaza em
 * algum log.
 */
const ROTAS = ['/api/status', '/api/status/odontobox', '/api/status/conecta', '/api/status/stagent']

const amostras = []
let erros = 0

async function uma(i) {
    const rota = ROTAS[i % ROTAS.length]
    const comecou = Date.now()
    try {
        const r = await fetch(`${base}${rota}`, { headers: { 'User-Agent': 'VennDesk-Carga/1.0' } })
        /// 200 e 404 são respostas; 5xx é falha. Um app que não existe no
        /// ambiente não é problema de carga.
        if (r.status >= 500) erros += 1
        else amostras.push(Date.now() - comecou)
        await r.arrayBuffer()
    } catch {
        erros += 1
    }
}

const fila = Array.from({ length: total }, (_, i) => i)
const comecou = Date.now()

await Promise.all(
    Array.from({ length: paralelo }, async () => {
        for (let i = fila.shift(); i !== undefined; i = fila.shift()) await uma(i)
    })
)

const duracao = (Date.now() - comecou) / 1000
const ordenado = [...amostras].sort((a, b) => a - b)
const percentil = (p) => ordenado[Math.min(ordenado.length - 1, Math.floor((ordenado.length * p) / 100))] ?? 0

console.log(`
${total} requisições, ${paralelo} em paralelo, em ${duracao.toFixed(1)}s
  ${(total / duracao).toFixed(1)} req/s
  mediana ${percentil(50)} ms · p90 ${percentil(90)} ms · p99 ${percentil(99)} ms
  erros 5xx: ${erros}
`)

/// Sai diferente de zero com qualquer 5xx: um teste de carga que "passa" com
/// erro de servidor não serve de portão.
process.exit(erros === 0 ? 0 : 1)
