import { dobrar } from '../dominio/busca.ts'
import { palavrasEstranhas } from './renderizar/vocabulario.ts'
import { PALAVRAS_DO_VOCABULARIO, type PalavraDoVocabulario, type Vocabulario } from './tipos.ts'

/**
 * O que difere entre os três apps além do vocabulário — e portanto não devia
 * diferir.
 *
 * Os três produtos são cascas sobre o mesmo `packages/core`: a tela de agenda é
 * a mesma, e o que muda é "Paciente" virar "Cliente". Então toda diferença que
 * SOBRA depois de dobrar o vocabulário é uma de três coisas: conteúdo
 * triplicado à mão que saiu do passo (a FAQ do venn-saas, que é literalmente
 * três cópias divergentes), texto de um nicho dentro de outro ("clínica" no app
 * de agenciamento) ou um artigo que existe num app e falta no vizinho.
 *
 * **Custa zero.** É comparação de texto sobre o que já está no banco. Foi a
 * medição que mostrou que rodar a bateria inteira nos três apps paga três vezes
 * pela mesma prova: 97% dos artigos de tela e todos os mapas técnicos são
 * idênticos entre apps depois de dobrar o vocabulário. Modelo fica para o que
 * é comportamento do agente.
 */

export type TipoDeDivergencia = 'conteudo' | 'ausente' | 'palavra-de-outro-nicho'

/**
 * Cada palavra do vocabulário vira um MARCADOR, nos dois lados.
 *
 * A primeira versão traduzia o texto de um app para o vocabulário do outro, e
 * isso acusou 104 divergências falsas em 21/11/2026: traduzir não é inversível
 * quando a palavra do nicho coincide com palavra comum. O mapa técnico do
 * Conecta diz "expõe a API ao cliente" no sentido corriqueiro; traduzido para o
 * Odontobox virou "ao paciente" e divergiu de um texto idêntico.
 *
 * Dobrar para marcador é simétrico e não inventa: "paciente" e "cliente" viram
 * `{pessoa}` cada um no seu app, e o que sobra de diferente é diferente mesmo.
 */
const MARCADORES: Record<PalavraDoVocabulario, string> = {
    organizacao: '{org}', Organizacao: '{org}', organizacoes: '{orgs}', Organizacoes: '{orgs}',
    pessoa: '{pes}', Pessoa: '{pes}', pessoas: '{pess}', Pessoas: '{pess}',
    profissional: '{pro}', Profissional: '{pro}', profissionais: '{pros}', Profissionais: '{pros}',
    servico: '{ser}', Servico: '{ser}', servicos: '{sers}', Servicos: '{sers}',
}

/**
 * Rota, URL e código entre acentos graves NÃO entram na dobra.
 *
 * `/vendas/clientes` é o caminho do código e é igual nos três apps; no Conecta
 * "clientes" é vocabulário, então dobrar transformava a rota em `/vendas/{pess}`
 * e o menu divergia de um texto idêntico. O mesmo vale para nome de tabela e de
 * arquivo no mapa técnico.
 */
function semCodigo(texto: string): string {
    return texto
        .replace(/`[^`]*`/g, '{cod}')
        .replace(/https?:\/\/\S+/g, '{url}')
        .replace(/(?:^|\s)\/[a-z0-9[\]/_.-]+/gi, ' {rota}')
}

function comMarcadores(texto: string, app: { nome: string; slug: string; vocabulario: Vocabulario }): string {
    const voc = app.vocabulario
    /// Plural antes de singular, senão "paciente" roe o começo de "pacientes".
    /// O nome e o slug do produto entram na mesma dobra: "as mudanças
    /// publicadas no Odontobox360" e "no Conecta360" são o mesmo texto.
    const pares = [
        ...PALAVRAS_DO_VOCABULARIO.map((k) => [dobrar(voc[k]), MARCADORES[k]] as const),
        [dobrar(app.nome), '{app}'] as const,
        [dobrar(app.slug), '{app}'] as const,
    ].sort((a, b) => b[0].length - a[0].length)
    let saida = semCodigo(dobrar(texto))
    for (const [palavra, marcador] of pares) {
        saida = saida.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapar(palavra)}(?![\\p{L}\\p{N}])`, 'gu'), marcador)
    }
    return saida
}

function escapar(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Corta o rodapé de procedência antes de comparar.
 *
 * Ele é montado pelo Desk e carrega o caminho do arquivo de cada app
 * (`apps/odontobox360/…`), que é diferente por construção. Sem este corte, 38
 * das 104 divergências eram o rodapé da FAQ dizendo o nome da pasta.
 */
function semProcedencia(texto: string): string {
    const corte = texto.lastIndexOf('\nFonte:')
    let base = corte < 0 ? texto : texto.slice(0, corte)

    /**
     * Acima do "Fonte:" ainda pode vir a nota de que as palavras do nicho foram
     * trocadas automaticamente. Ela existe só nos apps que NÃO são a origem do
     * texto, então contá-la fazia todo artigo de regra de produto divergir —
     * 15 dos 47 achados de 21/11/2026 eram essa frase. Separadores e parágrafos
     * entre parênteses no fim saem em laço, porque vêm em qualquer ordem.
     */
    for (;;) {
        const antes = base
        base = base.replace(/(?:\s*-{3,}\s*)+$/, '').replace(/\n\s*\([^)]*\)\s*$/, '')
        if (base === antes) return base
    }
}

export interface Divergencia {
    tipo: TipoDeDivergencia
    chave: string
    /** O app em que o problema aparece. */
    app: string
    /** O app com que foi comparado. Vazio em `palavra-de-outro-nicho`. */
    comparadoCom: string
    detalhe: string
}

export interface AppComparavel {
    slug: string
    /** "Odontobox360". O nome do produto aparece no texto e também precisa dobrar. */
    nome: string
    vocabulario: Vocabulario
    artigos: { chave: string; titulo: string; corpo: string }[]
}

/**
 * Compara os apps dois a dois, sempre contra o PRIMEIRO da lista.
 *
 * Contra o primeiro, e não todos contra todos, porque três comparações cruzadas
 * relatariam a mesma divergência três vezes e a tela mostraria o triplo do
 * problema que existe. Quem chama escolhe a referência; na prática é o app mais
 * antigo, cujo texto os outros copiaram.
 */
export function divergencias(apps: AppComparavel[]): Divergencia[] {
    if (apps.length < 2) return []
    const [referencia, ...outros] = apps as [AppComparavel, ...AppComparavel[]]
    const achados: Divergencia[] = []

    /**
     * Casa por chave CRUA e, só para o que não casou, pela chave dobrada.
     *
     * As duas formas existem no produto e nenhuma sozinha serve. A chave da
     * tela vem da rota do código e é igual nos três apps
     * (`derivado:tela:vendas-servicos`), então dobrar quebraria o par: no
     * Conecta "servicos" é vocabulário e no Odontobox não. A chave da FAQ vem
     * do título e carrega vocabulário (`…o-mesmo-paciente-…` contra
     * `…o-mesmo-cliente-…`), então sem dobrar o par não se forma. Medido em
     * 21/11/2026: cada uma das duas estratégias sozinha inventava 22 artigos
     * "ausentes" que existem nos dois lados.
     */
    const casar = (app: AppComparavel) => {
        const cruas = new Map(app.artigos.map((a) => [a.chave, a]))
        const dobradas = new Map(app.artigos.map((a) => [comMarcadores(a.chave, app), a]))
        return { cruas, dobradas, todas: app.artigos }
    }

    const naReferencia = casar(referencia)

    for (const app of outros) {
        const daqui = casar(app)
        const pareados = new Set<string>()

        for (const artigo of naReferencia.todas) {
            const par =
                daqui.cruas.get(artigo.chave) ?? daqui.dobradas.get(comMarcadores(artigo.chave, referencia))
            if (par !== undefined) pareados.add(par.chave)
            if (par === undefined) {
                achados.push({
                    tipo: 'ausente',
                    chave: artigo.chave,
                    app: app.slug,
                    comparadoCom: referencia.slug,
                    detalhe: `existe em ${referencia.slug} e falta aqui`,
                })
                continue
            }

            const cruAqui = normalizar(dobrar(semProcedencia(artigo.corpo)))
            const cruLa = normalizar(dobrar(semProcedencia(par.corpo)))

            /**
             * Texto LITERALMENTE igual, antes de qualquer dobra.
             *
             * Em artigo que não usa vocabulário (o mapa técnico) isso é o
             * esperado. Em artigo que usa, é cópia que ninguém traduziu — a FAQ
             * triplicada à mão, com "paciente" dentro do app de agenciamento. A
             * checagem tem de vir ANTES de dobrar: depois de trocar as palavras
             * por marcadores, cópia não traduzida e texto correto ficam
             * indistinguíveis.
             */
            if (cruAqui === cruLa) {
                /**
                 * Só as palavras da REFERÊNCIA, que é de quem o texto foi
                 * copiado. Procurar o vocabulário de qualquer app acusava
                 * "empresa" dentro do Stagent num texto que o Odontobox também
                 * tem: "empresa" é palavra comum do português ali, e termo de
                 * nicho do Conecta por coincidência. O que prova cópia é o
                 * termo de QUEM foi copiado aparecer intacto.
                 */
                const estranhas = palavrasEstranhas(semProcedencia(par.corpo), app.vocabulario, [referencia.vocabulario])
                if (estranhas.length > 0) {
                    achados.push({
                        tipo: 'palavra-de-outro-nicho',
                        chave: par.chave,
                        app: app.slug,
                        comparadoCom: referencia.slug,
                        detalhe: `texto igual ao de ${referencia.slug}, com: ${estranhas.join(', ')}`,
                    })
                }
                continue
            }

            const aqui = normalizar(comMarcadores(semProcedencia(artigo.corpo), referencia))
            const la = normalizar(comMarcadores(semProcedencia(par.corpo), app))
            if (aqui === la) continue

            achados.push({
                tipo: 'conteudo',
                chave: par.chave,
                app: app.slug,
                comparadoCom: referencia.slug,
                detalhe: primeiraLinhaDiferente(aqui, la),
            })
        }

        for (const artigo of daqui.todas) {
            if (pareados.has(artigo.chave)) continue
            achados.push({
                tipo: 'ausente',
                chave: artigo.chave,
                app: referencia.slug,
                comparadoCom: app.slug,
                detalhe: `existe em ${app.slug} e falta aqui`,
            })
        }
    }

    return achados
}

function normalizar(texto: string): string {
    return texto.replace(/\s+/g, ' ').trim()
}

/**
 * Onde os dois textos passam a diferir, em poucas palavras.
 *
 * Um diff inteiro não cabe numa linha de tela e ninguém o leria; a primeira
 * frase que difere basta para decidir se vale abrir os dois artigos.
 */
function primeiraLinhaDiferente(a: string, b: string): string {
    const pa = a.split(' ')
    const pb = b.split(' ')
    const i = pa.findIndex((p, k) => p !== pb[k])
    if (i < 0) return `${a.length > b.length ? 'sobra' : 'falta'} texto no fim`
    return `a partir de "…${pa.slice(Math.max(0, i - 3), i + 4).join(' ')}"`
}

/**
 * As chaves que valem medir num app secundário.
 *
 * É o recorte da bateria: no app de referência ela roda inteira, porque mede o
 * AGENTE, que é o mesmo nos três; nos outros dois só o que de fato muda entre
 * apps. Medido em 21/11/2026: 87 dos 100 casos são o mesmo caso com outro
 * vocabulário, e a prova repetida custava US$ 27 por app.
 */
export function chavesQueDivergem(achados: Divergencia[]): string[] {
    return [...new Set(achados.map((d) => d.chave))].sort()
}
