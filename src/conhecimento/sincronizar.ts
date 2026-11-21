import type { Prisma, PrismaClient } from '#prisma'

import { conferirTeto, custoEstimado, somar, ZERO, type Consumo, type Tarifa } from '../agente/orcamento.ts'
import { appsSincronizaveis } from '../dados/apps.ts'
import { escopoDoApp, type EscopoDoApp } from '../dados/escopo.ts'
import { textoDeBusca } from '../dominio/artigo.ts'
import type { Fila } from '../lib/ambiente.ts'
import { extrairVocabulario } from './extrair/vocabulario.ts'
import type { Extrator } from './extrair/com-modelo.ts'
import { caminhoDoVocabulario, FONTES, type Fonte } from './fontes.ts'
import { JANELA_EM_DIAS } from './extrair/novidades.ts'
import { ErroDeLeitura, type Commit, type LeitorDoRepositorio } from './github.ts'
import { contextoDaTela, type ArquivoEscolhido } from './mapa/contexto-da-tela.ts'
import { montarIndice, type IndiceTecnico } from './mapa/indice.ts'
import { chaveDaTela, PREFIXO_TELA } from './renderizar/tela.ts'
import { VERSAO_DO_EXTRATOR_DE_TELA } from './documentar.ts'
import { PREFIXO_MAPA, renderizarMapa } from './renderizar/mapa.ts'
import { ErroDeExtracao, type AppSincronizavel, type ArtigoRenderizado, type ContextoDeRenderizacao, type Vocabulario } from './tipos.ts'

/**
 * A sincronização da base com o repositório — o coração da base viva.
 *
 * Um job é (app, commit). Ele lê a árvore daquele commit, extrai o vocabulário
 * do app, e para cada fonte do catálogo: compara os shas dos arquivos com os da
 * última rodada concluída (iguais → nada a fazer, zero chamadas ao modelo),
 * lê o que mudou, extrai, renderiza e grava por upsert. Fonte que sumiu do
 * repositório tem os artigos ARQUIVADOS. Depois vem a passada 1 do mapa
 * técnico, que reaproveita as análises de blob igual.
 *
 * **Falha por fonte, não por rodada.** Uma FAQ que mudou de forma não impede o
 * menu de atualizar: cada fonte tem o próprio estado no resultado, e o
 * Console pinta a que falhou. Só duas coisas derrubam a rodada inteira: o
 * vocabulário (tudo depende dele) e o limite de taxa do GitHub (repetir
 * depois é o certo).
 *
 * **O custo fica no resultado.** Cada chamada ao modelo soma em `consumo`, e o
 * teto por rodada corta as fontes que ainda precisariam dele — nunca o que já
 * foi extraído.
 */

export const ATOR = 'sistema:sincronizacao'
export const RAMO = 'main'

export interface TetoDaRodada {
    chamadasAoModelo: number
    tokens: number
    /**
     * Quantas telas uma rodada enfileira. A carga inicial tem 33; o incremental
     * tem uma ou duas. O teto existe para o dia em que um renomeio em massa
     * tocar tudo: a base atualiza em duas rodadas em vez de gastar o mês num
     * commit.
     */
    telasPorRodada: number
}

export const TETO_DA_RODADA: TetoDaRodada = { chamadasAoModelo: 12, tokens: 300_000, telasPorRodada: 40 }

export interface EstadoDaFonte {
    estado: 'ok' | 'inalterada' | 'falhou' | 'pulada'
    criados: number
    atualizados: number
    reabertos: number
    inalterados: number
    arquivados: number
    /** Os shas dos arquivos lidos, para a próxima rodada comparar. */
    shas: Record<string, string>
    /** As chaves dos artigos vivos, para "inalterada" tocar as datas. */
    chaves: string[]
    versaoDoExtrator: number
    extraidoPor?: 'parser' | 'modelo'
    erro?: string
}

export interface EstadoDasTelas {
    /** Telas no índice deste commit. */
    total: number
    /** Enfileiradas para documentar (as que mudaram, ou que ainda não existem). */
    enfileiradas: number
    /** Já documentadas neste commit, sem trabalho nenhum. */
    emDia: number
    /** Artigos arquivados porque a rota saiu do produto. */
    arquivados: number
    /** Deixadas para a próxima rodada pelo teto. */
    adiadas: number
}

export interface ResultadoDaSincronizacao {
    commit: string
    fontes: Record<string, EstadoDaFonte>
    mapa: { telas: number; apis: number; arquivosLidos: number; artigos: number } | { erro: string }
    telas?: EstadoDasTelas | { erro: string }
    indiceTecnico?: IndiceTecnico
    consumo: Consumo
    custoEstimadoUsd: number
    duracaoMs: number
    avisos: string[]
    /**
     * O vocabulário deste app no commit da rodada.
     *
     * Fica no resultado, e não numa coluna de `apps`, porque é um FATO DA
     * RODADA: foi com este vocabulário que os artigos desta rodada foram
     * renderizados. É o que o detector de divergências precisa para dobrar o
     * texto dos três apps antes de compará-los — sem ele, "Pacientes" contra
     * "Clientes" apareceria como divergência em todo artigo.
     */
    vocabulario?: Vocabulario
}

export interface PedidoDeSincronizacao {
    escopo: EscopoDoApp
    app: AppSincronizavel
    leitor: LeitorDoRepositorio
    /** Sem chave da Anthropic, as fontes que precisam do modelo são puladas. */
    extrator: Extrator | null
    /** Sem Workers AI, os artigos ficam sem vetor e a busca segue por palavra. */
    embutir: ((textos: string[]) => Promise<(number[] | null)[]>) | null
    commitSha: string
    /** O resultado da última rodada CONCLUÍDA, para comparar shas e reaproveitar o índice. */
    anterior: ResultadoDaSincronizacao | null
    agora: Date
    tarifa: Tarifa
    teto?: TetoDaRodada
    /**
     * Para enfileirar a documentação das telas. Ausente (teste, ambiente sem
     * Queues), a passada 2 é apenas registrada como não enfileirada.
     */
    fila?: Fila | undefined
    /**
     * Os apps que compartilham este repositório — a tela é a mesma nos três, e
     * a mensagem documenta todos de uma vez. Vazio: só este app.
     */
    irmaos?: AppSincronizavel[]
}

export async function sincronizarApp(pedido: PedidoDeSincronizacao): Promise<ResultadoDaSincronizacao> {
    const inicio = Date.now()
    const { escopo, app, leitor, commitSha, agora } = pedido
    const teto = pedido.teto ?? TETO_DA_RODADA
    const avisos: string[] = []
    let consumo: Consumo = ZERO

    const arvore = await leitor.arvore(app.repositorio, commitSha)

    /// Cache de blobs por sha dentro da rodada: o mesmo arquivo pode servir a
    /// duas fontes (plan-limits ao catálogo de planos e ao módulo de conta).
    const blobs = new Map<string, Promise<string>>()
    const ler = (sha: string) => {
        let p = blobs.get(sha)
        if (p === undefined) {
            p = leitor.blob(app.repositorio, sha)
            blobs.set(sha, p)
        }
        return p
    }

    const vocabulario = await lerVocabulario(app, arvore, ler)
    const ctx: ContextoDeRenderizacao = { app, vocabulario, commit: commitSha, agora }

    const fontes: Record<string, EstadoDaFonte> = {}
    const pendentesDeVetor: { id: string; texto: string }[] = []

    for (const fonte of FONTES) {
        const anterior = pedido.anterior?.fontes[fonte.tipo]
        const caminhos = fonte.caminhos(app)
        const shas: Record<string, string> = {}
        for (const c of caminhos) {
            const entrada = arvore.get(c)
            if (entrada !== undefined) shas[c] = entrada.sha
        }

        const base = (): EstadoDaFonte => ({
            estado: 'ok', criados: 0, atualizados: 0, reabertos: 0, inalterados: 0, arquivados: 0,
            shas, chaves: [], versaoDoExtrator: fonte.versaoDoExtrator,
        })

        /// Fonte que sumiu: arquiva o que ela tinha e registra. Fonte sem
        /// caminho nenhum (novidades, que lê o histórico) nunca entra aqui.
        const ausentes = caminhos.filter((c) => shas[c] === undefined)
        if (ausentes.length > 0) {
            const arquivados = await escopo.artigos.arquivarDerivadosFora(fonte.prefixoDaChave, [])
            for (const a of arquivados) await evento(escopo, a.id, 'artigo:derivado-arquivado', { motivo: 'fonte ausente', caminhos: ausentes })
            fontes[fonte.tipo] = { ...base(), estado: 'falhou', arquivados: arquivados.length, erro: `arquivo(s) não existe(m) em ${commitSha.slice(0, 7)}: ${ausentes.join(', ')}` }
            continue
        }

        /// Nada mudou desde a última rodada concluída e o extrator é o mesmo:
        /// zero leitura, zero modelo. Só a data de conferência avança.
        if (
            anterior !== undefined &&
            anterior.estado !== 'falhou' &&
            anterior.estado !== 'pulada' &&
            anterior.versaoDoExtrator === fonte.versaoDoExtrator &&
            caminhos.length > 0 &&
            mesmosShas(anterior.shas, shas)
        ) {
            await escopo.artigos.tocarDerivados(anterior.chaves, agora)
            fontes[fonte.tipo] = { ...base(), estado: 'inalterada', inalterados: anterior.chaves.length, chaves: anterior.chaves, ...(anterior.extraidoPor === undefined ? {} : { extraidoPor: anterior.extraidoPor }) }
            continue
        }

        if (fonte.precisaDeModelo) {
            if (pedido.extrator === null) {
                fontes[fonte.tipo] = { ...base(), estado: 'pulada', erro: 'sem chave da Anthropic para a extração por modelo' }
                continue
            }
            const veredito = conferirTeto({ passos: consumo.passos, tokensDeEntrada: consumo.tokensDeEntrada, tokensDeSaida: consumo.tokensDeSaida }, { passos: teto.chamadasAoModelo, tokens: teto.tokens })
            if (!veredito.dentro) {
                fontes[fonte.tipo] = { ...base(), estado: 'pulada', erro: `teto da rodada atingido (${veredito.motivo}); fica para a próxima` }
                avisos.push(`teto da rodada atingido antes de ${fonte.tipo}`)
                continue
            }
        }

        try {
            const arquivos: Record<string, string> = {}
            for (const c of caminhos) arquivos[c] = await ler(shas[c] ?? '')

            /**
             * Só "novidades" pede o histórico, e ela pede os commits das duas
             * pastas que afetam este app: a dele e o core compartilhado. O
             * `desde` sai da janela da própria fonte, e os já publicados são
             * descartados pelo sha na junção.
             */
            const extras: { commits?: Commit[]; anterior?: unknown } = {}
            if (fonte.precisaDeCommits === true) {
                const desde = new Date(agora.getTime() - JANELA_EM_DIAS * 24 * 60 * 60 * 1000)
                const [doApp, doCore] = await Promise.all([
                    leitor.commits(app.repositorio, { ref: commitSha, caminho: `${app.pastaNoRepositorio}/`, desde, limite: 40 }),
                    leitor.commits(app.repositorio, { ref: commitSha, caminho: 'packages/core/', desde, limite: 60 }),
                ])
                const anteriorDaFonte = await escopo.artigos.porChave(fonte.prefixoDaChave).catch(() => null)
                const jaPublicados = new Set(
                    (((anteriorDaFonte?.dados ?? null) as { itens?: { sha: string }[] } | null)?.itens ?? []).map((i) => i.sha.slice(0, 7))
                )
                extras.commits = [...doApp, ...doCore]
                    .filter((c) => /^(?:feat|fix)[(:]/.test(c.assunto))
                    .filter((c) => !jaPublicados.has(c.sha.slice(0, 7)))
                    .filter((c, i, lista) => lista.findIndex((o) => o.sha === c.sha) === i)
                    .sort((a, b) => (a.data === b.data ? 0 : a.data < b.data ? 1 : -1))
                    .slice(0, 40)
                extras.anterior = anteriorDaFonte?.dados ?? null
            }

            const extracao = await (fonte as Fonte<unknown>).extrair(arquivos, pedido.extrator, extras)
            if (extracao.consumo !== undefined) consumo = somar(consumo, extracao.consumo)

            const artigos = (fonte as Fonte<unknown>).renderizar(extracao.dados, ctx, caminhos)
            const estado = await gravarArtigos({
                escopo, artigos, fonte, shas, commit: commitSha, agora, extraidoPor: extracao.extraidoPor, repositorio: app.repositorio, pendentesDeVetor,
            })
            fontes[fonte.tipo] = { ...base(), ...estado, extraidoPor: extracao.extraidoPor }
        } catch (erro) {
            if (erro instanceof ErroDeLeitura && erro.codigoDeLeitura === 'limite_de_taxa') throw erro
            /// O que o modelo gastou antes da recusa entra na conta: foi pago.
            if (erro instanceof ErroDeExtracao && erro.consumo !== undefined) consumo = somar(consumo, erro.consumo)
            const mensagem = erro instanceof Error ? erro.message : String(erro)
            console.error(`[conhecimento] fonte ${fonte.tipo} falhou:`, mensagem)
            fontes[fonte.tipo] = { ...base(), estado: 'falhou', erro: mensagem, chaves: anterior?.chaves ?? [] }
        }
    }

    /// Passada 1: o índice técnico, determinístico. Reaproveita as análises de
    /// blobs iguais da rodada anterior; lê do GitHub só o que mudou.
    let mapa: ResultadoDaSincronizacao['mapa']
    let indiceTecnico: IndiceTecnico | undefined
    try {
        const { indice, lidos } = await montarIndice({
            commit: commitSha,
            arvore,
            ler: (_caminho, sha) => ler(sha),
            anterior: pedido.anterior?.indiceTecnico ?? null,
        })
        indiceTecnico = indice
        const artigos = renderizarMapa(indice, ctx)
        const estado = await gravarArtigos({
            escopo, artigos, fonte: { tipo: 'mapa', descricao: 'mapa técnico derivado do código', prefixoDaChave: PREFIXO_MAPA, publicarDireto: true, versaoDoExtrator: 1 },
            shas: Object.fromEntries(Object.entries(indice.analises).map(([c, a]) => [c, a.sha])), commit: commitSha, agora, extraidoPor: 'parser', repositorio: app.repositorio, pendentesDeVetor,
        })
        mapa = { telas: indice.telas.length, apis: indice.apis.length, arquivosLidos: lidos, artigos: estado.criados + estado.atualizados + estado.reabertos + estado.inalterados }
    } catch (erro) {
        if (erro instanceof ErroDeLeitura && erro.codigoDeLeitura === 'limite_de_taxa') throw erro
        const mensagem = erro instanceof Error ? erro.message : String(erro)
        console.error('[conhecimento] mapa técnico falhou:', mensagem)
        mapa = { erro: mensagem }
    }

    /**
     * Passada 2: a documentação funcional, uma tela por mensagem de fila.
     *
     * Não roda aqui dentro de propósito. Trinta e três telas a vinte segundos
     * cada passariam de dez minutos numa invocação só, e uma falha no fim
     * perderia tudo. Fatiada, cada tela tem a própria tentativa, o próprio teto
     * e o próprio registro — e a mensagem é idempotente por commit, então
     * repeti-la não gasta modelo.
     */
    let telas: ResultadoDaSincronizacao['telas']
    if (indiceTecnico !== undefined) {
        try {
            telas = await enfileirarTelas({
                escopo,
                indice: indiceTecnico,
                arvore,
                commitSha,
                fila: pedido.fila,
                apps: pedido.irmaos !== undefined && pedido.irmaos.length > 0 ? pedido.irmaos : [app],
                agora,
                teto: teto.telasPorRodada,
            })
            if (telas.adiadas > 0) avisos.push(`${telas.adiadas} tela(s) ficaram para a próxima rodada (teto de ${teto.telasPorRodada})`)
        } catch (erro) {
            const mensagem = erro instanceof Error ? erro.message : String(erro)
            console.error('[conhecimento] não consegui enfileirar as telas:', mensagem)
            telas = { erro: mensagem }
        }
    }

    /// Embeddings por último e em lotes: o que foi criado ou mudou ganha vetor.
    /// Falha aqui não falha a rodada — a busca por palavra continua valendo.
    /// Reparo: o que está no ar sem vetor entra na fila de embedding desta
    /// rodada — o artigo manual do Console, e o derivado de uma rodada em que o
    /// Workers AI falhou. Sem isto, um artigo nascia sem vetor e ficava assim.
    if (pedido.embutir !== null) {
        const jaNaFila = new Set(pendentesDeVetor.map((p) => p.id))
        const orfaos = await escopo.artigos.publicadosSemVetor(200).catch((e: unknown) => {
            console.error('[conhecimento] não consegui listar os publicados sem vetor:', e)
            return []
        })
        for (const a of orfaos) {
            if (!jaNaFila.has(a.id)) pendentesDeVetor.push({ id: a.id, texto: textoDeBusca(a) })
        }
    }

    let semVetor = 0
    if (pedido.embutir !== null && pendentesDeVetor.length > 0) {
        /// `embutir` divide em chamadas pequenas por dentro (teto do bge-m3 por
        /// chamada); aqui o lote é só para não segurar centenas de textos em
        /// memória e gravar conforme chegam.
        for (let i = 0; i < pendentesDeVetor.length; i += 32) {
            const lote = pendentesDeVetor.slice(i, i + 32)
            const vetores = await pedido.embutir(lote.map((p) => p.texto))
            await Promise.all(
                lote.map(async (p, j) => {
                    const v = vetores[j]
                    if (v === null || v === undefined) {
                        semVetor++
                        return
                    }
                    try {
                        await escopo.artigos.gravarEmbedding(p.id, v)
                    } catch (e) {
                        semVetor++
                        console.error('[conhecimento] embedding não gravado:', e)
                    }
                })
            )
        }
        /// Silêncio aqui já custou uma rodada inteira sem vetor (20/11/2026):
        /// o que falhou no embedding vira aviso no resultado, sempre.
        if (semVetor > 0) avisos.push(`${semVetor} de ${pendentesDeVetor.length} artigo(s) ficaram sem vetor: o Workers AI recusou ou a gravação falhou`)
    } else if (pedido.embutir === null && pendentesDeVetor.length > 0) {
        avisos.push(`${pendentesDeVetor.length} artigo(s) sem vetor: Workers AI indisponível`)
    }

    return {
        commit: commitSha,
        fontes,
        mapa,
        ...(telas === undefined ? {} : { telas }),
        ...(indiceTecnico === undefined ? {} : { indiceTecnico }),
        consumo,
        custoEstimadoUsd: Number(custoEstimado(consumo, pedido.tarifa).toFixed(4)),
        duracaoMs: Date.now() - inicio,
        avisos,
        vocabulario,
    }
}

async function lerVocabulario(
    app: AppSincronizavel,
    arvore: Map<string, { sha: string }>,
    ler: (sha: string) => Promise<string>
): Promise<Vocabulario> {
    const caminho = caminhoDoVocabulario(app)
    const entrada = arvore.get(caminho)
    if (entrada === undefined) throw new ErroDeExtracao('vocabulario', `${caminho} não existe no commit; sem vocabulário nada é derivado`)
    return extrairVocabulario(await ler(entrada.sha))
}

function mesmosShas(a: Record<string, string>, b: Record<string, string>): boolean {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

async function gravarArtigos(p: {
    escopo: EscopoDoApp
    artigos: ArtigoRenderizado[]
    fonte: Pick<Fonte, 'tipo' | 'descricao' | 'prefixoDaChave' | 'publicarDireto' | 'versaoDoExtrator'> | { tipo: string; descricao: string; prefixoDaChave: string; publicarDireto: boolean; versaoDoExtrator: number }
    shas: Record<string, string>
    commit: string
    agora: Date
    extraidoPor: 'parser' | 'modelo'
    repositorio: string
    pendentesDeVetor: { id: string; texto: string }[]
}): Promise<Pick<EstadoDaFonte, 'criados' | 'atualizados' | 'reabertos' | 'inalterados' | 'arquivados' | 'chaves'>> {
    const contagem = { criados: 0, atualizados: 0, reabertos: 0, inalterados: 0, arquivados: 0, chaves: [] as string[] }
    const inalteradas: string[] = []

    for (const artigo of p.artigos) {
        const fonte = {
            tipo: p.fonte.tipo,
            descricao: p.fonte.descricao,
            repositorio: p.repositorio,
            caminhos: artigo.caminhos,
            shas: Object.fromEntries(artigo.caminhos.map((c) => [c, p.shas[c] ?? ''])),
            commit: p.commit,
            versaoDoExtrator: p.fonte.versaoDoExtrator,
            extraidoPor: p.extraidoPor,
        }
        const { artigo: gravado, efeito } = await p.escopo.artigos.sincronizarDerivado({
            chave: artigo.chave,
            titulo: artigo.titulo,
            corpo: artigo.corpo,
            tags: artigo.tags,
            fonte,
            /// Passa por JSON para virar o tipo que o Prisma aceita e, de
            /// quebra, derrubar qualquer `undefined` ou `Date` que o extrator
            /// tenha deixado.
            dados: JSON.parse(JSON.stringify(artigo.dados)) as Prisma.InputJsonValue,
            publicarDireto: p.fonte.publicarDireto,
            agora: p.agora,
        })
        contagem.chaves.push(artigo.chave)

        if (efeito === 'inalterado') {
            contagem.inalterados++
            inalteradas.push(artigo.chave)
            continue
        }
        if (efeito === 'criado') contagem.criados++
        if (efeito === 'atualizado') contagem.atualizados++
        if (efeito === 'reaberto') contagem.reabertos++
        await evento(p.escopo, gravado.id, `artigo:derivado-${efeito}`, { fonte: p.fonte.tipo, commit: p.commit.slice(0, 7) })
        p.pendentesDeVetor.push({ id: gravado.id, texto: textoDeBusca({ id: gravado.id, titulo: artigo.titulo, corpo: artigo.corpo, tags: artigo.tags }) })
    }

    await p.escopo.artigos.tocarDerivados(inalteradas, p.agora)

    const arquivados = await p.escopo.artigos.arquivarDerivadosFora(p.fonte.prefixoDaChave, contagem.chaves)
    for (const a of arquivados) await evento(p.escopo, a.id, 'artigo:derivado-arquivado', { motivo: 'chave não produzida pela fonte', commit: p.commit.slice(0, 7) })
    contagem.arquivados = arquivados.length

    return contagem
}

async function evento(escopo: EscopoDoApp, artigoId: string, nome: string, depois: Record<string, unknown>): Promise<void> {
    await escopo.eventosDaBase
        .registrar({ artigoId, ator: ATOR, evento: nome, depois: depois as Prisma.InputJsonValue })
        .catch((e: unknown) => console.error('[conhecimento] evento não gravado:', e))
}

/**
 * Decide quais telas precisam de documentação e as põe na fila.
 *
 * Compara os shas dos arquivos de cada tela com o que o artigo dela já guarda
 * em `fonte.shas` — o próprio artigo é a fonte de verdade, não o resultado da
 * rodada anterior. Assim uma mensagem que falhou não deixa a tela esquecida
 * para sempre: na rodada seguinte ela aparece desatualizada outra vez.
 */
export async function enfileirarTelas(p: {
    escopo: EscopoDoApp
    indice: IndiceTecnico
    arvore: Map<string, { sha: string; tamanho: number }>
    commitSha: string
    fila: Fila | undefined
    apps: AppSincronizavel[]
    agora: Date
    teto: number
}): Promise<EstadoDasTelas> {
    const derivados = await p.escopo.artigos.listar({ origem: 'DERIVADO' })
    const porChave = new Map(derivados.filter((a) => a.chave !== null).map((a) => [a.chave as string, a]))

    const vivas: string[] = []
    const pendentes: { rota: string; arquivos: ArquivoEscolhido[] }[] = []
    let emDia = 0

    for (const tela of p.indice.telas) {
        const arquivos = contextoDaTela(tela, p.indice, p.arvore)
        if (arquivos.length === 0) continue

        const chave = chaveDaTela(tela.rota)
        vivas.push(chave)

        const fonte = (porChave.get(chave)?.fonte ?? null) as
            | { shas?: Record<string, string>; versaoDoExtrator?: number }
            | null
        const shas = Object.fromEntries(arquivos.map((a) => [a.caminho, a.sha]))
        const igual =
            fonte !== null &&
            fonte.versaoDoExtrator === VERSAO_DO_EXTRATOR_DE_TELA &&
            JSON.stringify(Object.entries(fonte.shas ?? {}).sort()) === JSON.stringify(Object.entries(shas).sort())

        if (igual) emDia++
        else pendentes.push({ rota: tela.rota, arquivos })
    }

    /// Rota que saiu do produto: o artigo dela sai do ar.
    const arquivados = await p.escopo.artigos.arquivarDerivadosFora(PREFIXO_TELA, vivas)
    for (const a of arquivados) {
        await evento(p.escopo, a.id, 'artigo:derivado-arquivado', { motivo: 'a rota não existe mais', commit: p.commitSha.slice(0, 7) })
    }

    const aEnfileirar = pendentes.slice(0, p.teto)
    if (p.fila !== undefined) {
        for (const { rota, arquivos } of aEnfileirar) {
            await p.fila.send({
                tipo: 'documentar-tela',
                rota,
                commitSha: p.commitSha,
                arquivos,
                appIds: p.apps.map((a) => a.id),
            })
        }
    }

    return {
        total: p.indice.telas.length,
        enfileiradas: p.fila === undefined ? 0 : aEnfileirar.length,
        emDia,
        arquivados: arquivados.length,
        adiadas: pendentes.length - aEnfileirar.length,
    }
}

// ─── O cron ──────────────────────────────────────────────────────────────

/** Entre duas sincronizações automáticas do mesmo app. Agrupa os merges da hora. */
export const INTERVALO_MINIMO_MS = 60 * 60 * 1000
/** Um pedido parado além disto expirou: alguém matou o consumidor no meio. */
export const EXPIRA_MS = 30 * 60 * 1000

export interface AcaoDoVigia {
    app: string
    acao: 'enfileirada' | 'em_dia' | 'em_andamento' | 'aguardando_intervalo' | 'expirada_e_refeita' | 'erro'
    detalhe?: string
}

/**
 * Roda no cron a cada cinco minutos: um pedido ao GitHub por repositório (com
 * ETag), e para cada app sincronizável decide se há o que fazer.
 */
export async function vigiarConhecimento(
    cliente: PrismaClient,
    opcoes: { leitor: LeitorDoRepositorio; fila: Fila | undefined; agora: Date }
): Promise<AcaoDoVigia[]> {
    const apps = await appsSincronizaveis(cliente)
    if (apps.length === 0 || opcoes.fila === undefined) return []

    const acoes: AcaoDoVigia[] = []
    const shaPorRepositorio = new Map<string, string>()

    for (const app of apps) {
        const repositorio = app.repositorio ?? ''
        try {
            let sha = shaPorRepositorio.get(repositorio)
            if (sha === undefined) {
                sha = await opcoes.leitor.shaDoRamo(repositorio, RAMO)
                shaPorRepositorio.set(repositorio, sha)
            }

            const escopo = escopoDoApp(cliente, app.id)
            const emAndamento = await escopo.sincronizacoes.emAndamento()
            if (emAndamento !== null) {
                if (opcoes.agora.getTime() - emAndamento.criadaEm.getTime() < EXPIRA_MS) {
                    acoes.push({ app: app.slug, acao: 'em_andamento' })
                    continue
                }
                await escopo.sincronizacoes.falhar(emAndamento.id, 'expirou: nenhum consumidor concluiu em 30 minutos', opcoes.agora)
            }

            const concluida = await escopo.sincronizacoes.ultimaConcluida()
            if (concluida?.commitSha === sha) {
                acoes.push({ app: app.slug, acao: 'em_dia' })
                continue
            }

            const ultima = await escopo.sincronizacoes.ultima()
            if (ultima !== null && !ultima.forcada && opcoes.agora.getTime() - ultima.criadaEm.getTime() < INTERVALO_MINIMO_MS && emAndamento === null) {
                acoes.push({ app: app.slug, acao: 'aguardando_intervalo' })
                continue
            }

            const pedido = await escopo.sincronizacoes.registrarPedido({ repositorio, commitSha: sha, pedidaPor: 'cron', forcada: false })
            await opcoes.fila.send({ tipo: 'sincronizar', appId: app.id, sincronizacaoId: pedido.id, commitSha: sha })
            acoes.push({ app: app.slug, acao: emAndamento === null ? 'enfileirada' : 'expirada_e_refeita', detalhe: sha.slice(0, 7) })
        } catch (erro) {
            acoes.push({ app: app.slug, acao: 'erro', detalhe: erro instanceof Error ? erro.message : String(erro) })
        }
    }

    return acoes
}

/** O botão "Sincronizar agora" do Console: pede com o sha atual, forçado. */
export async function pedirSincronizacao(p: {
    escopo: EscopoDoApp
    app: { id: string; repositorio: string }
    leitor: LeitorDoRepositorio
    fila: Fila
    pedidaPor: string
}): Promise<{ id: string; commitSha: string }> {
    const commitSha = await p.leitor.shaDoRamo(p.app.repositorio, RAMO)
    const pedido = await p.escopo.sincronizacoes.registrarPedido({ repositorio: p.app.repositorio, commitSha, pedidaPor: p.pedidaPor, forcada: true })
    await p.fila.send({ tipo: 'sincronizar', appId: p.app.id, sincronizacaoId: pedido.id, commitSha, forcar: true })
    return { id: pedido.id, commitSha }
}
