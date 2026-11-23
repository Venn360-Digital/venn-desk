import { describe, expect, it } from 'vitest'

import { APP_DO_WORKERS_BUILDS, avanca, chamadoNaReferencia, etapaParaOCliente, lerEvento } from './engenharia.ts'

describe('avanca', () => {
    it('só adiante, porque o GitHub entrega fora de ordem', () => {
        /**
         * O defeito que isto impede: o check de um push antigo chega depois do
         * deploy, ou o GitHub reentrega o "PR aberto" de ontem. Sem comparar, o
         * cliente veria o chamado regredir de "em teste" para "em revisão".
         */
        expect(avanca('TRIADO', 'PR_ABERTO')).toBe(true)
        expect(avanca('EM_STAGING', 'PR_ABERTO')).toBe(false)
        expect(avanca('PR_ABERTO', 'PR_ABERTO')).toBe(false)
    })

    it('recusa do gestor é final: dela não se sai por evento do GitHub', () => {
        expect(avanca('RECUSADO_PELO_GESTOR', 'EM_CORRECAO')).toBe(false)
        expect(avanca('PR_ABERTO', 'RECUSADO_PELO_GESTOR')).toBe(false)
    })
})

describe('chamadoNaReferencia', () => {
    it('acha o chamado no nome da branch, no título e no corpo', () => {
        expect(chamadoNaReferencia('desk/ODB-1042')).toEqual({ prefixo: 'ODB', numero: 1042 })
        expect(chamadoNaReferencia('fix: agenda recorrente (CNC-77)')).toEqual({ prefixo: 'CNC', numero: 77 })
        expect(chamadoNaReferencia('Venn Desk: stg-5\nqualquer coisa')).toEqual({ prefixo: 'STG', numero: 5 })
    })

    it('número solto não serve', () => {
        /// Todo evento do GitHub tem números: PR 31, run 889, issue 4. Sem o
        /// prefixo do app, qualquer um deles viraria um chamado.
        expect(chamadoNaReferencia('merge pull request #31 from main')).toBe(null)
        expect(chamadoNaReferencia('1042')).toBe(null)
    })
})

describe('lerEvento', () => {
    it('issue aberta e PR aberto andam; PR fechado sem mesclar não', () => {
        expect(lerEvento({ tipo: 'issues', acao: 'opened' })).toMatchObject({ etapa: 'ISSUE_CRIADA', link: 'ISSUE' })
        expect(lerEvento({ tipo: 'pull_request', acao: 'opened' })).toMatchObject({ etapa: 'PR_ABERTO', link: 'PR' })
        /// A correção foi abandonada. Quem decide o que fazer com o chamado é
        /// uma pessoa, não o webhook.
        expect(lerEvento({ tipo: 'pull_request', acao: 'closed', mesclado: false }).etapa).toBe(null)
        expect(lerEvento({ tipo: 'pull_request', acao: 'closed', mesclado: true }).etapa).toBe('EM_STAGING')
    })

    it('check run do Workers Builds que passou É o deploy', () => {
        /**
         * Defeito encontrado em 23/11/2026, por uma pergunta sobre centralizar
         * na Cloudflare: o Workers Builds NÃO emite `deployment_status`. Ele
         * reporta ao GitHub por check run, e como é ele que publica os apps, o
         * Desk esperava um evento que nunca chega — a etapa ficaria parada em
         * "PR aberto" para sempre.
         *
         * A branch diz o ambiente: `main` publica produção, qualquer outra cria
         * uma Preview, que é a homologação daquele commit.
         */
        const producao = lerEvento({
            tipo: 'check_run',
            acao: 'completed',
            conclusao: 'success',
            appDaVerificacao: APP_DO_WORKERS_BUILDS,
            branch: 'main',
        })
        expect(producao).toMatchObject({ etapa: 'EM_PRODUCAO', link: 'DEPLOY' })

        const homologacao = lerEvento({
            tipo: 'check_run',
            acao: 'completed',
            conclusao: 'success',
            appDaVerificacao: APP_DO_WORKERS_BUILDS,
            branch: 'desk/ODB-1042',
        })
        expect(homologacao).toMatchObject({ etapa: 'EM_STAGING', link: 'DEPLOY' })
    })

    it('verificação de OUTRO app não é deploy', () => {
        /// Um lint que passa não publicou nada. Sem distinguir o app, qualquer
        /// check verde moveria o chamado para "publicado".
        const lint = lerEvento({
            tipo: 'check_run',
            acao: 'completed',
            conclusao: 'success',
            appDaVerificacao: 'algum-linter',
            branch: 'main',
        })
        expect(lint).toMatchObject({ etapa: null, link: 'RUN' })
    })

    it('check run do Workers Builds que FALHOU não publica nada', () => {
        const falhou = lerEvento({
            tipo: 'check_run',
            acao: 'completed',
            conclusao: 'failure',
            appDaVerificacao: APP_DO_WORKERS_BUILDS,
            branch: 'main',
        })
        expect(falhou.etapa).toBe(null)
        expect(falhou.resumo).toContain('falhou')
    })

    it('verificação que FALHOU é informação, não passo adiante', () => {
        /**
         * Confundir as duas coisas faria o cliente ver "em teste no ambiente de
         * homologação" quando o teste reprovou.
         */
        const falhou = lerEvento({ tipo: 'check_suite', acao: 'completed', conclusao: 'failure' })
        expect(falhou.etapa).toBe(null)
        expect(falhou.link).toBe('RUN')
        expect(falhou.resumo).toContain('falhou')

        const passou = lerEvento({ tipo: 'check_suite', acao: 'completed', conclusao: 'success' })
        expect(passou.etapa).toBe(null)
        expect(passou.resumo).toContain('passaram')
    })

    it('deploy distingue staging de produção, e falha de sucesso', () => {
        expect(lerEvento({ tipo: 'deployment_status', acao: 'created', conclusao: 'success', ambiente: 'staging' }).etapa).toBe('EM_STAGING')
        expect(lerEvento({ tipo: 'deployment_status', acao: 'created', conclusao: 'success', ambiente: 'producao' }).etapa).toBe('EM_PRODUCAO')
        expect(lerEvento({ tipo: 'deployment_status', acao: 'created', conclusao: 'failure', ambiente: 'staging' }).etapa).toBe(null)
    })

    it('evento desconhecido não move nada e diz o nome', () => {
        const r = lerEvento({ tipo: 'star', acao: 'created' })
        expect(r).toMatchObject({ etapa: null, link: null })
        expect(r.resumo).toContain('star')
    })
})

describe('etapaParaOCliente', () => {
    it('fala de produto, sem jargão e sem prazo', () => {
        expect(etapaParaOCliente('PR_ABERTO')).toBe('correção escrita, em revisão')
        expect(etapaParaOCliente('EM_STAGING')).toContain('homologação')
        /// Nenhuma etapa promete data.
        for (const texto of ['TRIADO', 'EM_PRODUCAO', 'VERIFICADO'] as const) {
            expect(etapaParaOCliente(texto)).not.toMatch(/\d|prazo|dias|hora/)
        }
    })

    it('recusa do gestor não é contada ao cliente', () => {
        /**
         * Recusa é decisão interna sobre COMO resolver. Contá-la expõe uma
         * discussão nossa sem dar nada em troca — o chamado volta para uma
         * pessoa, que responde.
         */
        expect(etapaParaOCliente('RECUSADO_PELO_GESTOR')).toBe(etapaParaOCliente('TRIADO'))
    })
})
