import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { api, type AppCadastrado, type MetaDeSla } from '../api.ts'
import { Aviso, Botao, Selo, Vazio } from '../componentes/ui.tsx'

/**
 * As metas de SLA do app, por prioridade (seção 5).
 *
 * **O padrão aparece como padrão.** Onde o app não cadastrou política, a tela
 * mostra os minutos embutidos e diz que são embutidos. Esconder isso faria o
 * gestor achar que escolheu o que apenas herdou — e a primeira vez que ele
 * descobrisse seria num chamado violado.
 *
 * **Salvar não mexe em relógio que já está correndo.** A política vale do
 * próximo chamado em diante. Encurtar a meta e aplicar ao que já existe
 * violaria chamados retroativamente, por uma decisão tomada depois deles.
 */

const ROTULOS: Record<MetaDeSla['prioridade'], string> = {
    URGENTE: 'Urgente',
    ALTA: 'Alta',
    NORMAL: 'Normal',
    BAIXA: 'Baixa',
}

/** Minutos viram "4 h" ou "3 d" na leitura; a edição continua em minutos. */
function emPalavras(min: number): string {
    if (min < 60) return `${min} min`
    if (min < 60 * 24) {
        const h = Math.floor(min / 60)
        const resto = min % 60
        return resto === 0 ? `${h} h` : `${h} h ${resto} min`
    }
    const d = Math.floor(min / (60 * 24))
    const h = Math.round((min % (60 * 24)) / 60)
    return h === 0 ? `${d} d` : `${d} d ${h} h`
}

export function Sla({ papel }: { papel: 'AGENTE' | 'GESTOR' | 'ADMIN' }) {
    const { app: daRota } = useParams<{ app: string }>()
    const fila = useQueryClient()

    /**
     * As metas são POR APP, e a fila deixou de ser. Como não há mais um app
     * "atual" na navegação, a escolha mora aqui dentro — e cai no primeiro
     * quando a rota não traz nenhum, para `/metas` nunca ser uma tela vazia
     * pedindo um clique antes de mostrar qualquer coisa.
     */
    const { data: cadastro } = useQuery({
        queryKey: ['apps'],
        queryFn: () => api<{ apps: AppCadastrado[] }>('/apps'),
        staleTime: 5 * 60_000,
    })
    const apps = cadastro?.apps ?? []
    const app = daRota ?? apps[0]?.slug
    const [editando, setEditando] = useState<MetaDeSla['prioridade'] | null>(null)
    const [erro, setErro] = useState<string | null>(null)

    const { data, isPending } = useQuery({
        queryKey: ['sla', app],
        queryFn: () => api<{ prioridades: MetaDeSla[] }>(`/app/${app}/sla`),
        enabled: app !== undefined,
    })

    const salvar = useMutation({
        mutationFn: (v: MetaDeSla) =>
            api(`/app/${app}/sla/${v.prioridade}`, {
                metodo: 'PUT',
                corpo: {
                    primeiraRespostaMin: v.primeiraRespostaMin,
                    proximaRespostaMin: v.proximaRespostaMin,
                    resolucaoMin: v.resolucaoMin,
                },
            }),
        onSuccess: () => {
            setEditando(null)
            setErro(null)
            void fila.invalidateQueries({ queryKey: ['sla', app] })
        },
        onError: (e: Error) => setErro(e.message),
    })

    if (isPending) return <Vazio>carregando…</Vazio>
    const prioridades = data?.prioridades ?? []
    const podeEditar = papel !== 'AGENTE'

    return (
        <div className="space-y-4">
            <nav className="flex flex-wrap gap-1">
                {apps.map((a) => (
                    <Link
                        key={a.slug}
                        to={`/metas/${a.slug}`}
                        className={
                            a.slug === app
                                ? 'rounded-sm bg-tinta px-3 py-1.5 text-xs font-medium text-fundo'
                                : 'rounded-sm border border-borda bg-superficie px-3 py-1.5 text-xs text-tinta-fraca transition hover:text-tinta'
                        }
                    >
                        {a.nome}
                    </Link>
                ))}
            </nav>

            <header>
                <p className="mt-1 text-xs text-tinta-fraca">
                    O relógio pausa enquanto o chamado aguarda o usuário. Em espera na
                    engenharia não pausa: o tempo é nosso. Metas novas valem do próximo
                    chamado em diante.
                </p>
            </header>

            {erro !== null ? <Aviso>{erro}</Aviso> : null}

            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-borda text-left text-xs text-tinta-fraca">
                        <th className="py-2 font-medium">Prioridade</th>
                        <th className="py-2 font-medium">1ª resposta</th>
                        <th className="py-2 font-medium">Próxima resposta</th>
                        <th className="py-2 font-medium">Resolução</th>
                        <th className="py-2 font-medium">Origem</th>
                        {podeEditar ? <th /> : null}
                    </tr>
                </thead>
                <tbody>
                    {prioridades.map((meta) =>
                        editando === meta.prioridade ? (
                            <Edicao
                                key={meta.prioridade}
                                meta={meta}
                                salvando={salvar.isPending}
                                aoCancelar={() => {
                                    setEditando(null)
                                    setErro(null)
                                }}
                                aoSalvar={(novo) => salvar.mutate(novo)}
                            />
                        ) : (
                            <tr key={meta.prioridade} className="border-b border-borda/60">
                                <td className="py-2">
                                    <Selo>{meta.prioridade}</Selo>
                                </td>
                                <td className="py-2">{emPalavras(meta.primeiraRespostaMin)}</td>
                                <td className="py-2">{emPalavras(meta.proximaRespostaMin)}</td>
                                <td className="py-2">{emPalavras(meta.resolucaoMin)}</td>
                                <td className="py-2 text-xs text-tinta-fraca">
                                    {meta.propria ? 'deste app' : 'padrão embutido'}
                                </td>
                                {podeEditar ? (
                                    <td className="py-2 text-right">
                                        <button
                                            onClick={() => setEditando(meta.prioridade)}
                                            className="text-xs text-destaque hover:underline"
                                        >
                                            editar
                                        </button>
                                    </td>
                                ) : null}
                            </tr>
                        )
                    )}
                </tbody>
            </table>

            {podeEditar ? null : (
                <p className="text-xs text-tinta-fraca">
                    Só gestor ou admin altera metas. {ROTULOS.URGENTE} é a mais apertada.
                </p>
            )}
        </div>
    )
}

function Edicao({
    meta,
    salvando,
    aoCancelar,
    aoSalvar,
}: {
    meta: MetaDeSla
    salvando: boolean
    aoCancelar: () => void
    aoSalvar: (meta: MetaDeSla) => void
}) {
    const [valores, setValores] = useState(meta)

    const campo = (chave: 'primeiraRespostaMin' | 'proximaRespostaMin' | 'resolucaoMin') => (
        <td className="py-2">
            <input
                type="number"
                min={1}
                value={valores[chave]}
                onChange={(e) => setValores({ ...valores, [chave]: Number(e.target.value) })}
                className="w-24 rounded border border-borda px-2 py-1 text-sm"
            />
            <span className="ml-1 text-[11px] text-tinta-fraca">min</span>
        </td>
    )

    return (
        <tr className="border-b border-borda/60 bg-white">
            <td className="py-2">
                <Selo>{meta.prioridade}</Selo>
            </td>
            {campo('primeiraRespostaMin')}
            {campo('proximaRespostaMin')}
            {campo('resolucaoMin')}
            <td className="py-2 text-xs text-tinta-fraca">editando</td>
            <td className="py-2">
                <div className="flex justify-end gap-2">
                    <Botao variante="leve" onClick={aoCancelar}>
                        cancelar
                    </Botao>
                    <Botao onClick={() => aoSalvar(valores)} desabilitado={salvando}>
                        {salvando ? 'salvando…' : 'salvar'}
                    </Botao>
                </div>
            </td>
        </tr>
    )
}
