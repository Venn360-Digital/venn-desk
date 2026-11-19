/**
 * O estado que a página de status publica — com prazo de validade.
 *
 * **Por que isto existe.** A página servia `saudavel ? 'operacional' :
 * 'fora_do_ar'` direto do que estava gravado, sem olhar QUANDO foi gravado. Em
 * 19/11/2026 o `urlSaude` dos três apps de produção voltou a nulo por motivo
 * desconhecido, o cron passou a não ter o que sondar, e a página continuou
 * dizendo "operacional" por dezenove horas — mostrando o retrato da noite
 * anterior como se fosse de agora.
 *
 * Isso é pior que não ter monitoramento. Quem abre uma página de status está
 * tentando decidir se o problema é dele ou nosso, e uma tela verde desatualizada
 * responde com confiança a pergunta errada. Ninguém desconfia de verde.
 *
 * A regra é simples e não depende de saber por que parou: se a última
 * verificação é velha demais, o estado é DESCONHECIDO — não "operacional", não
 * "fora do ar". Dizer "não sei" é informação; dizer "está tudo bem" sem saber é
 * o contrário dela.
 */

/**
 * Quanto tempo um veredito vale.
 *
 * O cron sonda a cada minuto, então dez minutos são dez sondagens perdidas —
 * folga suficiente para uma publicação do Worker, uma janela de manutenção da
 * plataforma ou um minuto que não rodou, e curta o bastante para ninguém tomar
 * decisão com dado de ontem.
 */
export const VALIDADE_MS = 10 * 60 * 1000

export type EstadoPublico = 'operacional' | 'fora_do_ar' | 'desconhecido'

export function estadoPublico(
    estado: { saudavel: boolean; verificadoEm: Date } | null,
    agora: Date
): EstadoPublico {
    /// Nunca verificado e verificado há muito tempo são a MESMA resposta para
    /// quem lê: não sabemos. A diferença entre os dois é problema nosso.
    if (estado === null) return 'desconhecido'
    if (agora.getTime() - estado.verificadoEm.getTime() > VALIDADE_MS) return 'desconhecido'

    return estado.saudavel ? 'operacional' : 'fora_do_ar'
}
