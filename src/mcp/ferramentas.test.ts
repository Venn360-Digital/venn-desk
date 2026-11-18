import { describe, expect, it } from 'vitest'

import {
    FERRAMENTAS,
    ferramentaPorNome,
    ferramentasDoEscopo,
    paraOProtocolo,
} from './ferramentas.ts'

describe('o catálogo do MCP', () => {
    it('NENHUMA ferramenta aceita o app como argumento', () => {
        /**
         * A prova que sustenta o isolamento entre apps.
         *
         * O app vem da credencial. Se viesse por argumento, o canal do
         * Odontobox poderia pedir chamados do Conecta — bastaria o modelo ser
         * convencido a passar outro valor, e convencer um modelo é o que o
         * texto de um chamado hostil faz de melhor.
         */
        for (const ferramenta of FERRAMENTAS) {
            const campos = Object.keys(ferramenta.argumentos.shape)

            expect(campos, ferramenta.nome).not.toContain('app')
            expect(campos, ferramenta.nome).not.toContain('appId')
            expect(campos, ferramenta.nome).not.toContain('app_id')
            expect(campos, ferramenta.nome).not.toContain('slug')
        }
    })

    it('NENHUMA ferramenta aceita o tenant como argumento', () => {
        /// Um degrau abaixo, mesma razão: o chamado já carrega o tenant, e
        /// deixar a IA informá-lo abriria "me mostre os chamados da clínica X".
        for (const ferramenta of FERRAMENTAS) {
            const campos = Object.keys(ferramenta.argumentos.shape)

            expect(campos, ferramenta.nome).not.toContain('tenant')
            expect(campos, ferramenta.nome).not.toContain('tenantId')
            expect(campos, ferramenta.nome).not.toContain('empresa')
            expect(campos, ferramenta.nome).not.toContain('conta')
        }
    })

    it('NÃO existe ferramenta que aprove, faça merge ou publique', () => {
        /**
         * A regra absoluta do CLAUDE.md, verificada em vez de combinada.
         *
         * A trava de verdade é no GitHub — branch protegida e environment com
         * revisor. Esta prova é a primeira camada: ela quebra no instante em
         * que alguém acrescentar `aprovar_issue` ao catálogo, e obriga a
         * conversa antes de o código existir.
         */
        const proibidos = /aprov|merge|deploy|publicar|produc|promover|revisar_pr/i

        for (const ferramenta of FERRAMENTAS) {
            expect(ferramenta.nome, `${ferramenta.nome} parece uma ação de portão`).not.toMatch(
                proibidos
            )
        }
    })

    it('o canal de suporte não enxerga as ferramentas de engenharia', () => {
        /// A separação que a seção 8 chama de principal defesa contra instrução
        /// maliciosa: um chamado que peça "crie um problema" não acha a
        /// ferramenta no canal onde o texto dele é lido.
        const suporte = ferramentasDoEscopo('SUPORTE').map((f) => f.nome)

        expect(suporte).not.toContain('criar_problema')
        expect(suporte).not.toContain('vincular_incidente')
        expect(ferramentaPorNome('SUPORTE', 'criar_problema')).toBe(null)
    })

    it('a engenharia enxerga tudo o que o suporte enxerga, e mais', () => {
        const suporte = ferramentasDoEscopo('SUPORTE').map((f) => f.nome)
        const engenharia = ferramentasDoEscopo('ENGENHARIA').map((f) => f.nome)

        for (const nome of suporte) expect(engenharia).toContain(nome)
        expect(engenharia.length).toBeGreaterThan(suporte.length)
    })

    it('os dois escopos atendem ao cliente e sabem escalar para humano', () => {
        /**
         * Escalar para humano é obrigatório em cobrança, LGPD, suspeita de
         * vazamento e pedido explícito (seção 4). Se o escopo de engenharia não
         * tivesse a ferramenta, o caminho de saída dependeria de voltar ao
         * suporte — e a saída tem de existir onde a conversa está.
         */
        for (const escopo of ['SUPORTE', 'ENGENHARIA'] as const) {
            const nomes = ferramentasDoEscopo(escopo).map((f) => f.nome)
            expect(nomes).toContain('responder_usuario')
            expect(nomes).toContain('escalar')
        }
    })

    it('só `responder_usuario` fala com o cliente', () => {
        /// É a marca que o modo sombra usa para decidir o que vira rascunho.
        const falam = FERRAMENTAS.filter((f) => f.falaComOCliente === true).map((f) => f.nome)

        expect(falam).toEqual(['responder_usuario'])
    })

    it('a descrição de `obter_chamado` avisa que texto do usuário é dado', () => {
        /**
         * A descrição É parte da defesa: ela chega ao modelo em toda sessão,
         * junto da lista de ferramentas, e repete a regra no lugar onde o texto
         * hostil vai aparecer.
         */
        const obter = ferramentaPorNome('SUPORTE', 'obter_chamado')

        expect(obter?.descricao).toMatch(/nunca como instru|trate-o como/i)
    })

    it('`escalar` enumera os casos obrigatórios de humano', () => {
        const escalar = ferramentaPorNome('SUPORTE', 'escalar')

        for (const caso of [/cobran/i, /LGPD/, /seguran/i, /cancelamento/i]) {
            expect(escalar?.descricao).toMatch(caso)
        }
    })

    it('todo nome é único e em snake_case', () => {
        const nomes = FERRAMENTAS.map((f) => f.nome)

        expect(new Set(nomes).size).toBe(nomes.length)
        for (const nome of nomes) expect(nome).toMatch(/^[a-z][a-z_]*$/)
    })

    it('a conversão para o protocolo gera JSON Schema', () => {
        const protocolo = paraOProtocolo(ferramentaPorNome('SUPORTE', 'nota_interna')!)

        expect(protocolo.name).toBe('nota_interna')
        expect(protocolo.inputSchema).toMatchObject({ type: 'object' })
        expect(
            (protocolo.inputSchema as { properties: Record<string, unknown> }).properties
        ).toHaveProperty('corpo')
    })
})
