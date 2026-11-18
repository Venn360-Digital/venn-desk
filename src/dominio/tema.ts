import { z } from 'zod'

/**
 * O tema do widget — cor, posição, atendente e textos, por app.
 *
 * **Por que isto mora no Venn Desk e não no código do app.** O widget é um
 * pacote de código-fonte que cada app compila junto, e a tentação é passar cor
 * e textos como props. Fazendo assim, mudar a cor do botão do Conecta vira um
 * deploy do Conecta — e a pessoa que decide a cor não é a que faz deploy. Com
 * o tema aqui, a mudança é um clique no Console e vale na próxima vez que
 * alguém abrir a tela do app.
 *
 * O campo `apps.tema` existe no banco desde o começo com exatamente esta
 * descrição ("cores, posição do botão, vocabulário do nicho") e estava sem uso.
 *
 * **O que NÃO entra aqui.** Nada que mude comportamento: modo sombra,
 * atendimento automático e metas de SLA são chaves próprias, com permissão
 * própria. Tema é aparência e palavra — se alguém errar, ninguém perde chamado.
 */

/** `#1F56B5`. Três ou seis dígitos, com o `#`. */
const cor = z
    .string()
    .trim()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use uma cor em hexadecimal, como #1F56B5.')

export const esquemaDoTema = z.object({
    /** A cor do botão e dos destaques. Cai no `--primary` do app quando ausente. */
    corDeDestaque: cor.optional(),
    /** A cor do texto SOBRE a cor de destaque. */
    corSobreDestaque: cor.optional(),
    /** De que lado o botão flutua. */
    posicao: z.enum(['direita', 'esquerda']).default('direita'),
    /** Distância das bordas, em pixels. Para não cobrir outro botão flutuante. */
    margem: z.number().int().min(0).max(120).default(24),
    /** Quem assina o atendimento. Aparece no cabeçalho e na saudação. */
    atendente: z
        .object({
            nome: z.string().trim().min(1).max(40).optional(),
            avatar: z.string().trim().url().max(500).optional(),
        })
        .default({}),
    /** A primeira frase que a pessoa lê ao abrir o painel. */
    saudacao: z.string().trim().max(280).optional(),
    /** O substantivo do nicho: "clínica", "agência", "estúdio". */
    organizacao: z.string().trim().max(40).optional(),
    /** Os módulos do app, para o usuário dizer onde aconteceu. */
    modulos: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    /**
     * Esconde o botão flutuante sem desinstalar nada.
     *
     * Serve a duas situações reais: desligar o suporte num app durante uma
     * migração, e abrir o painel só por um menu do próprio app.
     */
    mostrarBotao: z.boolean().default(true),
})

export type Tema = z.infer<typeof esquemaDoTema>

/** O tema de um app sem nada cadastrado. */
export const TEMA_PADRAO: Tema = esquemaDoTema.parse({})

/**
 * Lê o que está no banco, que é `Json?` e pode ser qualquer coisa.
 *
 * Nunca lança: um tema inválido — de uma versão antiga, de uma edição à mão no
 * banco — deve virar o padrão, e não derrubar o widget de todo mundo. O widget
 * é a porta do suporte; se ela quebrar, a pessoa não tem como reclamar que ela
 * quebrou.
 */
export function lerTema(bruto: unknown): Tema {
    const lido = esquemaDoTema.safeParse(bruto ?? {})
    return lido.success ? lido.data : TEMA_PADRAO
}

/**
 * A luminância relativa de uma cor, pela fórmula da WCAG.
 *
 * Serve a uma coisa só: avisar quando a cor escolhida deixa o texto do botão
 * ilegível. Não bloqueia — a marca é do cliente, e um aviso que impede é um
 * aviso que será contornado por fora.
 */
function luminancia(hex: string): number {
    const limpo = hex.replace('#', '')
    const cheio =
        limpo.length === 3
            ? limpo
                  .split('')
                  .map((d) => d + d)
                  .join('')
            : limpo

    const canais = [0, 2, 4].map((i) => {
        const v = parseInt(cheio.slice(i, i + 2), 16) / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })

    return 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!
}

/** O contraste entre duas cores, de 1 (nenhum) a 21 (preto sobre branco). */
export function contraste(a: string, b: string): number {
    const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number]
    return Number(((maior + 0.05) / (menor + 0.05)).toFixed(2))
}

/** O mínimo da WCAG AA para texto grande e elementos de interface. */
export const CONTRASTE_MINIMO = 3

/**
 * Entre preto e branco, qual se lê melhor sobre esta cor.
 *
 * É o padrão quando ninguém escolheu `corSobreDestaque` — e acerta na enorme
 * maioria dos casos, porque botão de ação é cor saturada, e cor saturada tem
 * um dos dois extremos como par óbvio.
 */
export function tintaPara(fundo: string): '#FFFFFF' | '#111117' {
    return contraste(fundo, '#FFFFFF') >= contraste(fundo, '#111117') ? '#FFFFFF' : '#111117'
}

export interface AvisoDoTema {
    campo: string
    texto: string
}

/**
 * O que está ruim no tema, sem impedir de salvar.
 *
 * Avisar e deixar passar é deliberado: a cor é da marca do cliente, e um
 * bloqueio faria a pessoa escolher a segunda cor preferida dela em vez de a
 * primeira — resolvendo o nosso desconforto e não o problema dela.
 */
export function avisosDoTema(tema: Tema): AvisoDoTema[] {
    const avisos: AvisoDoTema[] = []

    if (tema.corDeDestaque !== undefined) {
        const tinta = tema.corSobreDestaque ?? tintaPara(tema.corDeDestaque)
        const razao = contraste(tema.corDeDestaque, tinta)

        if (razao < CONTRASTE_MINIMO) {
            avisos.push({
                campo: 'corDeDestaque',
                texto:
                    `O contraste entre o botão e o texto dele é ${razao}:1, abaixo de ` +
                    `${CONTRASTE_MINIMO}:1. Quem tem baixa visão não vai ler o botão de suporte.`,
            })
        }
    }

    if (tema.atendente.avatar !== undefined && !tema.atendente.avatar.startsWith('https://')) {
        avisos.push({
            campo: 'atendente.avatar',
            texto: 'Use um endereço https: o app é servido por https e a imagem seria bloqueada.',
        })
    }

    return avisos
}

/**
 * As variáveis CSS que o widget aplica.
 *
 * Só as que foram escolhidas entram. As demais ficam ausentes de propósito: o
 * CSS do widget já tem `var(--primary, queda)` para cada uma, então ausência
 * significa "herde do app", que é o comportamento certo para quem não
 * configurou nada.
 */
export function variaveisDoTema(tema: Tema): Record<string, string> {
    const variaveis: Record<string, string> = {}

    if (tema.corDeDestaque !== undefined) {
        variaveis['--vd-destaque'] = tema.corDeDestaque
        variaveis['--vd-destaque-tinta'] = tema.corSobreDestaque ?? tintaPara(tema.corDeDestaque)
    }

    variaveis['--vd-margem'] = `${tema.margem}px`

    return variaveis
}
