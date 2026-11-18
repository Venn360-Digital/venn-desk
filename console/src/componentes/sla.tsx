import type { ResumoDeSla } from '../api.ts'

/**
 * O prazo numa linha de fila.
 *
 * Mostra ESTADO e quanto falta, nessa ordem, porque é assim que a pergunta é
 * feita: "tem algo estourando?" vem antes de "quando". O relógio pausado
 * aparece em cinza e sem contagem — ele não está andando, e um número ali
 * sugeriria que está.
 */

/// Os pares vêm da marca; ver o comentário em `ui.tsx`.
const CORES: Record<ResumoDeSla['estado'], string> = {
    violado: 'bg-urgente-fundo text-urgente',
    vencido: 'bg-urgente-fundo text-urgente',
    em_risco: 'bg-atencao-fundo text-atencao',
    em_dia: 'bg-calmo-fundo text-calmo',
    pausado: 'bg-superficie-3 text-tinta-fraca',
    cumprido: 'bg-superficie-3 text-tinta-fraca',
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

/**
 * Acima de dois dias a contagem vira DIAS.
 *
 * "há 104 h 59 min" é tecnicamente certo e ilegível: ninguém converte isso de
 * cabeça, e a fila é lida de relance. Abaixo de uma hora, minutos; abaixo de
 * dois dias, horas; daí em diante, dias.
 */
function falta(iso: string): string {
    const ms = new Date(iso).getTime() - Date.now()
    const min = Math.round(Math.abs(ms) / 60_000)

    let texto: string
    if (min < 60) texto = `${min} min`
    else if (min < 48 * 60) {
        const h = Math.floor(min / 60)
        const resto = min % 60
        texto = resto === 0 ? `${h} h` : `${h} h ${resto} min`
    } else {
        const d = Math.floor(min / (24 * 60))
        const h = Math.round((min % (24 * 60)) / 60)
        texto = h === 0 ? `${d} dias` : `${d} d ${h} h`
    }

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
