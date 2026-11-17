import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { api, type ChamadoNaFila } from '../api.ts'
import { Quando, Selo, Vazio } from '../componentes/ui.tsx'
import { SeloDeSla } from '../componentes/sla.tsx'

type Recorte = 'todos' | 'em_risco' | 'estourado'

const RECORTES: { chave: Recorte; rotulo: string }[] = [
    { chave: 'todos', rotulo: 'Todos em aberto' },
    { chave: 'em_risco', rotulo: 'SLA em risco' },
    { chave: 'estourado', rotulo: 'Prazo estourado' },
]

/**
 * A fila de um app, com o prazo visível e os dois recortes que a seção 5 pede.
 *
 * Visões salvas e recorte por tenant continuam na Fase 7. Estes dois vieram
 * antes porque o dado já existe e ninguém o via: o relógio corria, o cão de
 * guarda marcava, e a tela onde o atendente trabalha não dizia nada.
 *
 * O recorte é feito no SERVIDOR, não aqui: filtrar no cliente mostraria
 * "nenhum chamado em risco" quando o que houve foi a lista vir cortada no
 * limite.
 *
 * A ordem vem do servidor — atualizado mais recente primeiro — porque é a ordem
 * em que um atendente trabalha.
 */
export function Fila() {
    const { app } = useParams<{ app: string }>()
    const [recorte, setRecorte] = useState<Recorte>('todos')

    const { data, isPending, error } = useQuery({
        queryKey: ['fila', app, recorte],
        queryFn: () =>
            api<{ chamados: ChamadoNaFila[] }>(
                `/app/${app}/fila${recorte === 'todos' ? '' : `?sla=${recorte}`}`
            ),
        refetchInterval: 20_000,
    })

    const abas = (
        <div className="mb-4 flex flex-wrap gap-1 text-xs">
            {RECORTES.map(({ chave, rotulo }) => (
                <button
                    key={chave}
                    onClick={() => setRecorte(chave)}
                    className={
                        chave === recorte
                            ? 'rounded-md bg-tinta px-2.5 py-1 font-medium text-white'
                            : 'rounded-md border border-borda bg-white px-2.5 py-1 text-tinta-fraca hover:text-tinta'
                    }
                >
                    {rotulo}
                </button>
            ))}
        </div>
    )

    if (isPending) return <>{abas}<Vazio>carregando…</Vazio></>
    if (error) return <>{abas}<Vazio>{error.message}</Vazio></>

    const chamados = data?.chamados ?? []
    if (chamados.length === 0) {
        return (
            <>
                {abas}
                <Vazio>
                    {recorte === 'todos'
                        ? 'Nenhum chamado em aberto neste app.'
                        : 'Nenhum chamado neste recorte — o que é a resposta boa.'}
                </Vazio>
            </>
        )
    }

    return (
        <>
        {abas}
        <table className="w-full text-sm">
            <thead>
                <tr className="border-b border-borda text-left text-xs text-tinta-fraca">
                    <th className="py-2 font-medium">Número</th>
                    <th className="py-2 font-medium">Assunto</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Prioridade</th>
                    <th className="py-2 font-medium">Nível</th>
                    <th className="py-2 font-medium">Prazo</th>
                    <th className="py-2 font-medium">Atualizado</th>
                </tr>
            </thead>
            <tbody>
                {chamados.map((c) => (
                    <tr key={c.numero} className="border-b border-borda/60 hover:bg-white">
                        <td className="py-2 font-mono text-xs">
                            <Link to={`/app/${app}/chamados/${c.numero.split('-')[1]}`} className="text-destaque hover:underline">
                                {c.numero}
                            </Link>
                        </td>
                        <td className="max-w-md truncate py-2">{c.assunto}</td>
                        <td className="py-2"><Selo>{c.status}</Selo></td>
                        <td className="py-2"><Selo>{c.prioridade}</Selo></td>
                        <td className="py-2 text-xs text-tinta-fraca">{c.nivel}</td>
                        <td className="py-2"><SeloDeSla sla={c.sla} /></td>
                        <td className="py-2"><Quando iso={c.atualizadoEm} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
        </>
    )
}
