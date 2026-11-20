import { moduloDe, MODULOS, type Modulo } from './modulos.ts'

/**
 * A passada 1 do mapeador: o índice técnico, determinístico e barato.
 *
 * Lê os arquivos do core que pertencem a algum módulo e extrai, por regex, o
 * que liga uma tela ao resto: componentes importados, rotas de API chamadas,
 * tabelas do Prisma tocadas; e, de cada handler de API, os métodos expostos e
 * as tabelas. É o "Módulo → Tela → Componente → API → Banco" do documento de
 * referência — sem modelo, sem custo, refeito inteiro a cada commit.
 *
 * **Por sha de blob.** A análise de um arquivo depende só do conteúdo dele, então
 * ela é guardada por sha e reaproveitada: numa sincronização incremental só os
 * arquivos que mudaram são lidos do GitHub. Isso é o que mantém o índice
 * barato em requisições também, não só em dinheiro.
 *
 * O que o índice NÃO faz: entender o que a tela faz. Isso é a passada 2, com o
 * modelo, e ela recebe este índice como contexto.
 */

const RAIZ = 'packages/core/src/'

/** O que se extrai de UM arquivo, dependente só do conteúdo. */
export interface AnaliseDoArquivo {
    sha: string
    /** Imports de componentes do core (`@venn/core/components/...`), como caminho. */
    componentes: string[]
    /** Rotas de API chamadas por string (`/api/products`). Parâmetros virados em `:id`. */
    apis: string[]
    /** Tabelas do Prisma tocadas (`prisma.productService.` → `productService`). */
    modelos: string[]
    /** Só em `route.ts`: os métodos HTTP exportados. */
    metodos: string[]
    /** Há validação Zod (`z.object(`). */
    zod: boolean
}

export interface Tela {
    rota: string
    modulo: string
    /** Todos os arquivos da pasta da rota (page.tsx, *Client.tsx, dados.ts). */
    arquivos: string[]
    componentes: string[]
    apis: string[]
    modelos: string[]
}

export interface Api {
    rota: string
    modulo: string
    arquivo: string
    metodos: string[]
    modelos: string[]
    zod: boolean
}

export interface IndiceTecnico {
    commit: string
    telas: Tela[]
    apis: Api[]
    /** Arquivos por módulo, para a passada 2 saber o que mandar ao modelo. */
    arquivosPorModulo: Record<string, string[]>
    /** A análise de cada arquivo, por caminho, para a próxima rodada reaproveitar. */
    analises: Record<string, AnaliseDoArquivo>
}

export interface EntradaDaArvore {
    sha: string
    tamanho: number
}

/** Arquivos grandes demais para valer a leitura (bundles, fixtures). */
const TAMANHO_MAXIMO = 200_000

export function arquivosDoMapa(arvore: Map<string, EntradaDaArvore>, modulos: Modulo[] = MODULOS): string[] {
    return [...arvore.entries()]
        .filter(([caminho, e]) => /\.(ts|tsx)$/.test(caminho) && !/\.(test|spec)\.tsx?$/.test(caminho) && e.tamanho <= TAMANHO_MAXIMO)
        .filter(([caminho]) => moduloDe(caminho, modulos) !== null)
        .map(([caminho]) => caminho)
        .sort()
}

export function analisarArquivo(caminho: string, conteudo: string, sha: string): AnaliseDoArquivo {
    const componentes = [...conteudo.matchAll(/from\s+['"]@venn\/core\/components\/([^'"]+)['"]/g)]
        .map((m) => `${RAIZ}components/${m[1]}`)
    const apis = [...conteudo.matchAll(/['"`](\/api\/[a-zA-Z0-9][a-zA-Z0-9/_\-$.{}\[\]]*)/g)]
        .map((m) => normalizarRotaDeApi(m[1] ?? ''))
        .filter((r) => r !== '')
    const modelos = [...conteudo.matchAll(/\bprisma\.([a-zA-Z][a-zA-Z0-9]*)\.(?:findMany|findFirst|findUnique|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\b/g)]
        .map((m) => m[1] ?? '')
    const metodos = /\/route\.tsx?$/.test(caminho)
        ? [...conteudo.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1] ?? '')
        : []

    return {
        sha,
        componentes: unicos(componentes),
        apis: unicos(apis),
        modelos: unicos(modelos),
        metodos: unicos(metodos),
        zod: /\bz\.object\(/.test(conteudo),
    }
}

/** `/api/products/${id}` e `/api/products/[id]` viram `/api/products/:id`; querystring sai. */
export function normalizarRotaDeApi(bruta: string): string {
    const semQuery = bruta.split('?')[0] ?? ''
    return semQuery
        .replace(/\$\{[^}]*\}/g, ':id')
        .replace(/\[[^\]]+\]/g, ':id')
        .replace(/\/+$/, '')
}

/** `packages/core/src/rotas/(dashboard)/vendas/servicos/page.tsx` → `/vendas/servicos`. */
export function rotaDaPagina(caminho: string): string | null {
    const m = /^packages\/core\/src\/rotas\/(?:(.*)\/)?page\.tsx$/.exec(caminho)
    if (m === null) return null
    const segmentos = (m[1] ?? '').split('/').filter((s) => s !== '' && !/^\(.*\)$/.test(s))
    return `/${segmentos.join('/')}`
}

/** `packages/core/src/rotas/api/products/[id]/route.ts` → `/api/products/:id`. */
export function rotaDaApi(caminho: string): string | null {
    const m = /^packages\/core\/src\/rotas\/(api\/.*)\/route\.tsx?$/.exec(caminho)
    if (m === null) return null
    return normalizarRotaDeApi(`/${m[1]}`)
}

export interface PedidoDeIndice {
    commit: string
    arvore: Map<string, EntradaDaArvore>
    /** Lê o conteúdo de um blob pelo sha. Só é chamado para o que mudou. */
    ler(caminho: string, sha: string): Promise<string>
    /** O índice anterior, para reaproveitar análises de blobs iguais. */
    anterior?: IndiceTecnico | null
    modulos?: Modulo[]
    /** Quantas leituras em paralelo. */
    paralelo?: number
}

export async function montarIndice(pedido: PedidoDeIndice): Promise<{ indice: IndiceTecnico; lidos: number }> {
    const modulos = pedido.modulos ?? MODULOS
    const caminhos = arquivosDoMapa(pedido.arvore, modulos)
    const analises: Record<string, AnaliseDoArquivo> = {}
    let lidos = 0

    const fila = [...caminhos]
    const trabalhador = async () => {
        for (let caminho = fila.shift(); caminho !== undefined; caminho = fila.shift()) {
            const sha = pedido.arvore.get(caminho)?.sha ?? ''
            const antiga = pedido.anterior?.analises[caminho]
            if (antiga !== undefined && antiga.sha === sha) {
                analises[caminho] = antiga
                continue
            }
            const conteudo = await pedido.ler(caminho, sha)
            lidos++
            analises[caminho] = analisarArquivo(caminho, conteudo, sha)
        }
    }
    await Promise.all(Array.from({ length: pedido.paralelo ?? 6 }, trabalhador))

    /// Telas: uma por pasta que tem `page.tsx`; os irmãos entram na mesma tela.
    const telas: Tela[] = []
    for (const caminho of caminhos) {
        const rota = rotaDaPagina(caminho)
        if (rota === null) continue
        const pasta = caminho.slice(0, caminho.lastIndexOf('/') + 1)
        const arquivos = caminhos.filter((c) => c.startsWith(pasta) && !c.slice(pasta.length).includes('/'))
        const juntas = arquivos.map((a) => analises[a]).filter((a): a is AnaliseDoArquivo => a !== undefined)
        const modulo = moduloDe(caminho, modulos)
        if (modulo === null) continue

        /// Componentes importados diretamente contribuem com as APIs que eles
        /// chamam — é no painel do produto, não na página, que o `fetch` mora.
        const componentes = unicos(juntas.flatMap((a) => a.componentes))
        const dosComponentes = componentes
            .flatMap((c) => [analises[`${c}.tsx`], analises[`${c}.ts`], analises[`${c}/index.tsx`]])
            .filter((a): a is AnaliseDoArquivo => a !== undefined)

        telas.push({
            rota,
            modulo: modulo.slug,
            arquivos,
            componentes,
            apis: unicos([...juntas, ...dosComponentes].flatMap((a) => a.apis)),
            modelos: unicos([...juntas, ...dosComponentes].flatMap((a) => a.modelos)),
        })
    }

    const apis: Api[] = []
    for (const caminho of caminhos) {
        const rota = rotaDaApi(caminho)
        if (rota === null) continue
        const analise = analises[caminho]
        const modulo = moduloDe(caminho, modulos)
        if (analise === undefined || modulo === null) continue
        apis.push({ rota, modulo: modulo.slug, arquivo: caminho, metodos: analise.metodos, modelos: analise.modelos, zod: analise.zod })
    }

    const arquivosPorModulo: Record<string, string[]> = {}
    for (const caminho of caminhos) {
        const modulo = moduloDe(caminho, modulos)
        if (modulo === null) continue
        ;(arquivosPorModulo[modulo.slug] ??= []).push(caminho)
    }

    return { indice: { commit: pedido.commit, telas, apis, arquivosPorModulo, analises }, lidos }
}

function unicos<T>(lista: T[]): T[] {
    return [...new Set(lista)]
}
