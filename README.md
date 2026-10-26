# Onze Automation

Automação externa dos fluxos HTTP de backend do Onze com Playwright e TypeScript.
A implementação do produto permanece em `LuisLipinski/onze-api`; a suíte sobe essa API real com PostgreSQL 18 e todas as migrations Flyway em ambiente descartável.

## Cobertura verificável

- Inventário versionado de 100 operações HTTP (95 de produto e cinco ferramentas opcionais).
- Cenário aprovado com resposta 2xx para cada operação e 401 para cada uma das 94 operações protegidas.
- Fluxos positivos, negativos, permissões, isolamento, concorrência, estados, dinheiro e estatísticas.
- Nenhum teste ignorado/retry para obter aprovação. Rotas novas/alteradas/removidas sem atualização da matriz bloqueiam o CI.
- Relatório JSON/Markdown/HTML com operações, estados HTTP, cenários e SHA exato do backend.

A [matriz de fluxos](coverage/backend-flows.md) detalha o escopo e as fronteiras. O percentual é de operações HTTP; não é uma medição de linhas Java ou de entrega por provedores reais. Testes de interface ficam para uma etapa separada.

## Ambiente e execução

Pré-requisitos: Node.js 22, Java 25, Maven e PostgreSQL 18 local. Crie as bases descartáveis `onze_automation` e `onze_automation_tools` com o usuário `onze`/senha `onze-automation-only`, ambas acessíveis somente em loopback. Mantenha `onze-api` ao lado deste repositório, na branch `development`, ou informe `ONZE_API_DIR`.

```bash
npm ci
npm run typecheck
npm run backend:contract
export AUTOMATION_CONTROL_TOKEN=local-disposable-control-0123456789
npm run backend:start
```

Em outro terminal, usando o mesmo token:

```bash
export AUTOMATION_CONTROL_TOKEN=local-disposable-control-0123456789
BACKEND_COVERAGE_GATE=true npm test
```

Para uma investigação direcionada, o gate integral pode ficar desligado:

```bash
npx playwright test --project=backend tests/api/waitlist-goalkeepers.spec.ts
```

`AUTOMATION_POSTGRES_PORT` permite usar outra porta local; usuário e senha podem ser definidos por `AUTOMATION_DATABASE_USER`/`AUTOMATION_DATABASE_PASSWORD`. A suíte e o processo de controle recusam destinos fora de loopback e usam exclusivamente bases de nome `onze_automation*`.

O processo principal roda na porta 8080/controle 8090 com a flag de ferramentas ausente (padrão false). O segundo roda em 8081/8091 com a liberação explícita. As bases são limpas antes de cada cenário. Os testes são executados por um worker para que o relógio controlado e os dados não interfiram entre cenários; testes de concorrência enviam requisições simultâneas explicitamente.

O harness pertence somente a este repositório e nunca é empacotado na API/Render. Lógica de negócio e controllers permanecem reais. E-mail/mídia são capturados; Expo usa HTTP local, incluindo erros e retries simulados. Não há envio para pessoas reais.

## CI

**Automation CI** executa em PRs para `development`, pushes em `development` e disparo manual. O disparo manual aceita `backend_ref`; o padrão é `development`.

O job instala PostgreSQL 18, obtém a revisão da API, compila o harness, executa TypeScript/inventário/cenários/gate e publica `backend-automation-report` por 14 dias, inclusive em falha. O artifact inclui a revisão testada e logs de ambos os processos. Não depende do Render nem altera `master`.
