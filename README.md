# Onze Automation

Automação externa do **Onze — Organizador de Pelada** com Playwright e TypeScript.

> Estado revisado em 08/09/2026. A cobertura atual é de API; ainda não há automação de interface Android.

## Estado por branch

| Branch | Estado |
|---|---|
| `development` | Suíte atual de API e workflow de integração, com cobertura representativa de P1, P2, P6 e P7. |
| `master` | Branch de release estável; recebe somente versões validadas em `development` e autorizadas explicitamente. |

## Cobertura atual

A suíte possui treze testes Playwright distribuídos entre:

- health/readiness;
- cadastro, login e consulta do usuário autenticado;
- solicitação e validação negativa de recuperação de senha;
- criação e configuração de grupos;
- autenticação, validações e isolamento de acesso;
- hierarquia do Administrador Principal, incluindo `PROMOTE_MEMBERS` para promoção delegada e permanência do antigo Principal como `ADMIN` sem permissões;
- convite HTTPS reutilizável, entrada idempotente e regeneração;
- saída de membro e obrigação de transferência pelo Principal;
- partida avulsa, autorização de gestão, confirmação de presença, limite e liberação de vagas, listagem e cancelamento;
- pagamento informado e confirmado, privacidade financeira, saída paga, reposição obrigatória e reembolso;
- cadastro, validação e remoção de token Expo do dispositivo.

## Ainda não coberto nesta suíte

- séries semanais;
- ciclo temporal dos prazos de inscrição e pagamento;
- créditos, acertos em lote e demais variações de acertos;
- entrega real de notificações pelos provedores Expo/FCM;
- fluxos de interface em aparelho ou emulador Android.

Esses recortes possuem testes no backend, mas continuam pendentes na automação externa.

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

Antes da execução paralela, o setup global aguarda o endpoint de readiness por até quatro minutos para despertar o Render. O timeout de cada teste é de 90 segundos.

## CI

O workflow **Automation CI** executa TypeScript e todos os testes em pushes para `feature/**`, `development` e `master`, além de pull requests direcionados a `development` ou `master`.
