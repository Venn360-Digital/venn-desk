-- Mesclar chamados (Fase 7).
--
-- O chamado mesclado não é apagado nem esvaziado: ele continua existindo, com
-- as mensagens que teve, e passa a APONTAR para o que continua. É a mesma regra
-- de exclusão lógica do resto do sistema — quem abriu aquele chamado precisa
-- poder encontrá-lo depois, e ser levado ao lugar onde a conversa seguiu.
--
-- Sem chave estrangeira para `tickets` de propósito: a FK obrigaria uma ordem
-- de exclusão que não existe (nada é excluído aqui) e tornaria possível um ciclo
-- declarado no banco. Quem impede cadeia e autorreferência é a regra em
-- `src/dominio/mesclar.ts`.
ALTER TABLE "tickets" ADD COLUMN "mesclado_em_id" TEXT;

CREATE INDEX "tickets_app_id_mesclado_em_id_idx" ON "tickets"("app_id", "mesclado_em_id");
