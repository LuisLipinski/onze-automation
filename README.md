# Onze Automation

Automação dos fluxos HTTP de backend e da interface nativa Android do Onze com Playwright, TypeScript e Appium/UiAutomator2.
A implementação do produto permanece em `LuisLipinski/onze-api`; a suíte sobe essa API real com PostgreSQL 18 e todas as migrations Flyway em ambiente descartável.

## Cobertura verificável

- Inventário versionado de 100 operações HTTP (95 de produto e cinco ferramentas opcionais).
- Cenário aprovado com resposta 2xx para cada operação e 401 para cada uma das 94 operações protegidas.
- Fluxos positivos, negativos, permissões, isolamento, concorrência, estados, dinheiro e estatísticas.
- Nenhum teste ignorado/retry para obter aprovação. Rotas novas/alteradas/removidas sem atualização da matriz bloqueiam o CI.
- Relatório JSON/Markdown/HTML com operações, estados HTTP, cenários e SHA exato do backend.

A [matriz de fluxos](coverage/backend-flows.md) detalha o escopo e as fronteiras. O percentual é de operações HTTP; não é uma medição de linhas Java ou de entrega por provedores reais. A suíte Android tem uma matriz funcional separada, descrita abaixo.

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

## Interface nativa Android

A matriz em [frontend-flows.json](coverage/frontend-flows.json) declara 63 cenários funcionais e as 30 rotas Expo Router atuais. [frontend-flows.md](coverage/frontend-flows.md) descreve escopo e limites. Playwright fornece fixtures, assertions e relatórios; todas as ações de interface usam Appium 3.8.0 / UiAutomator2 8.7.1 no APK release, sem navegador ou árvore React simulada.

O workflow **Android UI Automation** compila o mobile `development` para x86_64, usando somente `http://10.0.2.2:8080`. A liberação de HTTP fica no manifesto Android gerado desse build isolado. O APK de emulador não é uma versão para distribuição. O código do mobile e o APK arm64 para os usuários permanecem os mesmos.

Cada uma das oito partes executa seu próprio emulador Android 36 e sua própria API/PostgreSQL descartável. Os dados são preparados pela API e as ações verificadas ocorrem na interface; consultas à API conferem persistência. O login é feito pelo formulário real e o armazenamento do aplicativo é limpo a cada cenário. A permissão de notificações é concedida na preparação do emulador. A receita v2 do APK omite o projeto EAS e desativa a inicialização automática do FCM; o código de notificações locais continua real, sem registro remoto. Essa configuração é exclusiva do checkout descartável usado pelo CI. Código de recuperação vem do capturador de e-mail do harness. Os prazos usam o relógio controlado da API; os testes de tempos aguardam o cronômetro real do emulador liberar o encerramento, sem mudar o relógio do aparelho.

```bash
npm ci
npx appium driver install uiautomator2@8.7.1
npm run frontend:contract
# Com a API/harness em execução e emulador Android iniciado:
npx appium --address 127.0.0.1 --port 4723
# Em outro terminal, com o mesmo AUTOMATION_CONTROL_TOKEN:
FRONTEND_APK=/caminho/absoluto/onze-automation-emulator.apk npm run frontend:test
```

Requisitos adicionais locais: Android SDK/ADB, unzip, emulador Android 36 e APK release x86_64 da receita v2, compilado para a API local, sem projeto EAS e com FCM auto-init desativado. O driver recusa APKs que ainda contenham o projeto EAS. `ONZE_MOBILE_DIR` aponta para o checkout mobile (padrão `../onze-mobile`). Não execute backend e Android ao mesmo tempo contra a mesma base: ambos limpam dados entre cenários.

O CI publica HTML, JSON, captura de tela de cada cenário, hierarquia Android em falhas e logs por 14 dias. O gate consolidado exige todas as partes, os 63 cenários aprovados com comandos e assertions nativos, as 30 rotas/guardas observadas, revisões idênticas da API/mobile e zero falhas, ignorados ou retries. Rotas novas sem inventário atualizado bloqueiam a compilação.

O disparo manual aceita `mobile_ref`, `backend_ref` e um filtro opcional `scenarios`. Execuções filtradas são diagnósticas e não aprovam o gate integral. Alterações em API/mobile não disparam automaticamente este repositório; execute o workflow depois de integrar mudanças nesses projetos.

A cobertura mede a matriz funcional declarada e entradas/guardas das rotas, não linhas/branches TypeScript, comparação de pixels ou todas as combinações de dados e aparelhos. Entrega real de push/e-mail/WhatsApp, biometria física e seleção/edição de fotos em aparelhos reais continuam exigindo validação própria. Os testes abrem o compartilhamento nativo sem enviar mensagens para pessoas.

O fluxo de recusa da permissão de notificações não está nesta matriz. Na revisão mobile `3f02636`, esse estado gerou ciclos de atividades `REQUEST_PERMISSIONS` no emulador, interrompendo toques e rolagens; precisa de correção e validação específicas no mobile. A suíte funcional usa a precondição de permissão concedida e mantém o registro remoto isolado.
