import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { api, type AppCadastrado, type PainelDoApp } from '../api.ts'
import { Vazio } from '../componentes/ui.tsx'

/**
 * O painel de indicadores (seção 12).
 *
 * **O problema de desenho aqui não é mostrar número — é mostrar a ausência
 * dele.** Por meses a base será pequena, e a maioria dos campos vem nula de
 * propósito: o servidor se recusa a calcular mediana com menos de 10 casos e
 * taxa com menos de 5.
 *
 * Então cada indicador diz uma de três coisas, e nunca as confunde:
 *
 *   um número    — há amostra, e ele vale
 *   "— de N"     — há N casos, poucos para medir
 *   "sem dados"  — não houve nem oportunidade
 *
 * Um traço onde deveria haver número é informação; um zero no mesmo lugar é
 * mentira. "0% de resolução pela IA" e "a IA nunca teve um chamado" levam a
 * decisões opostas.
 */

const JANELAS = [7, 30, 90]

export function Painel() {
    const { app: daRota } = useParams<{ app: string }>()
    const [busca, setBusca] = useSearchParams()
    const dias = Number(busca.get('dias')) || 30

    const { data: cadastro } = useQuery({
        queryKey: ['apps'],
        queryFn: () => api<{ apps: AppCadastrado[] }>('/apps'),
        staleTime: 5 * 60_000,
    })
    const apps = cadastro?.apps ?? []
    const app = daRota ?? apps[0]?.slug

    const { data, isPending } = useQuery({
        queryKey: ['painel', app, dias],
        queryFn: () => api<PainelDoApp>(`/app/${app}/painel?dias=${dias}`),
        enabled: app !== undefined,
    })

    if (isPending || data === undefined) return <Vazio>carregando…</Vazio>

    const { relatorio: r, csatDeSempre: csat } = data

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <nav className="flex flex-wrap gap-1">
                    {apps.map((a) => (
                        <Link
                            key={a.slug}
                            to={`/painel/${a.slug}?dias=${dias}`}
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

                <div className="flex gap-1">
                    {JANELAS.map((d) => (
                        <button
                            key={d}
                            type="button"
                            onClick={() => setBusca({ dias: String(d) })}
                            className={
                                d === dias
                                    ? 'rounded-sm border border-destaque px-2.5 py-1 text-xs text-destaque'
                                    : 'rounded-sm border border-borda px-2.5 py-1 text-xs text-tinta-fraca transition hover:text-tinta'
                            }
                        >
                            {d}d
                        </button>
                    ))}
                </div>
            </div>

            {r.chamados === 0 ? (
                <Vazio>
                    Nenhum chamado nos últimos {dias} dias. Os indicadores aparecem conforme
                    o uso real chega.
                </Vazio>
            ) : (
                <>
                    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Numero titulo="Chamados" valor={String(r.chamados)} nota={`em ${dias} dias`} />
                        <Tempo titulo="1ª resposta" d={r.primeiraResposta} />
                        <Tempo titulo="Resolução" d={r.resolucao} />
                        <Proporcao
                            titulo="SLA cumprido"
                            percentual={r.sla.percentual}
                            casos={r.sla.cumpridos + r.sla.violados}
                            nota={`${r.sla.violados} violado(s)`}
                        />
                    </section>

                    <GastoDeIa gasto={data.gastoDeIa} dias={dias} />

                    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Proporcao
                            titulo="Resolvido só pela IA"
                            percentual={r.resolucaoPelaIa.percentual}
                            casos={r.resolucaoPelaIa.deQuantos}
                            nota={`${r.resolucaoPelaIa.casos} de ${r.resolucaoPelaIa.deQuantos} encerrados`}
                        />
                        <Proporcao
                            titulo="Reabertura"
                            percentual={r.reabertura.percentual}
                            casos={r.reabertura.deQuantos}
                            nota={`${r.reabertura.casos} voltaram`}
                            /// Reabrir é ruim: aqui, menos é melhor.
                            invertido
                        />
                        <Numero
                            titulo="Custo da IA no atendimento"
                            valor={`US$ ${r.custo.total.toFixed(2)}`}
                            nota={
                                r.custo.porChamado === null
                                    ? 'a IA não atendeu nenhum'
                                    : `US$ ${r.custo.porChamado.toFixed(3)} por atendimento`
                            }
                        />
                        <Numero
                            titulo="Satisfação"
                            valor={csat.media === null ? '—' : `${csat.media.toFixed(1)} / 5`}
                            nota={
                                csat.respostas === 0
                                    ? 'ninguém avaliou ainda'
                                    : `${csat.respostas} resposta(s), de sempre`
                            }
                        />
                    </section>

                    {csat.respostas > 0 && (
                        <section className="rounded-sm border border-borda bg-superficie p-4">
                            <h2 className="mb-2 text-xs font-medium text-tinta-fraca">
                                Satisfação: IA e humano
                            </h2>
                            <p className="text-xs text-tinta-fraca">
                                {/* A comparação da seção 12 — é dela que sai a decisão de
                                    ligar o atendimento automático. */}
                                IA{' '}
                                <strong className="text-tinta">
                                    {csat.daIa.media?.toFixed(1) ?? '—'}
                                </strong>{' '}
                                ({csat.daIa.respostas}) · humano{' '}
                                <strong className="text-tinta">
                                    {csat.deHumano.media?.toFixed(1) ?? '—'}
                                </strong>{' '}
                                ({csat.deHumano.respostas})
                                {csat.baixas > 0 ? (
                                    <>
                                        {' · '}
                                        <strong className="text-atencao">
                                            {csat.baixas} nota(s) baixa(s)
                                        </strong>{' '}
                                        para revisar
                                    </>
                                ) : null}
                            </p>
                        </section>
                    )}

                    <section className="grid gap-3 lg:grid-cols-3">
                        <Distribuicao titulo="Por tipo" dados={r.porTipo} total={r.chamados} />
                        <Distribuicao
                            titulo="Por prioridade"
                            dados={r.porPrioridade}
                            total={r.chamados}
                        />
                        <Distribuicao titulo="Por status" dados={r.porStatus} total={r.chamados} />
                    </section>
                </>
            )}
        </div>
    )
}

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
        <div className="rounded-sm border border-borda bg-superficie p-4">
            <h2 className="text-xs font-medium text-tinta-fraca">{titulo}</h2>
            {children}
        </div>
    )
}

function Numero({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
    return (
        <Cartao titulo={titulo}>
            <p className="mt-1 text-2xl font-medium text-tinta">{valor}</p>
            <p className="mt-0.5 text-[11px] text-tinta-sutil">{nota}</p>
        </Cartao>
    )
}

/**
 * Um tempo, ou a razão de não haver um.
 *
 * O traço vem acompanhado da contagem — "— de 4 casos" diz que existe medida e
 * que ela é pouca, o que é diferente de não existir nada.
 */
function Tempo({ titulo, d }: { titulo: string; d: { casos: number; mediana: number | null; p90: number | null } }) {
    const duracao = (min: number) =>
        min < 60 ? `${min} min` : min < 1440 ? `${(min / 60).toFixed(1)} h` : `${(min / 1440).toFixed(1)} d`

    return (
        <Cartao titulo={titulo}>
            {d.mediana === null ? (
                <>
                    <p className="mt-1 text-2xl font-medium text-tinta-sutil">—</p>
                    <p className="mt-0.5 text-[11px] text-tinta-sutil">
                        {d.casos === 0
                            ? 'sem dados'
                            : `${d.casos} caso(s): poucos para uma mediana`}
                    </p>
                </>
            ) : (
                <>
                    <p className="mt-1 text-2xl font-medium text-tinta">{duracao(d.mediana)}</p>
                    <p className="mt-0.5 text-[11px] text-tinta-sutil">
                        mediana · p90 {d.p90 === null ? '—' : duracao(d.p90)} · {d.casos} casos
                    </p>
                </>
            )}
        </Cartao>
    )
}

function Proporcao({
    titulo,
    percentual,
    casos,
    nota,
    invertido,
}: {
    titulo: string
    percentual: number | null
    casos: number
    nota: string
    invertido?: boolean
}) {
    /// Cor só quando há número: pintar o traço de verde ou vermelho daria
    /// juízo a uma medição que não existe.
    const cor =
        percentual === null
            ? 'text-tinta-sutil'
            : (invertido ? percentual <= 10 : percentual >= 80)
              ? 'text-calmo'
              : 'text-atencao'

    return (
        <Cartao titulo={titulo}>
            <p className={`mt-1 text-2xl font-medium ${cor}`}>
                {percentual === null ? '—' : `${percentual}%`}
            </p>
            <p className="mt-0.5 text-[11px] text-tinta-sutil">
                {percentual === null && casos > 0
                    ? `${casos} caso(s): poucos para uma taxa`
                    : percentual === null
                      ? 'sem dados'
                      : nota}
            </p>
        </Cartao>
    )
}

function Distribuicao({
    titulo,
    dados,
    total,
}: {
    titulo: string
    dados: Record<string, number>
    total: number
}) {
    const linhas = Object.entries(dados).sort((a, b) => b[1] - a[1])

    return (
        <Cartao titulo={titulo}>
            <ul className="mt-2 space-y-1.5">
                {linhas.map(([rotulo, quantos]) => (
                    <li key={rotulo} className="text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-tinta">
                                {rotulo.toLowerCase().replace(/_/g, ' ')}
                            </span>
                            <span className="text-tinta-fraca">{quantos}</span>
                        </div>
                        {/* A barra é proporção, não enfeite: ela deixa ver de
                            relance que um tipo domina — o que uma coluna de
                            números só entrega depois de somar de cabeça. */}
                        <div className="mt-0.5 h-1 rounded-xs bg-superficie-3">
                            <div
                                className="h-1 rounded-xs bg-destaque"
                                style={{ width: `${(quantos / total) * 100}%` }}
                            />
                        </div>
                    </li>
                ))}
            </ul>
        </Cartao>
    )
}

const ROTULO_DA_ORIGEM: Record<string, string> = {
    atendimento: 'atendimento de chamado',
    tela: 'documentação de tela',
    sincronizacao: 'sincronização da base',
    sugestao: 'rascunho de artigo',
    diagnostico: 'diagnóstico do N2',
    bateria: 'bateria de avaliação',
}

/**
 * O gasto de IA por ORIGEM.
 *
 * Existe por um dia datado: 20/11/2026, US$ 229, e nenhuma tela que respondesse
 * "com o quê". O número do atendimento já estava no painel; o das telas vivia só
 * no log do Worker e o da bateria apenas no terminal de quem a rodou.
 */
function GastoDeIa({
    gasto,
    dias,
}: {
    gasto: PainelDoApp['gastoDeIa']
    dias: number
}) {
    if (gasto.doApp.length === 0 && gasto.semApp.length === 0) {
        return (
            <section className="rounded-sm border border-borda bg-superficie p-4 text-xs text-tinta-fraca">
                Nenhum gasto de IA registrado nos últimos {dias} dias.
            </section>
        )
    }

    const linha = (g: { origem: string; usd: number; chamadas: number }) => (
        <li key={g.origem} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-tinta">{ROTULO_DA_ORIGEM[g.origem] ?? g.origem}</span>
            <span className="tabular-nums text-tinta-fraca">
                US$ {g.usd.toFixed(2)} <span className="text-tinta-sutil">· {g.chamadas} chamada(s)</span>
            </span>
        </li>
    )

    return (
        <section className="space-y-2 rounded-sm border border-borda bg-superficie p-4">
            <h2 className="flex items-baseline justify-between gap-3 text-xs font-medium text-tinta">
                <span>Gasto de IA por origem · {dias} dias</span>
                <span className="tabular-nums text-tinta-fraca">US$ {gasto.totalDoApp.toFixed(2)}</span>
            </h2>
            <ul className="space-y-1">{gasto.doApp.map(linha)}</ul>
            {gasto.semApp.length > 0 ? (
                <>
                    <p className="pt-1 text-[11px] text-tinta-sutil">
                        Sem app: trabalho da plataforma, que não entra no custo deste produto.
                    </p>
                    <ul className="space-y-1">{gasto.semApp.map(linha)}</ul>
                </>
            ) : null}
        </section>
    )
}
