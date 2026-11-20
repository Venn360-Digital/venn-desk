/**
 * Recalcula o DESFECHO esperado dos casos já gerados, sem chamar modelo.
 *
 * Existe porque a regra de desfecho mudou depois da geração (20/11/2026): a
 * pergunta gerada também decide, não só o artigo de origem. Regerar custaria
 * modelo e trocaria os casos; recalcular mantém a bateria comparável.
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { desfechoPelaPergunta } from '../src/avaliacao/gerar-bateria.ts'

const apps = process.argv.slice(2)
if (apps.length === 0) {
    console.error('uso: node scripts/recalcular-gabaritos.mjs <app> [app...]')
    process.exit(1)
}

for (const app of apps) {
    const caminho = `src/avaliacao/baterias/${app}.json`
    const casos = JSON.parse(readFileSync(caminho, 'utf8'))
    const mudados = []

    for (const caso of casos) {
        const forcado = desfechoPelaPergunta(caso.assunto, caso.mensagem)
        if (forcado === null || caso.gabarito.desfecho === forcado) continue
        if (caso.gabarito.desfecho !== 'respondeu') continue
        mudados.push(`${caso.id}: respondeu → ${forcado}`)
        caso.gabarito = { desfecho: forcado, artigoEsperado: caso.gabarito.artigoEsperado }
    }

    writeFileSync(caminho, `${JSON.stringify(casos, null, 4)}\n`)
    console.log(`${app}: ${mudados.length} de ${casos.length} gabaritos corrigidos`)
    for (const m of mudados) console.log(`  ${m}`)
}
