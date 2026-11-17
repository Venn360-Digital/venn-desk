/**
 * A auditoria de rotas — o guarda contra a colisão que já custou duas fases.
 *
 * O defeito, nas duas vezes: um caminho com parâmetro na raiz de um espaço
 * (`/api/:app/*`, depois `/api/console/:app/*`) captura TODO primeiro segmento
 * daquele espaço, inclusive os literais registrados ao lado. O middleware casa,
 * procura um app chamado "console" ou "apps", não acha, e responde 404 — a rota
 * literal existe e é inalcançável, sem erro de compilação e sem aviso.
 *
 * Consertar o caminho não impede a reincidência; o segundo caso foi exatamente
 * a reincidência do primeiro no vizinho. Então a regra é estrutural:
 *
 *   em nenhuma posição um `:parametro` pode disputar lugar com um segmento
 *   literal, sob o mesmo prefixo.
 *
 * O `*` é de propósito curinga (é como middleware se registra) e não entra.
 *
 * Alterar este arquivo exige revisão humana: está no CODEOWNERS.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const PASTA = join(RAIZ, 'src', 'rotas')

const REGISTRO = /\.(?:get|post|put|patch|delete|all|use|on)\(\s*(['"`])([^'"`]+)\1/g

const rotas = []
for (const nome of readdirSync(PASTA)) {
    if (!nome.endsWith('.ts') || nome.endsWith('.test.ts')) continue
    const texto = readFileSync(join(PASTA, nome), 'utf8')
    for (const casado of texto.matchAll(REGISTRO)) {
        const caminho = casado[2]
        if (!caminho.startsWith('/')) continue
        rotas.push({ caminho, arquivo: relative(RAIZ, join(PASTA, nome)) })
    }
}

const ehParametro = (seg) => seg.startsWith(':')
const ehCuringa = (seg) => seg === '*'

const problemas = []

for (let i = 0; i < rotas.length; i += 1) {
    for (let j = i + 1; j < rotas.length; j += 1) {
        const a = rotas[i].caminho.split('/')
        const b = rotas[j].caminho.split('/')

        for (let k = 0; k < Math.min(a.length, b.length); k += 1) {
            const [x, y] = [a[k], b[k]]
            if (x === y) continue

            /// O primeiro segmento diferente decide. Dois literais diferentes
            /// são espaços distintos, e aí nada mais abaixo pode colidir.
            if (ehCuringa(x) || ehCuringa(y)) break

            if (ehParametro(x) !== ehParametro(y)) {
                const [param, literal] = ehParametro(x) ? [rotas[i], rotas[j]] : [rotas[j], rotas[i]]
                problemas.push(
                    `${param.caminho} captura o segmento "${ehParametro(x) ? y : x}" de ` +
                        `${literal.caminho} — a rota literal fica inalcançável`
                )
            }
            break
        }
    }
}

if (problemas.length > 0) {
    process.stdout.write('Auditoria de rotas reprovou:\n')
    for (const problema of [...new Set(problemas)]) process.stdout.write(`  ✗ ${problema}\n`)
    process.exit(1)
}

process.stdout.write(`✓ Rotas: ${rotas.length} registros, nenhum parâmetro cobrindo literal.\n`)
