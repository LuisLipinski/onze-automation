# Onze Automation

Automação externa do **Onze — Organizador de Pelada** com Playwright e TypeScript.

> Estado revisado em 04/09/2026. A cobertura atual é de API; ainda não há automação de interface Android.

## Estado por branch

| Branch | Estado |
|---|---|
| `development` | Suíte atual de API e workflow de integração. |
| `docs/documentation-alignment-2026-09-04` | Atualização documental baseada em `development`. |
| `master` | Baseline inicial com somente README; não contém a suíte funcional. |

## Cobertura atual

A suíte possui dez testes Playwright distribuídos entre:

- health/readiness;
- cadastro, login e consulta do usuário autenticado;
- solicitação e validação negativa de recuperação de senha;
- criação e configuração de grupos;
- autenticação, validações e isolamento de acesso;
- hierarquia do Administrador Principal;
- convite HTTPS reutilizável, entrada idempotente e regeneração;
- saída de membro e obrigação de transferência pelo Principal.

## Ainda não coberto nesta suíte

- partidas avulsas e semanais;
- presença, limite de vagas e prazos;
- pagamentos, créditos, acertos e reposições;
- notificações Expo/FCM;
- fluxos de interface em aparelho ou emulador Android.

Esses domínios possuem testes no backend, mas continuam pendentes na automação externa.

## Execução

Pré-requisitos: Node.js 22 e npm.

```bash
npm install
npm run typecheck
npm test
```

Por padrão os testes usam `https://onze-organizador-de-pelada.onrender.com`. Para outro ambiente:

```bash
API_BASE_URL=http://localhost:8080 npm test
```

O timeout por teste é de 90 segundos para tolerar o despertar do Render gratuito.

## CI

O workflow **Automation CI** executa TypeScript e todos os testes em pushes para `feature/**`, `development` e `master`, além de pull requests direcionados a `development` ou `master`.