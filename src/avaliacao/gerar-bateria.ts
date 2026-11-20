import { z } from 'zod'

import { dobrar } from '../dominio/busca.ts'
import type { Extrator } from '../conhecimento/extrair/com-modelo.ts'
import { curto, frase } from '../conhecimento/extrair/limites.ts'
import { DISTRIBUICAO, type CasoDaBateria, type CategoriaDaBateria } from './bateria.ts'
import { TECNICOS } from './bateria-tecnicos.ts'

/**
 * Gera as perguntas da bateria a partir da base viva.
 *
 * **Por que a partir dos artigos.** A especificação pedia 50 dúvidas reais por
 * app, e o censo de 19/11/2026 provou que elas não existem: produção com zero
 * chamados. Inventá-las de cabeça mediria se o agente concorda com o meu
 * palpite sobre o produto. Geradas do artigo, elas medem o que importa — se o
 * agente ACHA a resposta que a empresa já tem escrita.
 *
 * **O gabarito é ancorado no artigo.** Cada termo que a resposta precisa dizer
 * tem de existir no artigo de origem. Sem isso, o modelo escreveria pergunta e
 * gabarito do mesmo palpite, e a bateria mediria a coerência dele consigo
 * mesmo.
 *
 * **A pergunta imita cliente, não documentação.** A instrução pede o jeito como
 * alguém escreve com pressa: sem o nome exato da tela, com a palavra do dia a
 * dia, às vezes com dois assuntos juntos. Uma pergunta que repete o título do
 * artigo mede a busca por palavra, e essa já tem teste.
 */

const esquemaDosCasos = z
    .object({
        casos: z
            .array(
                z
                    .object({
                        assunto: curto,
                        mensagem: frase,
                        /**
                         * Grupos de alternativas. Em cada grupo, ao menos uma
                         * precisa aparecer na resposta.
                         */
                        precisaDizer: z.array(z.array(curto).min(1)).max(4),
                    })
                    .strict()
            )
            .max(20),
    })
    .strict()

const INSTRUCAO = `Você escreve perguntas de clientes para testar um atendimento de suporte.

Receberá UM artigo da base de conhecimento de um produto. Escreva perguntas que esse artigo responde, como um cliente de verdade as escreveria — com pressa, sem saber o nome exato da tela, usando a palavra do dia a dia dele. Algumas podem trazer um detalhe irrelevante junto, como acontece de verdade.

Para cada pergunta devolva:
- assunto: o que a pessoa escreveria no campo de assunto (curto, às vezes mal escrito).
- mensagem: o texto da dúvida, em uma ou três frases, na voz dela.
- precisaDizer: os grupos de termos que uma boa resposta tem de conter. Cada grupo é uma lista de ALTERNATIVAS equivalentes (sinônimos, o caminho do menu e o nome da tela). Use TERMOS que aparecem no artigo, nunca uma frase inteira. De um a três grupos por pergunta.

NÃO escreva pergunta cuja resposta não esteja no artigo. NÃO repita o título do artigo dentro da pergunta — o cliente não o conhece.`

export interface ArtigoParaGerar {
    chave: string
    titulo: string
    corpo: string
}

/** Quantas perguntas tirar de um artigo, por categoria. */
export async function gerarCasosDeArtigo(p: {
    artigo: ArtigoParaGerar
    app: string
    categoria: CategoriaDaBateria
    quantas: number
    extrator: Extrator
    rota?: string
}): Promise<CasoDaBateria[]> {
    const { dados } = await p.extrator.extrair({
        esquema: esquemaDosCasos,
        instrucao: `${INSTRUCAO}\n\nEscreva ${p.quantas} pergunta(s).`,
        arquivos: [{ caminho: `artigo: ${p.artigo.titulo}`, conteudo: p.artigo.corpo }],
        maxTokensSaida: 4_000,
    })

    /// Título E corpo: o nome da tela está no título, e é um termo legítimo
    /// para a resposta citar.
    const noArtigo = dobrar(`${p.artigo.titulo}\n${p.artigo.corpo}`)

    return dados.casos.slice(0, p.quantas).map((c, i) => {
        /**
         * Grupo cujo termo nenhum existe no artigo é DESCARTADO, não corrige a
         * pergunta: o gabarito ficaria exigindo o que a base não diz, e a
         * bateria reprovaria um agente certo.
         */
        const grupos = c.precisaDizer
            .map((grupo) => grupo.filter((t) => noArtigo.includes(dobrar(t))))
            .filter((grupo) => grupo.length > 0)

        return {
            id: `${p.categoria}-${p.app}-${p.artigo.chave.replace(/[^a-z0-9]+/gi, '-').slice(-24)}-${i + 1}`,
            app: p.app,
            categoria: p.categoria,
            assunto: c.assunto,
            mensagem: c.mensagem,
            ...(p.rota === undefined ? {} : { rota: p.rota }),
            gabarito: {
                desfecho: 'respondeu' as const,
                precisaDizer: grupos,
                artigoEsperado: p.artigo.chave,
            },
        }
    })
}

/**
 * Quais artigos alimentam cada categoria.
 *
 * Não é só organização: cada categoria mede uma capacidade diferente, e tirar
 * todas as perguntas das telas daria um número alto sobre uma habilidade só.
 */
export function fonteDaCategoria(chave: string): CategoriaDaBateria | null {
    if (chave.startsWith('derivado:faq:')) return 'duvida'
    if (chave.startsWith('derivado:produto:')) return 'duvida'
    if (chave === 'derivado:planos' || chave === 'derivado:emails') return 'duvida'
    if (chave === 'derivado:papeis') return 'permissao'
    if (chave.startsWith('derivado:tela:')) {
        /// Telas de integração e de agente medem outra coisa: configuração que
        /// depende de terceiro (WhatsApp, Google, provedor de DNS).
        if (/integracoes|agentes|remetentes|canais/.test(chave)) return 'integracao'
        return 'uso'
    }
    return null
}

/** Os técnicos, nomeados para o app. */
export function tecnicosDoApp(app: string): CasoDaBateria[] {
    return TECNICOS.map((c) => ({ ...c, app, id: `${c.id}-${app}` }))
}

export { DISTRIBUICAO }
