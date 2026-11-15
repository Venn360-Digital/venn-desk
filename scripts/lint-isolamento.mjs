/**
 * A auditoria de isolamento — o mesmo papel do `audit-isolation` dos apps.
 *
 * A seção 6 exige que toda consulta filtre por `app_id`. Isso é garantido por
 * `src/dados/escopo.ts`, mas uma garantia que depende de ninguém escrever uma
 * consulta por fora não é garantia. Então o portão verifica a estrutura:
 *
 *  1. só arquivos de `src/dados/` alcançam o Prisma;
 *  2. nenhum arquivo fora de `src/dados/` toca um delegado de tabela;
 *  3. dentro do escopo, `findUnique` e `update` são proibidos — são as duas
 *     formas que não aceitam o `appId` ao lado do `id`.
 *
 * Alterar este arquivo exige revisão humana: ele está no CODEOWNERS, junto com
 * o portão de CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const FONTE = join(RAIZ, 'src')
const PASTA_DE_DADOS = join(FONTE, 'dados')
const GERADO = join(FONTE, 'gerado')

const DELEGADOS = [
    'app',
    'tenant',
    'requester',
    'agent',
    'ticket',
    'ticketMessage',
    'attachment',
    'ticketEvent',
    'slackThread',
    'inboundEvent',
    'problem',
    'engLink',
    'approval',
    'kbArticle',
    'slaPolicy',
    'slaTimer',
    'macro',
    'automation',
    'view',
    'csatResponse',
    'tag',
    'ticketTag',
    'customField',
    'customFieldValue',
]

const METODOS = ['findFirst', 'findMany', 'findUnique', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'count', 'aggregate']

const ACESSO_A_TABELA = new RegExp(
    `\\.(?:${DELEGADOS.join('|')})\\s*\\.\\s*(?:${METODOS.join('|')})\\s*\\(`
)

function arquivos(pasta) {
    const achados = []
    for (const nome of readdirSync(pasta)) {
        const caminho = join(pasta, nome)
        if (caminho.startsWith(GERADO)) continue
        if (statSync(caminho).isDirectory()) achados.push(...arquivos(caminho))
        else if (nome.endsWith('.ts')) achados.push(caminho)
    }
    return achados
}

const problemas = []

for (const caminho of arquivos(FONTE)) {
    const texto = readFileSync(caminho, 'utf8')
    const curto = relative(RAIZ, caminho)
    const ehDeDados = caminho.startsWith(PASTA_DE_DADOS)
    const ehProva = caminho.endsWith('.test.ts')

    /**
     * `import type` passa em qualquer lugar: tipo não consulta. O que a regra
     * barra é o import de VALOR — `PrismaClient` como construtor, um delegado,
     * um enum em runtime.
     */
    if (!ehDeDados && /import\s+(?!type\s)[^;]*from\s+['"]#prisma['"]/.test(texto)) {
        problemas.push(`${curto}: importa valor de #prisma fora de src/dados/`)
    }

    if (!ehDeDados && !ehProva && ACESSO_A_TABELA.test(texto)) {
        problemas.push(`${curto}: consulta tabela fora de src/dados/ — use escopoDoApp`)
    }

    if (caminho === join(PASTA_DE_DADOS, 'escopo.ts')) {
        if (/\bfindUnique\s*\(/.test(texto)) {
            problemas.push(`${curto}: findUnique no escopo não aceita appId ao lado do id`)
        }
        if (/\.\s*update\s*\(/.test(texto)) {
            problemas.push(`${curto}: update no escopo não aceita appId ao lado do id — use updateMany`)
        }
    }
}

if (problemas.length > 0) {
    process.stdout.write('Auditoria de isolamento reprovou:\n')
    for (const problema of problemas) process.stdout.write(`  ✗ ${problema}\n`)
    process.exit(1)
}

process.stdout.write('✓ Isolamento: nenhuma consulta fora do escopo por app.\n')
