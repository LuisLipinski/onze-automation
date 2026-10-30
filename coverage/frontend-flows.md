# Matriz de interface Android

O inventário executável está em `frontend-flows.json`. O contrato compara as 30 rotas do código mobile com o inventário e os 63 IDs com os testes. Cada resultado aprovado deve carregar evidência de comandos Appium e assertions nativos; visitas HTTP de preparação não contam como execução de UI.

| Área | Cenários | Verificações principais |
|---|---|---|
| Acesso e navegação | A01–A07 | Credenciais inválidas, cadastro, recuperação real de código, código incorreto, persistência/logout, tabs, convite profundo com autenticação. |
| Grupos e administração | G01–G10 | Três etapas de criação, validação, convite/renovação/compartilhamento nativo, menus por papel, todas as 11 permissões configuráveis, promoção sem funções, transferência, rebaixamento/remoção, exclusão/aviso e saída. |
| Perfis e níveis | P01–P04 | Posições, segunda posição, goleiro voluntário, pé dominante, avaliação técnica editável pelo admin e consulta própria sem edição, validação de perfil incompleto. |
| Jogos e séries | M01–M10 | Seletores de calendário/relógio Android, jogo avulso/semanal pago, PIX/isenção, validação de formulário, RSVP/desabilitação, próxima ocorrência fechada/independência, configuração, convidados, cancelamento individual/série e decisão abaixo do mínimo/extensão. |
| Fila e goleiros | W01–W04 | Vagas reservadas, posição na fila e saída, primeiro reserva no gol após prazo, preferência por membro/convidado, aluguel e remoção. |
| Pagamentos | F01–F05 | Informar, rejeitar e confirmar; cobrança sem alterar recebimento; privacidade de créditos; compartilhamento por membro; crédito em lote após cancelamento. |
| Times | T01–T03 | Formação/regeneração, compartilhamento de imagem, consulta sem edição, ferramenta de teste desligada/rota bloqueada, posição/time/reserva manual e unicidade. |
| Jogo ao vivo | L01–L16 | Início/nomes, gol/assistência/contra e exclusão, chute/escanteio/correção, falta com vítima e autor, pênalti convertido/perdido/desfazimento vinculado, dois amarelos/vermelho/exclusão, tempos/acréscimos/prorrogação, finalização/reset, espectador/evento ao vivo, escolha de batedores/cobranças/vencedor. |
| Estatísticas | S01–S04 | Todas as métricas e textos de desempate, temporada nova/fechada/geral, histórico pessoal e abertura de jogo, estado vazio e restrição de iniciar temporada. |

## Critério de aprovação

Oito partes independentes, 63/63 cenários aprovados, 30/30 rotas/guardas observadas e pelo menos um comando e uma assertion nativos em cada cenário. O gate recusa revisões divergentes, IDs ausentes/duplicados, falhas e testes ignorados. O JSON inclui revisões e contadores de evidência; o HTML inclui screenshots e, em falhas, a hierarquia Android e os logs nativos de crash e da aplicação.

`join/[code]` e `dev-test-data` são rotas de redirecionamento/guarda: o teste verifica o destino e o bloqueio esperado. A ferramenta opcional permanece falsa no backend desta matriz, como na configuração normal; seus cinco endpoints habilitados já pertencem à suíte HTTP separada.

## Limites

A contagem representa esta matriz funcional e não prova 100% de linhas, branches, pixels, controles ou combinações de dados. A lógica real da API e o banco são usados; e-mail/mídia/Expo ficam nas fronteiras isoladas já documentadas no backend. A permissão de notificações é concedida no emulador; o APK de receita v2 omite o projeto EAS e desativa FCM auto-init para isolar o registro remoto. A recusa dessa permissão precisa de validação própria: na revisão mobile `3f02636`, os logs mostraram ciclos de `REQUEST_PERMISSIONS` que interrompem a interação. O compartilhamento abre o seletor Android sem enviar a WhatsApp ou destinatários. Biometria física, galeria/câmera/edição de fotos, entrega real de notificações/provedores, aparelhos/versões adicionais, acessibilidade com leitor de tela, carga e funcionalidades futuras não estão declarados como validados por esta matriz.
