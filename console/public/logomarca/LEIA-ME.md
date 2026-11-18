# Marca do Console

Largue os arquivos nesta pasta. O Vite serve `console/public/` na raiz, então
`console/public/logomarca/simbolo.svg` fica em `/logomarca/simbolo.svg`.

## O que eu uso, e onde

| Arquivo | Onde aparece | Observação |
| --- | --- | --- |
| `completa.svg` | tela de login, topo da sidebar expandida | símbolo + palavra |
| `simbolo.svg` | sidebar recolhida, favicon | quadrado, legível a 24px |
| `completa-escuro.svg` | as mesmas, no modo escuro | só se a versão clara não funcionar sobre fundo escuro |
| `simbolo-escuro.svg` | idem | idem |

SVG de preferência — a sidebar recolhe para 48px e cresce em tela cheia, e PNG
borra nos dois extremos. Se só houver PNG, mande em 3x (ex.: 144px de altura).

## As cores

Se houver um arquivo de tokens da marca (Figma, brand kit, um `.json`), mande
junto. Sem ele, eu extraio as cores dos próprios SVGs e monto a paleta a partir
delas — mas aí **você confere**, porque cor de logo e cor de interface não são a
mesma coisa: a logo usa duas ou três cores saturadas, e uma interface precisa
de uma escala inteira de neutros, estados (erro, aviso, sucesso) e superfícies.

O `DESIGN.md` do monorepo resolveu exatamente isso para o OdontoBox360, e vale
a leitura: lá o teal da marca reprovava contraste com branco, e a correção foi
usar o navy da própria marca sobre ele — o par, não a cor alterada.

## O que NÃO preciso

Favicon pronto, apple-touch-icon, variações em PNG de vários tamanhos. Eu gero
tudo a partir do `simbolo.svg`.
