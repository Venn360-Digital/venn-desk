import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw } from 'lucide-react'

import { api, type EstadoDaSincronizacao, type Sincronizacao as Rodada } from '../api.ts'
import { Aviso, Botao, Quando } from './ui.tsx'

/**
 * O cabeçalho da base viva: onde a sincronização com o repositório está.
 *
 * **O que esta caixa precisa dizer, nesta ordem:** se a base viva está pronta
 * para rodar (e o que falta se não está), quando foi a última rodada e em que
 * commit, o que cada fonte fez, e quanto custou. O botão "Sincronizar agora" é
 * o único ato aqui, e é de gestor.
 *
 * Enquanto uma rodada está em andamento a tela recarrega sozinha a cada dez
 * segundos — uma sincronização leva de segundos a dois minutos, e ninguém
 * deve ficar apertando F5 para saber se acabou.
 */
const ESTADO: Record<Rodada['estado'], { rotulo: string; cor: string }> = {
    pedida: { rotulo: 'na fila', cor: 'text-tinta-fraca' },
    em_andamento: { rotulo: 'sincronizando…', cor: 'text-informe' },
    aguardando_lote: { rotulo: 'aguardando o modelo…', cor: 'text-informe' },
    concluida: { rotulo: 'concluída', cor: 'text-calmo' },
    falhou: { rotulo: 'falhou', cor: 'text-urgente' },
}

const FONTE: Record<string, string> = {
    faq: 'perguntas frequentes',
    menu: 'menu',
    planos: 'planos',
    mapa: 'mapa técnico',
}

const EM_CURSO = new Set<Rodada['estado']>(['pedida', 'em_andamento', 'aguardando_lote'])

export function Sincronizacao({ app, podeEditar }: { app: string; podeEditar: boolean }) {
    const fila = useQueryClient()
    const { data, isPending } = useQuery({
        queryKey: ['base-sincronizacao', app],
        queryFn: () => api<EstadoDaSincronizacao>(`/app/${app}/base-sincronizacao`),
        refetchInterval: (consulta) => {
            const estado = consulta.state.data?.ultima?.estado
            return estado !== undefined && EM_CURSO.has(estado) ? 10_000 : false
        },
    })

    const pedir = useMutation({
        mutationFn: () => api(`/app/${app}/base-sincronizacao`, { metodo: 'POST' }),
        onSuccess: () => {
            void fila.invalidateQueries({ queryKey: ['base-sincronizacao', app] })
            /// A lista de artigos muda quando a rodada termina; o polling acima
            /// vai recarregar este painel, e este efeito recarrega a lista.
            setTimeout(() => void fila.invalidateQueries({ queryKey: ['base', app] }), 15_000)
        },
    })

    if (isPending || data === undefined) return null

    const ultima = data.ultima
    const concluida = data.concluida
    const emCurso = ultima !== null && EM_CURSO.has(ultima.estado)

    return (
        <section className="rounded-sm border border-borda bg-superficie p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                    <h2 className="flex items-center gap-1.5 text-xs font-medium text-tinta-fraca">
                        <RefreshCw size={12} aria-hidden /> Base viva · derivada do repositório
                    </h2>
                    {concluida === null ? (
                        <p className="text-sm text-tinta">Nenhuma sincronização concluída ainda.</p>
                    ) : (
                        <p className="text-sm text-tinta">
                            Sincronizado <Quando iso={concluida.terminadaEm ?? concluida.criadaEm} />{' '}
                            · commit{' '}
                            {data.repositorio !== null ? (
                                <a
                                    href={`https://github.com/${data.repositorio}/commit/${concluida.commit}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-0.5 font-mono text-xs text-destaque hover:underline"
                                >
                                    {concluida.commit.slice(0, 7)} <ExternalLink size={10} aria-hidden />
                                </a>
                            ) : (
                                <span className="font-mono text-xs">{concluida.commit.slice(0, 7)}</span>
                            )}
                            {concluida.resultado?.custoEstimadoUsd !== undefined ? (
                                <span className="text-xs text-tinta-fraca">
                                    {' '}· US$ {concluida.resultado.custoEstimadoUsd.toFixed(3)} de IA
                                </span>
                            ) : null}
                        </p>
                    )}
                    {ultima !== null && ultima.id !== concluida?.id ? (
                        <p className={`text-xs ${ESTADO[ultima.estado].cor}`}>
                            Última rodada: {ESTADO[ultima.estado].rotulo}
                            {ultima.erro !== null ? ` — ${ultima.erro}` : ''}
                        </p>
                    ) : null}
                </div>

                {podeEditar ? (
                    <Botao
                        variante="leve"
                        desabilitado={!data.pronta || emCurso || pedir.isPending}
                        onClick={() => pedir.mutate()}
                    >
                        {emCurso ? 'Sincronizando…' : 'Sincronizar agora'}
                    </Botao>
                ) : null}
            </div>

            {!data.pronta ? (
                <div className="mt-3">
                    <Aviso>
                        A base viva ainda não roda neste app. Falta: {data.faltam.join('; ')}.
                        {data.faltam.some((f) => f.includes('pasta') || f.includes('repositório'))
                            ? ' Cadastre em Apps.'
                            : ''}
                    </Aviso>
                </div>
            ) : null}

            {pedir.isError ? (
                <div className="mt-3">
                    <Aviso>{(pedir.error as Error).message}</Aviso>
                </div>
            ) : null}

            {data.pronta && (data.semModelo || data.semEmbedding) ? (
                <p className="mt-2 text-xs text-atencao">
                    {data.semModelo ? 'Sem chave da Anthropic: menu e planos ficam de fora. ' : ''}
                    {data.semEmbedding ? 'Sem Workers AI: a busca segue só por palavra.' : ''}
                </p>
            ) : null}

            {concluida?.resultado?.fontes !== undefined ? (
                <ul className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    {Object.entries(concluida.resultado.fontes).map(([tipo, f]) => (
                        <li
                            key={tipo}
                            title={f.erro ?? `${f.criados} criados · ${f.atualizados} atualizados · ${f.inalterados} inalterados · ${f.arquivados} arquivados`}
                            className={`rounded-xs px-1.5 py-0.5 ${
                                f.estado === 'falhou'
                                    ? 'bg-urgente-fundo text-urgente'
                                    : f.estado === 'pulada'
                                      ? 'bg-superficie-3 text-tinta-sutil'
                                      : 'bg-calmo-fundo text-calmo'
                            }`}
                        >
                            {FONTE[tipo] ?? tipo}: {f.estado === 'ok' ? `${f.criados + f.atualizados + f.reabertos + f.inalterados}` : f.estado}
                            {f.extraidoPor === 'modelo' ? ' · por IA' : ''}
                        </li>
                    ))}
                    {concluida.resultado.telas !== undefined && !('erro' in concluida.resultado.telas) ? (
                        <li
                            className={`rounded-xs px-1.5 py-0.5 ${
                                concluida.resultado.telas.enfileiradas > 0 ? 'bg-informe-fundo text-informe' : 'bg-calmo-fundo text-calmo'
                            }`}
                            title={`${concluida.resultado.telas.emDia} em dia · ${concluida.resultado.telas.enfileiradas} na fila · ${concluida.resultado.telas.arquivados} arquivadas${concluida.resultado.telas.adiadas > 0 ? ` · ${concluida.resultado.telas.adiadas} adiadas` : ''}`}
                        >
                            telas: {concluida.resultado.telas.emDia}/{concluida.resultado.telas.total}
                            {concluida.resultado.telas.enfileiradas > 0 ? ` · ${concluida.resultado.telas.enfileiradas} documentando…` : ''}
                        </li>
                    ) : concluida.resultado.telas !== undefined ? (
                        <li className="rounded-xs bg-urgente-fundo px-1.5 py-0.5 text-urgente" title={concluida.resultado.telas.erro}>
                            telas: falhou
                        </li>
                    ) : null}
                    {concluida.resultado.mapa !== undefined && !('erro' in concluida.resultado.mapa) ? (
                        <li className="rounded-xs bg-calmo-fundo px-1.5 py-0.5 text-calmo" title={`${concluida.resultado.mapa.telas} telas · ${concluida.resultado.mapa.apis} APIs`}>
                            mapa técnico: {concluida.resultado.mapa.artigos}
                        </li>
                    ) : concluida.resultado.mapa !== undefined ? (
                        <li className="rounded-xs bg-urgente-fundo px-1.5 py-0.5 text-urgente" title={concluida.resultado.mapa.erro}>
                            mapa técnico: falhou
                        </li>
                    ) : null}
                </ul>
            ) : null}

            {concluida?.resultado?.avisos !== undefined && concluida.resultado.avisos.length > 0 ? (
                <p className="mt-2 text-[11px] text-tinta-fraca">{concluida.resultado.avisos.join(' · ')}</p>
            ) : null}
        </section>
    )
}
