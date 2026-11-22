import { describe, expect, it } from 'vitest'

import { alertarNoSlack, alertasDaRodada } from './alertar.ts'

describe('alertasDaRodada', () => {
    it('só o que MUDOU na saúde vira alerta', () => {
        /**
         * O cron roda a cada minuto. Postar "tudo bem" 1.440 vezes por dia é o
         * jeito mais eficiente de ninguém notar o dia em que não estava.
         */
        const alertas = alertasDaRodada({
            saude: [
                { slug: 'odontobox', mudanca: null, detalhe: 'ok' },
                { slug: 'conecta', mudanca: 'caiu', detalhe: 'HTTP 502' },
                { slug: 'stagent', mudanca: 'voltou', detalhe: 'ok' },
            ],
            prazos: [],
        })

        expect(alertas).toHaveLength(2)
        expect(alertas[0]).toMatchObject({ gravidade: 'caiu', app: 'conecta' })
        expect(alertas[0]?.resumo).toContain('502')
        expect(alertas[1]).toMatchObject({ gravidade: 'voltou', app: 'stagent' })
    })

    it('o estouro de prazo leva o número do chamado e o link', () => {
        /// Sem o número, quem está de plantão teria de procurar qual chamado é.
        const alertas = alertasDaRodada({
            saude: [],
            prazos: [{ slug: 'odontobox', ticketId: 'tkt-1', meta: 'primeira_resposta', caoDeGuarda: false }],
            numeroDoChamado: () => 'ODB-1042',
            urlBase: 'https://desk.venn360.com',
        })

        expect(alertas[0]).toMatchObject({ gravidade: 'sla', numero: 'ODB-1042' })
        expect(alertas[0]?.resumo).toBe('prazo de primeira resposta estourado')
        expect(alertas[0]?.urlNoConsole).toBe('https://desk.venn360.com/app/odontobox/chamados/1042')
    })

    it('o cão de guarda é outro alerta, com outro texto', () => {
        const alertas = alertasDaRodada({
            saude: [],
            prazos: [{ slug: 'conecta', ticketId: 'tkt-2', meta: 'primeira_resposta', caoDeGuarda: true }],
        })
        expect(alertas[0]?.gravidade).toBe('cao-de-guarda')
        expect(alertas[0]?.resumo).toContain('devolvido à fila')
    })
})

describe('alertarNoSlack', () => {
    function slackFalso(resposta: Record<string, unknown> = { ok: true, ts: '1', channel: 'C1' }) {
        const chamadas: unknown[] = []
        const buscador = (async (_url: string, init?: { body?: string }) => {
            chamadas.push(JSON.parse(init?.body ?? '{}'))
            return new Response(JSON.stringify(resposta), { headers: { 'content-type': 'application/json' } })
        }) as unknown as typeof fetch
        return { chamadas, buscador }
    }

    const ALERTA = { gravidade: 'caiu' as const, app: 'conecta', resumo: 'fora do ar' }

    it('sem canal configurado não chama o Slack', async () => {
        /// É o estado inicial de todo ambiente, e não é defeito: o e-mail
        /// continua sendo o aviso enquanto o canal não existir.
        expect(await alertarNoSlack({ SLACK_BOT_TOKEN: 'xoxb-t' }, [ALERTA])).toEqual({ postados: 0 })
    })

    it('lista vazia não chama o Slack', async () => {
        expect(await alertarNoSlack({ SLACK_CANAL_DE_ALERTAS: 'C-ALERTAS' }, [])).toEqual({ postados: 0 })
    })

    it('posta uma mensagem por alerta, no canal único dos três apps', async () => {
        const { chamadas, buscador } = slackFalso()

        const r = await alertarNoSlack(
            { SLACK_BOT_TOKEN: 'xoxb-t', SLACK_CANAL_DE_ALERTAS: 'C-ALERTAS' },
            [ALERTA, { ...ALERTA, app: 'stagent', gravidade: 'voltou' }],
            buscador
        )

        expect(r).toEqual({ postados: 2 })
        expect(chamadas).toHaveLength(2)
        const primeira = chamadas[0] as { channel: string; text: string }
        expect(primeira.channel).toBe('C-ALERTAS')
        /// Sinal na frente: o canal é lido de relance no celular, e precisar
        /// abrir a mensagem para saber se é grave é a mensagem falhando.
        expect(primeira.text.startsWith('🔴')).toBe(true)
        expect(primeira.text).toContain('conecta')
        expect((chamadas[1] as { text: string }).text.startsWith('🟢')).toBe(true)
    })

    it('uma falha do Slack não impede os alertas seguintes', async () => {
        /// Plantão perde o aviso do app B porque o do app A falhou? Não.
        let primeira = true
        const buscador = (async () => {
            const corpo = primeira ? { ok: false, error: 'channel_not_found' } : { ok: true, ts: '1', channel: 'C1' }
            primeira = false
            return new Response(JSON.stringify(corpo), { headers: { 'content-type': 'application/json' } })
        }) as unknown as typeof fetch

        const r = await alertarNoSlack(
            { SLACK_BOT_TOKEN: 'xoxb-t', SLACK_CANAL_DE_ALERTAS: 'C-ALERTAS' },
            [ALERTA, { ...ALERTA, app: 'stagent' }],
            buscador
        )
        expect(r).toEqual({ postados: 1 })
    })
})

describe('alertasDaRodada com riscos', () => {
    it('o alerta de risco diz quanto FALTA, não quanto passou', () => {
        /**
         * O aviso de risco existe para alguém agir, e "faltam 6 minutos" é a
         * informação que leva à ação. "Vence às 14h32" obrigaria quem lê a
         * fazer a conta.
         */
        const alertas = alertasDaRodada({
            saude: [],
            prazos: [],
            riscos: [{ slug: 'odontobox', ticketId: 'tkt-1', meta: 'primeira_resposta', faltamMin: 6 }],
            numeroDoChamado: () => 'ODB-1042',
            urlBase: 'https://desk.venn360.com',
        })

        expect(alertas).toHaveLength(1)
        expect(alertas[0]).toMatchObject({ gravidade: 'sla', numero: 'ODB-1042' })
        expect(alertas[0]?.resumo).toBe('prazo de primeira resposta vence em 6 min')
        expect(alertas[0]?.urlNoConsole).toContain('/chamados/1042')
    })

    it('risco e violação do mesmo app convivem, com textos diferentes', () => {
        const alertas = alertasDaRodada({
            saude: [],
            prazos: [{ slug: 'conecta', ticketId: 'a', meta: 'resolucao', caoDeGuarda: false }],
            riscos: [{ slug: 'conecta', ticketId: 'b', meta: 'resolucao', faltamMin: 20 }],
        })

        expect(alertas.map((a) => a.resumo)).toEqual([
            'prazo de resolucao estourado',
            'prazo de resolucao vence em 20 min',
        ])
    })
})
