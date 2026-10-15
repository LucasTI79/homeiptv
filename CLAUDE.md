# ViniPlay

## Regra: compatibilidade com Cast (TV)

Toda feature nova ou alterada que toque playback, UI do player, legendas, áudio ou controles deve:

1. Considerar explicitamente o comportamento quando a sessão está em Cast (TV), não só no player local do navegador.
2. Reusar a sessão/estado existente de Cast (`frontend/src/components/cast/CastProvider.tsx`, `frontend/src/api/cast.ts`) em vez de duplicar lógica de playback pro caminho de Cast.
3. Incluir teste (unitário, integração ou manual documentado) cobrindo o caminho de Cast antes de considerar a feature pronta.

Motivo: o player tem dois caminhos de playback (local e Cast/custom receiver) que divergem facilmente se só um deles for testado — já aconteceu de feature nova funcionar local e quebrar silenciosamente no Cast.

Aplicação: todo agente (humano ou IA) trabalhando em código de player/cast/streaming deve seguir essa regra antes de abrir PR ou considerar a tarefa concluída.
