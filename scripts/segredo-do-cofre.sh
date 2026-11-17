#!/usr/bin/env bash
# Leva UM segredo do cofre para o Worker, sem ele passar por tela nenhuma.
#
#   bash scripts/segredo-do-cofre.sh <production|stg> <VARIAVEL>
#
# Ex.: bash scripts/segredo-do-cofre.sh stg SLACK_SIGNING_SECRET
#
# O valor é lido do arquivo do cofre e entregue ao `wrangler secret put` pela
# ENTRADA PADRÃO — nunca como argumento (que apareceria em `ps`), nunca ecoado.
# No fim imprime só tamanho, prefixo e impressão digital, como o cofre faz.
set -uo pipefail

AMB="${1:-}"; VAR="${2:-}"
if [ -z "$VAR" ] || { [ "$AMB" != production ] && [ "$AMB" != stg ]; }; then
  echo "Uso: bash $0 <production|stg> <VARIAVEL>" >&2
  exit 2
fi

ARQ="$HOME/.venn360-secrets/venn-desk/worker-$AMB.env"
[ -f "$ARQ" ] || { echo "ABORTA: $ARQ não existe." >&2; exit 1; }

VALOR="$( set -a; . "$ARQ" >/dev/null 2>&1; set +a; printf '%s' "${!VAR:-}" )"
[ -n "$VALOR" ] || { echo "ABORTA: $VAR não está em ${ARQ##*/} ou está vazia." >&2; exit 1; }

# `--env` do wrangler: o ambiente de produção é um Worker separado.
if [ "$AMB" = production ]; then ALVO=(--env producao); else ALVO=(); fi

printf '%s' "$VALOR" | npx wrangler secret put "$VAR" "${ALVO[@]}" >/dev/null 2>&1
ESTADO=$?

FP=$(printf '%s' "$VALOR" | shasum -a 256 | cut -c1-8)
if [ $ESTADO -eq 0 ]; then
  printf '✓ %s gravada no Worker (%s)\n' "$VAR" "$AMB"
  printf '  %s caracteres, começa com "%s…", fingerprint %s\n' "${#VALOR}" "${VALOR:0:4}" "$FP"
else
  echo "ABORTA: o wrangler recusou. Rode sem o silenciador para ver o motivo." >&2
  exit 1
fi
