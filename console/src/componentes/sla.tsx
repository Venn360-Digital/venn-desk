import type { ResumoDeSla } from '../api.ts'

/**
 * O prazo numa linha de fila.
 *
 * Mostra ESTADO e quanto falta, nessa ordem, porque é assim que a pergunta é
 * feita: "tem algo estourando?" vem antes de "quando". O relógio pausado
 * aparece em cinza e sem contagem — ele não está andando, e um número ali
 * sugeriria que está.
 */

const CORES: Record<ResumoDeSla['estado'], string> = {
    violado: 'bg-urgente/10 text-urgente',
    vencido: 'bg-urgente/10 text-urgente',
    em_risco: 'bg-atencao/15 text-atencao',
    em_dia: 'bg-calmo/15 text-calmo',
    pausado: 'bg-tinta/5 text-tinta-fraca',
    cumprido: 'bg-tinta/5 text-tinta-fraca',
}

const ROTULOS: Record<ResumoDeSla['estado'], string> = {
    violado: 'estourado',
    vencido: 'estourado',
    em_risco: 'em risco',
    em_dia: 'em dia',
    pausado: 'pausado',
    cumprido: 'cumprido',
}

const METAS: Record<ResumoDeSla['meta'], string> = {
    primeira_resposta: '1ª resposta',
    proxima_resposta: 'próxima resposta',
    resolucao: 'resolução',
}

function falta(iso: string): string {
    const ms = new Date(iso).getTime() - Date.now()
    const min = Math.round(Math.abs(ms) / 60_000)
    const texto = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
    return ms >= 0 ? `faltam ${texto}` : `há ${texto}`
}

export function SeloDeSla({ sla }: { sla: ResumoDeSla | null }) {
    if (sla === null) return <span className="text-xs text-tinta-fraca">—</span>

    const mostraContagem = sla.estado !== 'pausado' && sla.estado !== 'cumprido'

    return (
        <span className="inline-flex items-center gap-1.5" title={`${METAS[sla.meta]} · ${new Date(sla.venceEm).toLocaleString('pt-BR')}`}>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CORES[sla.estado]}`}>
                {ROTULOS[sla.estado]}
            </span>
            {mostraContagem ? (
                <span className="text-[11px] text-tinta-fraca">{falta(sla.venceEm)}</span>
            ) : null}
        </span>
    )
}
