# Matriz de fluxos externos do backend

Fonte: controllers de `LuisLipinski/onze-api`, branch `development`.
O relatório de cada execução registra o SHA exato em `.runtime/backend-source.json`.

O inventário possui **100 operações HTTP declaradas**: 95 de produto e cinco ferramentas opcionais.
Seis operações são públicas; as outras 94 devem rejeitar requisições anônimas com 401.
O gate exige um cenário aprovado com resposta 2xx para cada operação, a rejeição anônima de todas as operações protegidas e nenhum teste ignorado/falho.
Rotas específicas têm prioridade sobre parâmetros, evitando contar `/api/matches/live` como uma chamada a `/api/matches/{matchId}`.
Alterar/adicionar/remover um controller sem atualizar o inventário bloqueia o CI.

| Domínio | Fluxos e efeitos verificados | Cenários |
|---|---|---|
| Autenticação | Cadastro/login/me, duplicidade, validações, JWT inválido, bloqueio persistente, código efetivamente gerado, recuperação positiva/negativa, expiração, consumo, limite de tentativas, reenvio e falha do provedor sem enumeração | `auth*.spec.ts` |
| Grupos | Criação/listagem/configuração, foto e falha de mídia, convite reutilizável/regeneração, entrada idempotente, saída/remoção, transferência, exclusão em cascata, preservação de outros grupos e avisos pessoais idempotentes | `groups`, `group-*` |
| Permissões | As 11 permissões configuráveis: negar antes, permitir após delegação e negar imediatamente após revogação; ações exclusivas do Principal continuam exclusivas | `permissions-matrix`, `group-admins`, `group-lifecycle` |
| Perfis | Posições primária/secundária/legadas, goleiro e voluntariado, independência por grupo, 17 habilidades, faixas/limpeza, edição delegada e leitura pessoal sem edição | `sports-profile`, `group-lifecycle` |
| Agenda | Modalidades, formatos, limites, validações, pagamento/tempos, quatro ocorrências semanais independentes, abertura na janela da ocorrência, propagação de configuração e cancelamento de ocorrência/série | `match-configuration`, `matches-payments-notifications` |
| Presença e fila | Exemplo 14 = 12 de linha + duas vagas reservadas, FIFO persistente, reinserção ao final, concorrência, promoção compatível, ampliação do limite, ausência de cobrança em espera e saída após prazo | `waitlist-goalkeepers` |
| Goleiros e convidados | Principal imediato, secundário elegível no prazo, ambiguidade sem desempate automático, voluntário manual, reserva aprovada no gol sem mudar perfil, aluguel/convidado no gol e preferência administrativa por convidado | `waitlist-goalkeepers`, `teams-guests` |
| Financeiro | PENDING/REPORTED/PAID, cobrança deduplicada, rejeição/reenvio, confirmação idempotente, privacidade independente da gestão de jogadores, isenção, remoção por prazo e janela da reposição tardia | `finance-credits` |
| Acertos e créditos | Saída paga/reposição, reembolso, não recebido, retenção e crédito, lote, reserva/aplicação sem duplicidade, saldo parcial, prioridade cronológica, expiração de reserva e realocação entre fila e promoção | `finance-credits`, `matches-payments-notifications` |
| Escalações | Participantes únicos, distribuição de goleiros, dois/três times, perfis reais/estimados, privacidade, mudança manual, invalidação após saída, reservas automáticas/manuais e nomes/imagens persistidos | `teams-guests` |
| Live | Início/finalização/reset, feed, versão/204, placar, gol/assistência/correção por exclusão, gol contra, chutes manuais/automáticos, cantos, amarelos/vermelho/expulsão e reversão, falta e pênalti com resolução separada e exclusão vinculada | `live-events` |
| Tempo e disputa | Um a quatro tempos, acréscimos, intervalo, prorrogação por empate, dispensa com vencedor, pênaltis sem prorrogação, batedores, alternância, fim antecipado, morte súbita, confirmação e limite automático de três horas | `periods-shootout`, `live-events` |
| Estatísticas | Apenas jogos finalizados, fontes corrigidas, gols contra e disputa excluídos dos gols pessoais, jogos/vitórias/derrotas, assistências, desempates, histórico pessoal, geral permanente e snapshots de temporadas encerradas | `statistics-seasons`, `periods-shootout` |
| Notificações/SSE | Token válido/inválido/remoção, destinatário e rota, jobs deduplicados/obsoletos, falha HTTP/retry, DeviceNotRegistered, exclusão de grupo e atualização real por SSE sem dados de outro grupo | `notifications-stream`, `matches-payments-notifications` |
| Isolamento/segurança | Todas as operações privadas sem autenticação, grupo alheio, IDs de evento/escalação de outra partida, 403/404 consistentes e ausência de mutação após negativas | `authentication-matrix`, `resource-isolation` e cenários dos domínios |
| Ferramentas opcionais | Flag ausente = false, rotas 404 e capacidades falsas; segundo processo explicitamente habilitado valida geração, cenários e presença com autorização | `devtools-disabled`, `devtools-enabled` |

## Fronteiras da medição

Os 100% medem as operações HTTP do inventário, com os fluxos acima exercitados pela API real. Não representam cobertura de 100% das linhas/ramificações Java ou de todas as combinações possíveis de dados.

Banco PostgreSQL 18, Flyway, segurança, serviços, transações, HTTP, serialização e processamento de jobs são reais. O harness só troca relógio, envio de e-mail e armazenamento de imagens; o adaptador Expo real chama um receptor HTTP local controlado. E-mails usam o código realmente gerado pelo serviço. Fixtures SQL só preparam expiração/reenvio/desbloqueio da autenticação e limpam as bases descartáveis.

Não se mede entrega real por Resend/Cloudinary/Expo/FCM nem recebimento no aparelho, interface Android, carga ou funcionalidades futuras do roadmap. Essas fronteiras não devem ser apresentadas como validadas.
