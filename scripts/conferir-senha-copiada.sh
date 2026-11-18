#!/usr/bin/env bash
# Confere se o que está na área de transferência é a senha do Console.
#
#   bash scripts/conferir-senha-copiada.sh [stg|production]
#
# Compara impressões digitais (8 hex do sha256). Nenhum dos dois valores é
# impresso — o que se vê é se batem.
set -uo pipefail

AMB="${1:-stg}"
ARQ="$HOME/.venn360-secrets/venn-desk/worker-$AMB.env"
[ -f "$ARQ" ] || { echo "ABORTA: $ARQ não existe." >&2; exit 1; }

DO_COFRE="$( set -a; . "$ARQ" >/dev/null 2>&1; set +a; printf '%s' "${CONSOLE_SENHA_INICIAL:-}" )"
[ -n "$DO_COFRE" ] || { echo "ABORTA: CONSOLE_SENHA_INICIAL vazia em ${ARQ##*/}." >&2; exit 1; }

DA_AREA="$(pbpaste)"

fp() { printf '%s' "$1" | shasum -a 256 | cut -c1-8; }

printf 'cofre............ %s caracteres, fingerprint %s\n' "${#DO_COFRE}" "$(fp "$DO_COFRE")"
printf 'área de transf... %s caracteres, fingerprint %s\n' "${#DA_AREA}" "$(fp "$DA_AREA")"

if [ "$DA_AREA" = "$DO_COFRE" ]; then
  echo "✓ batem — pode colar no campo Senha"
  exit 0
fi

echo "✗ NÃO batem."
case "$DA_AREA" in
  "$DO_COFRE"*|*"$DO_COFRE") echo "  (a área tem a senha com algo a mais em volta — espaço ou quebra de linha)" ;;
  "") echo "  (a área de transferência está vazia — o copiar.sh não rodou)" ;;
  *) echo "  rode: bash ~/.venn360-secrets/copiar.sh venn-desk $AMB CONSOLE_SENHA_INICIAL" ;;
esac
exit 1
