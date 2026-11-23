-- Confirmação de leitura (Fase 3, tempo real).
--
-- Duas colunas no chamado, e não uma tabela de leituras por mensagem. A pergunta
-- que se faz na tela é "o outro lado já viu o que eu escrevi?", e ela se
-- responde comparando o carimbo de leitura com a data da mensagem — uma linha
-- por mensagem por pessoa custaria uma escrita a cada rolagem para responder
-- exatamente a mesma coisa.
--
-- Dois lados porque são dois sujeitos: o solicitante lê no widget, o atendente
-- lê no Console, e cada um precisa saber do outro.
ALTER TABLE "tickets" ADD COLUMN "lido_pelo_solicitante_em" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "lido_pelo_atendente_em" TIMESTAMP(3);
