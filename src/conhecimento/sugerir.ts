import { z } from 'zod'

import type { ChamadoParaSugerir, EscopoDoApp } from '../dados/escopo.ts'
import { somar, ZERO, type Consumo } from '../agente/orcamento.ts'
import type { Extrator } from './extrair/com-modelo.ts'
import { detalheInternoEm } from './interno.ts'
import { anonimizar, dadosPessoaisEm, type Achado } from './privacidade.ts'
import { slug } from './rotulos.ts'

/**
 * A biblioteca de casos: chamado resolvido e lacuna repetida viram rascunho.
 *
 * É a quarta camada do plano, e a única que aprende do atendimento em vez do
 * repositório. O que o repositório nunca conta: como o cliente descreve o
 * problema ("o horário sumiu da agenda") e qual das causas possíveis é a que
 * acontece de verdade.
 *
 * **Nada publica sozinho.** Sai SUGERIDO em RASCUNHO, e uma pessoa aprova. É
 * a regra do documento de referência — um agente que reescreve a própria base
 * com tudo o que respondeu acumula o próprio erro — e também a resposta ao
 * risco de privacidade: o texto é de cliente.
 *
 * Três guardas, nesta ordem, e cada uma já reprovou algo:
 * 1. `anonimizar` antes do modelo (o que não entra no prompt não volta).
 * 2. `dadosPessoaisEm` na saída: recusa, não corrige.
 * 3. `detalheInternoEm` na saída: a nota interna é onde mora o nome da classe.
 */

export const VERSAO_DO_SUGERIDOR = 1
export const NOTA_MINIMA_DO_CSAT = 4
export const DIAS_PARA_ACEITAR_SEM_NOTA = 7
/**
 * Quantas vezes a mesma pergunta precisa aparecer sem resposta para virar
 * rascunho. Três, como o plano fixou: uma é alguém digitando estranho, duas é
 * coincidência, três é um assunto que a base não cobre.
 */
export const OCORRENCIAS_PARA_VIRAR_LACUNA = 3

export type MotivoDaRecusa =
    | 'nao-encerrado'
    | 'sem-pergunta-do-cliente'
    | 'sem-resposta-de-humano'
    | 'nota-baixa'
    | 'recente-e-sem-nota'
    | 'sem-fonte-na-base'
    | 'dado-pessoal-na-saida'
    | 'detalhe-interno-na-saida'

export interface ResultadoDaSugestao {
    chave: string
    criou: boolean
    recusa: MotivoDaRecusa | null
    /** Só o tipo e uma amostra curta: a trilha não guarda o dado. */
    achados: Achado[]
    consumo: Consumo
}

/**
 * Este chamado pode virar artigo?
 *
 * Roda sem banco e sem modelo, de propósito: é a regra de negócio da
 * biblioteca, e precisa de teste e não de rede.
 *
 * A exigência de resposta PÚBLICA de HUMANO é a que mais recusa, e é a mais
 * importante. Um chamado que a IA resolveu sozinha já estava respondido pela
 * base: virar artigo seria copiar a base de volta para dentro dela, com o erro
 * que ela tivesse. O que vale aprender é o que um humano soube e a base não.
 */
export function elegivel(chamado: ChamadoParaSugerir, agora: Date): { ok: true } | { ok: false; motivo: MotivoDaRecusa } {
    const encerrado = (chamado.status === 'RESOLVIDO' || chamado.status === 'FECHADO') && chamado.resolvidoEm !== null
    if (!encerrado) return { ok: false, motivo: 'nao-encerrado' }

    if (!chamado.mensagens.some((m) => m.autor === 'USUARIO')) return { ok: false, motivo: 'sem-pergunta-do-cliente' }

    const respostaDeHumano = chamado.mensagens.some(
        (m) => m.autor === 'HUMANO' && m.visibilidade === 'PUBLICA' && !m.rascunho
    )
    if (!respostaDeHumano) return { ok: false, motivo: 'sem-resposta-de-humano' }

    if (chamado.csat !== null) {
        return chamado.csat.nota >= NOTA_MINIMA_DO_CSAT ? { ok: true } : { ok: false, motivo: 'nota-baixa' }
    }

    /**
     * Sem nota, espera-se o prazo de reabertura. Quem reabre em três dias
     * discorda da resposta, e um artigo tirado dela ensinaria o erro.
     */
    const limite = new Date(agora.getTime() - DIAS_PARA_ACEITAR_SEM_NOTA * 24 * 60 * 60 * 1000)
    return (chamado.resolvidoEm as Date) <= limite ? { ok: true } : { ok: false, motivo: 'recente-e-sem-nota' }
}

const esquemaDoCaso = z
    .object({
        titulo: z.string().min(8).max(120),
        /** Como o cliente descreve, não como o sistema se chama. */
        sintoma: z.string().min(10).max(600),
        causa: z.string().min(10).max(600),
        comoResolver: z.array(z.string().min(4).max(400)).min(1).max(10),
        tags: z.array(z.string().min(2).max(40)).max(6),
    })
    .strict()

type Caso = z.infer<typeof esquemaDoCaso>

const INSTRUCAO_DO_CASO = `Você recebe UM chamado de suporte já encerrado, com a pergunta do cliente e a resposta do atendente. Escreva o caso como artigo de ajuda, em português do Brasil, para OUTRO cliente que tenha o mesmo problema.

Regras:
- O sintoma é como o cliente descreveria, não como o sistema se chama por dentro.
- A causa é a que o atendente confirmou neste chamado. Se ele não disse a causa, escreva o que ficou claro do que ele fez, sem inventar explicação técnica.
- "comoResolver" são passos que o próprio cliente consegue seguir na tela.
- Nunca escreva nome de arquivo, de tabela, de variável, de rota de API nem de classe. Nunca escreva nome de pessoa, de empresa, e-mail, telefone, CPF ou link com código. Se o texto do chamado trouxer algo assim, deixe de fora.
- Nunca prometa prazo e nunca fale de dinheiro, reembolso ou cobrança.`

/**
 * O chamado como o modelo o recebe: papéis rotulados, texto anonimizado.
 *
 * As notas INTERNAS entram, e é uma decisão com risco: é nelas que o atendente
 * registra a causa confirmada, que é a parte do artigo que o repositório não
 * tem. O preço é que a nota interna também é onde ele escreve o nome da
 * classe — por isso a saída passa por `detalheInternoEm`.
 */
function chamadoEmTexto(chamado: ChamadoParaSugerir, nomes: string[]): string {
    const linhas = [`Assunto: ${anonimizar(chamado.assunto, nomes)}`, '']

    for (const m of chamado.mensagens) {
        if (m.rascunho) continue
        if (m.autor === 'SISTEMA') continue
        const quem =
            m.autor === 'USUARIO'
                ? 'CLIENTE'
                : m.autor === 'IA'
                  ? 'IA (resposta automática)'
                  : m.visibilidade === 'INTERNA'
                    ? 'ATENDENTE (nota interna)'
                    : 'ATENDENTE'
        linhas.push(`[${quem}] ${anonimizar(m.corpo, nomes)}`, '')
    }

    return linhas.join('\n')
}

/** O corpo do artigo é montado pelo Desk, não pelo modelo. */
function casoEmMarkdown(caso: Caso): string {
    return [
        '## O que acontece',
        caso.sintoma,
        '',
        '## Por que acontece',
        caso.causa,
        '',
        '## Como resolver',
        ...caso.comoResolver.map((passo, i) => `${i + 1}. ${passo}`),
    ].join('\n')
}

function textosDoCaso(caso: Caso): string[] {
    return [caso.titulo, caso.sintoma, caso.causa, ...caso.comoResolver, ...caso.tags]
}

type EscopoDaSugestao = Pick<EscopoDoApp, 'artigos' | 'eventosDaBase'>

export async function sugerirDeChamado(p: {
    escopo: EscopoDaSugestao
    chamado: ChamadoParaSugerir
    extrator: Extrator
    agora: Date
}): Promise<ResultadoDaSugestao> {
    const chave = `sugerido:chamado:${p.chamado.id}`
    const vazio = { chave, criou: false, achados: [], consumo: ZERO }

    const veredito = elegivel(p.chamado, p.agora)
    if (!veredito.ok) return { ...vazio, recusa: veredito.motivo }

    const nomes = [p.chamado.requester.nome, p.chamado.tenant.nome]
    const { dados: caso, consumo } = await p.extrator.extrair({
        esquema: esquemaDoCaso,
        instrucao: INSTRUCAO_DO_CASO,
        arquivos: [{ caminho: `chamado-${p.chamado.numero}.txt`, conteudo: chamadoEmTexto(p.chamado, nomes) }],
        maxTokensSaida: 3_000,
    })

    const textos = textosDoCaso(caso)
    const achados = dadosPessoaisEm(textos.join('\n'), nomes)
    if (achados.length > 0) {
        await registrarRecusa(p.escopo, chave, 'dado-pessoal-na-saida', achados)
        return { ...vazio, recusa: 'dado-pessoal-na-saida', achados, consumo }
    }

    const internos = detalheInternoEm(textos)
    if (internos.length > 0) {
        await registrarRecusa(p.escopo, chave, 'detalhe-interno-na-saida', [])
        return { ...vazio, recusa: 'detalhe-interno-na-saida', consumo }
    }

    const { artigo, criado } = await p.escopo.artigos.criarSugerido({
        chave,
        titulo: caso.titulo,
        corpo: casoEmMarkdown(caso),
        tags: [...new Set(['caso', ...caso.tags])],
        fonte: {
            tipo: 'chamado',
            ticketId: p.chamado.id,
            numero: p.chamado.numero,
            notaDoCsat: p.chamado.csat?.nota ?? null,
            versaoDoSugeridor: VERSAO_DO_SUGERIDOR,
            geradoEm: p.agora.toISOString(),
        },
    })

    if (criado) {
        await p.escopo.eventosDaBase.registrar({
            artigoId: artigo.id,
            ator: 'ia:sugeridor',
            evento: 'sugerido:de-chamado',
            depois: { chave, numero: p.chamado.numero },
        })
    }

    return { chave, criou: criado, recusa: null, achados: [], consumo }
}

const esquemaDaResposta = z
    .object({
        titulo: z.string().min(8).max(120),
        resposta: z.string().min(20).max(2_500),
        /** As chaves dos artigos em que a resposta se apoia. */
        artigosUsados: z.array(z.string().min(1).max(200)).min(1).max(8),
    })
    .strict()

const INSTRUCAO_DA_LACUNA = `Clientes perguntaram algo que a base não responde. Você recebe os artigos mais próximos que existem hoje. Escreva, em português do Brasil, a resposta que falta, usando SÓ o que está nos artigos.

Regras:
- Se os artigos não respondem a pergunta, devolva "resposta" dizendo exatamente o que falta documentar, e liste em "artigosUsados" os que chegaram perto.
- Nunca escreva nome de arquivo, de tabela, de variável, de rota de API nem de classe.
- Nunca prometa prazo e nunca fale de dinheiro, reembolso ou cobrança.
- Não invente passo que não esteja nos artigos.`

export async function sugerirDeLacuna(p: {
    escopo: EscopoDaSugestao
    /** O texto de uma das ocorrências, como alguém escreveu. */
    exemplo: string
    vezes: number
    extrator: Extrator
    agora: Date
}): Promise<ResultadoDaSugestao> {
    const chave = `sugerido:lacuna:${slug(p.exemplo).slice(0, 60)}`
    const vazio = { chave, criou: false, achados: [], consumo: ZERO }

    const achadosNaBase = await p.escopo.artigos.buscar(p.exemplo, 6)
    if (achadosNaBase.length === 0) return { ...vazio, recusa: 'sem-fonte-na-base' }

    const { dados, consumo } = await p.extrator.extrair({
        esquema: esquemaDaResposta,
        instrucao: INSTRUCAO_DA_LACUNA,
        arquivos: achadosNaBase.map(({ artigo }) => ({
            caminho: artigo.chave ?? artigo.id,
            conteudo: `# ${artigo.titulo}\n\n${artigo.corpo}`,
        })),
        maxTokensSaida: 3_000,
    })

    const textos = [dados.titulo, dados.resposta]
    /// Sem nomes: a lacuna é texto de busca, não de chamado, e o que pudesse
    /// ter de nome próprio já foi registrado sem dono.
    const achados = dadosPessoaisEm(textos.join('\n'))
    if (achados.length > 0) {
        await registrarRecusa(p.escopo, chave, 'dado-pessoal-na-saida', achados)
        return { ...vazio, recusa: 'dado-pessoal-na-saida', achados, consumo }
    }

    const internos = detalheInternoEm(textos)
    if (internos.length > 0) {
        await registrarRecusa(p.escopo, chave, 'detalhe-interno-na-saida', [])
        return { ...vazio, recusa: 'detalhe-interno-na-saida', consumo }
    }

    const { artigo, criado } = await p.escopo.artigos.criarSugerido({
        chave,
        titulo: dados.titulo,
        corpo: `${dados.resposta}\n`,
        tags: ['caso', 'lacuna'],
        fonte: {
            tipo: 'lacuna',
            exemplo: p.exemplo,
            vezes: p.vezes,
            /**
             * As chaves em que a resposta se apoia, para o Console avisar
             * "a fonte mudou desde a aprovação" quando um derivado for
             * ressincronizado (ver `fontesDesatualizadas`).
             */
            artigos: achadosNaBase.map(({ artigo: a }) => ({
                chave: a.chave ?? a.id,
                sincronizadoEm: a.sincronizadoEm?.toISOString() ?? null,
            })),
            versaoDoSugeridor: VERSAO_DO_SUGERIDOR,
            geradoEm: p.agora.toISOString(),
        },
    })

    if (criado) {
        await p.escopo.eventosDaBase.registrar({
            artigoId: artigo.id,
            ator: 'ia:sugeridor',
            evento: 'sugerido:de-lacuna',
            depois: { chave, vezes: p.vezes },
        })
    }

    return { chave, criou: criado, recusa: null, achados: [], consumo }
}

/**
 * A recusa também é trilha.
 *
 * Sem isto, uma sugestão barrada por dado pessoal desapareceria em silêncio, e
 * ninguém saberia que o detector está trabalhando — nem que ele passou a
 * barrar tudo. O evento não carrega o dado: só o tipo e a amostra curta.
 *
 * `artigoId` fica com a chave que a sugestão teria, porque não há artigo:
 * `kb_eventos.artigo_id` existe sem chave estrangeira exatamente para isto.
 */
async function registrarRecusa(
    escopo: EscopoDaSugestao,
    chave: string,
    motivo: MotivoDaRecusa,
    achados: Achado[]
): Promise<void> {
    await escopo.eventosDaBase.registrar({
        artigoId: chave,
        ator: 'ia:sugeridor',
        evento: 'sugerido:recusado',
        depois: { motivo, achados: achados.map((a) => ({ tipo: a.tipo, amostra: a.amostra })) },
    })
}

/**
 * As fontes de um sugerido que mudaram depois de ele ser escrito.
 *
 * Um rascunho aprovado há duas semanas citava a tela de Procedimentos como ela
 * era; se a tela mudou, o artigo aprovado pode estar errado e ninguém notaria.
 * O Console pinta; nada é despublicado automaticamente — quem publicou decide.
 */
export function fontesDesatualizadas(
    fonte: unknown,
    atuais: { chave: string | null; sincronizadoEm: Date | null }[]
): string[] {
    const esquema = z.object({
        artigos: z.array(z.object({ chave: z.string(), sincronizadoEm: z.string().nullable() })),
    })
    const lida = esquema.safeParse(fonte)
    if (!lida.success) return []

    return lida.data.artigos
        .filter((citado) => {
            const atual = atuais.find((a) => a.chave === citado.chave)
            if (atual === undefined || atual.sincronizadoEm === null) return false
            if (citado.sincronizadoEm === null) return true
            return atual.sincronizadoEm.toISOString() !== citado.sincronizadoEm
        })
        .map((c) => c.chave)
}

/** Acumula o consumo de uma varredura inteira. */
export function somarConsumos(consumos: Consumo[]): Consumo {
    return consumos.reduce((acc, c) => somar(acc, c), ZERO)
}
