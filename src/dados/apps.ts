import type { App, Prisma, PrismaClient } from '#prisma'

/**
 * O ÚNICO acesso ao banco que não é escopado por app — e é por definição: é a
 * consulta que ESTABELECE o escopo.
 *
 * Mora em arquivo separado de propósito. Assim a regra fica verificável por
 * leitura e pelo `scripts/lint-isolamento.mjs`: fora deste arquivo, nada toca o
 * banco sem passar por `escopoDoApp`.
 */
export async function appPorSlug(cliente: PrismaClient, slug: string): Promise<App | null> {
    return cliente.app.findFirst({ where: { slug, excluidoEm: null } })
}

/** Pelo id — é o que a credencial do MCP carrega, em vez do slug. */
export async function appPorId(cliente: PrismaClient, id: string): Promise<App | null> {
    return cliente.app.findFirst({ where: { id, excluidoEm: null } })
}

export async function appsAtivos(cliente: PrismaClient): Promise<App[]> {
    return cliente.app.findMany({ where: { excluidoEm: null }, orderBy: { nome: 'asc' } })
}

export interface DadosDoApp {
    slug: string
    nome: string
    prefixo: string
    chavePublicaJwk: Prisma.InputJsonValue
    repositorio?: string | null
    pastaNoRepositorio?: string | null
    urlApp?: string | null
    urlSaude?: string | null
    canalSuporte?: string | null
    canalEngenharia?: string | null
    modoSombra?: boolean
    atendimentoAutomatico?: boolean
    tema?: Prisma.InputJsonValue
}

/**
 * Cadastrar um app é o passo 1 de incluir um produto no Venn Desk (Fase 8:
 * "menos de um dia"). Nasce com modo sombra LIGADO: nenhuma resposta da IA sai
 * sozinha antes de alguém medir a taxa de envio sem edição (seção 4).
 */
export async function cadastrarApp(cliente: PrismaClient, dados: DadosDoApp): Promise<App> {
    return cliente.app.create({
        data: {
            slug: dados.slug,
            nome: dados.nome,
            prefixo: dados.prefixo.toUpperCase(),
            chavePublicaJwk: dados.chavePublicaJwk,
            modoSombra: dados.modoSombra ?? true,
            ...(dados.repositorio === undefined ? {} : { repositorio: dados.repositorio }),
            ...(dados.pastaNoRepositorio === undefined
                ? {}
                : { pastaNoRepositorio: dados.pastaNoRepositorio }),
            ...(dados.urlApp === undefined ? {} : { urlApp: dados.urlApp }),
            ...(dados.urlSaude === undefined ? {} : { urlSaude: dados.urlSaude }),
            ...(dados.canalSuporte === undefined ? {} : { canalSuporte: dados.canalSuporte }),
            ...(dados.canalEngenharia === undefined
                ? {}
                : { canalEngenharia: dados.canalEngenharia }),
            ...(dados.tema === undefined ? {} : { tema: dados.tema }),
        },
    })
}

/**
 * Alterar o cadastro. O `prefixo` e o `slug` não entram: mudá-los renomearia
 * chamados já emitidos (`ODB-1042`) e quebraria o vínculo com o token que os
 * apps assinam. Para trocar, cadastre outro app.
 */
export async function alterarApp(
    cliente: PrismaClient,
    slug: string,
    campos: {
        nome?: string | undefined
        repositorio?: string | null | undefined
        pastaNoRepositorio?: string | null | undefined
        chavePublicaDoDesk?: Prisma.InputJsonValue | undefined
        urlApp?: string | null | undefined
        urlSaude?: string | null | undefined
        canalSuporte?: string | null | undefined
        canalEngenharia?: string | null | undefined
        modoSombra?: boolean | undefined
        atendimentoAutomatico?: boolean | undefined
        chavePublicaJwk?: Prisma.InputJsonValue | undefined
        tema?: Prisma.InputJsonValue | undefined
    }
): Promise<App | null> {
    const data = {
        ...(campos.nome === undefined ? {} : { nome: campos.nome }),
        ...(campos.repositorio === undefined ? {} : { repositorio: campos.repositorio }),
        ...(campos.pastaNoRepositorio === undefined
            ? {}
            : { pastaNoRepositorio: campos.pastaNoRepositorio }),
        ...(campos.chavePublicaDoDesk === undefined
            ? {}
            : { chavePublicaDoDesk: campos.chavePublicaDoDesk }),
        ...(campos.urlApp === undefined ? {} : { urlApp: campos.urlApp }),
        ...(campos.urlSaude === undefined ? {} : { urlSaude: campos.urlSaude }),
        ...(campos.canalSuporte === undefined ? {} : { canalSuporte: campos.canalSuporte }),
        ...(campos.canalEngenharia === undefined
            ? {}
            : { canalEngenharia: campos.canalEngenharia }),
        ...(campos.modoSombra === undefined ? {} : { modoSombra: campos.modoSombra }),
        ...(campos.atendimentoAutomatico === undefined
            ? {}
            : { atendimentoAutomatico: campos.atendimentoAutomatico }),
        ...(campos.chavePublicaJwk === undefined
            ? {}
            : { chavePublicaJwk: campos.chavePublicaJwk }),
        ...(campos.tema === undefined ? {} : { tema: campos.tema }),
    }

    if (Object.keys(data).length === 0) return appPorSlug(cliente, slug)

    const { count } = await cliente.app.updateMany({ where: { slug, excluidoEm: null }, data })
    return count === 1 ? appPorSlug(cliente, slug) : null
}

/**
 * Os apps que a base viva consegue sincronizar: ativos, com repositório E
 * pasta preenchidos. Um app sem os dois não é erro — é um app que ainda não
 * entrou na base viva, e o Console diz isso.
 */
export async function appsSincronizaveis(cliente: PrismaClient): Promise<App[]> {
    const apps = await appsAtivos(cliente)
    return apps.filter(
        (a) => a.repositorio !== null && a.repositorio !== '' && a.pastaNoRepositorio !== null && a.pastaNoRepositorio !== ''
    )
}
