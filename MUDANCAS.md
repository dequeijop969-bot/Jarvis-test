# O que mudou (JARVIS 2.0 → 3.0)

## Situação que encontrei
O back-end (pasta `lib/`) já tinha quase tudo do pedido: perfil, chaves mascaradas, roteador com plano B, clima, Gmail somente leitura, triagem, memória e Canva "em breve". Mas o **index.html ainda era o da versão 2.0**: sem formulário, sem barra de integrações, sem seletor de modelo, sem botão Iniciar, sem pop-ups de e-mail e sem os novos loaders. Pior: ele não mandava o cabeçalho de segurança que o servidor exige e enviava o chat no formato antigo, então **nenhuma conversa funcionava**. O `.gitignore` não ignorava a pasta `data/` (onde ficam chaves e tokens), o README era o antigo e os arquivos ENTREGA/TESTE_ACEITACAO afirmavam testes que não existiam (removidos).

## Front-end (index.html, reescrito aproveitando gráficos e legendas)
- Primeiro acesso: nome, tratamento, cidade com busca (Open-Meteo), idioma; depois o convite "Conecte o Gmail" com "Agora não". Editável em Integrações > Editar perfil.
- Barra fina no topo: marca, progresso dos slides, seletor JARVIS 1.0 / 2.5 / 5.1, chip do clima (atualiza a cada 30 min), chip "plano B" quando o modelo principal falha, botão Integrações.
- Painel de Integrações: Gmail (conectar/desconectar), Canva ("em breve"), chaves Gemini, Anthropic e ElevenLabs (+ ID da voz) com Salvar, Testar e Remover; estado com cor **e** texto; só "••••1234".
- Botão Iniciar: saudação + clima começam a ser falados enquanto a triagem carrega em paralelo; depois a triagem, cartão a cartão, e volta a ouvir.
- Pop-ups de e-mail: envelope SVG original com a inicial, assunto, resumo, prioridade, aviso de remetente suspeito, contador "14 novos · 5 importantes", "ver os outros N", destaque sincronizado com a fala, botões Abrir/Ignorar e comandos de voz.
- Círculo com 4 estados: ocioso e ouvindo (mostrador atual + anel pulsando), pensando (5 estrelas, Uiverse.io/narmesh_sah), falando (esfera P&B sem texto, Uiverse.io/dexter-st). Transições suaves, aria-label e texto a cada troca, reduced-motion deixa estático.
- Todas as escritas mandam `x-jarvis: 1` (proteção contra CSRF). Nada em localStorage.

## Back-end
- `lib/profile.js`: o filtro de texto apagava hífens ("Jean-Luc", "Saint-Denis") e deixava passar caracteres de controle. Corrigido.
- `.gitignore`: agora ignora `data/`, `data-demo/` e os arquivos locais de chaves, tokens, perfil e memória.
- `.env.example`: inclui Gemini, Google OAuth e Canva.

## Testes
- `test/mocks.mjs`: simula Gemini, Anthropic, ElevenLabs, Gmail e Open-Meteo (sem internet).
- `test/e2e.mjs`: os 9 critérios de aceite via HTTP, incluindo varredura de chaves em todas as respostas, no HTML e nos logs.
- `npm run demo` agora usa os simuladores e uma pasta de dados separada.

## O que NÃO consegui testar
- Nada rodou num navegador de verdade (o ambiente não tinha navegador): visual, animações, microfone, SpeechRecognition e áudio precisam de um teste seu no Chrome/Edge.
- Chamadas reais a Gemini, Anthropic e ElevenLabs (dependem das suas chaves).
- Login real no Google e triagem da sua caixa real.
- O ID `claude-sonnet-5-5` da reserva não foi confirmado na documentação da Anthropic.

## Fase 4 (parcial)
- Gmail: escopos gmail.modify + calendar.readonly; lixeira sob pedido (sem exclusão permanente); agenda somente leitura.
- Servidor: rotas /api/agenda, /api/github/summary, /api/emails/trash, /api/actions/* (toggle, confirm, cancel, undo). Confirmação de risco alto só por toque.
- Interface: interruptores de ações, botão Lixeira nos e-mails, cartão de confirmação, desfazer por 5 minutos, botões Agenda e GitHub.
- Corrigido: lib/store.js sem readFile/appendFile e google.js sem calendarGet (módulos novos quebravam ao importar).
- NÃO feito: ferramentas de ação para a IA e comandos de voz novos, briefing com agenda/GitHub, execução de PR/merge, redesign do layout, testes de navegador. Nada foi testado com contas reais.
- Voz (assistant.js detectIntent + server handleIntent): agenda, GitHub, lixeira, desfaz, confirmo/cancela. Saudação agora lê agenda e GitHub (com limite de 6 s cada).
- Integrações em cartões; campos para os tokens github_read/github_write na interface (a rota /api/keys aceita os dois).
- Visão da tela: botão "Tela" + cartão em Integrações (getDisplayMedia, permissão do navegador a cada vez, aviso fixo "Tela compartilhada", encerra após 10 min parado). Uma foto (JPEG até 1280 px) é anexada às falas enquanto compartilha; o servidor só a usa se o pedido for sobre a tela, envia ao modelo (Gemini ou Anthropic) e não grava nada. Comandos: "olha minha tela", "o que tem na tela?", "para de ver minha tela".

## Correção da camada visual (Opus 3.1)
- O CSS base tinha sido removido e só ficou a "camada visual": a página abria sem estilo. Restaurado o base antes da camada.
- `el is not defined` (painel de agenda do Opus usava um helper que não existia fora do bloco de ações): helper global adicionado. Esse erro interrompia o script principal.
- CSS dos cartões de integração (perdido na reformulação) restaurado: ícones estavam gigantes.
- Barra do topo no celular quebra em duas linhas (o botão Integrações ficava fora da tela).
- Removidos os botões Agenda/GitHub duplicados; botão Tela no mesmo estilo dos demais.
- Créditos dos loaders (Uiverse.io) recolocados; o teste 7 voltou a passar.
- Visão da tela mantida (ficou de fora da versão enviada ao Opus).

## Correção: agenda, GitHub e contexto da tela
Três defeitos relatados, três causas diferentes.

**1. "Agenda livre hoje, senhor" ao pedir para marcar um compromisso**
- Causa: a palavra "agenda" disparava a leitura da agenda, que responde "Agenda livre" quando não há eventos. Não existia criação de eventos (o escopo do Google era só `calendar.readonly`).
- Agora: "marca / agenda / cria / coloca ... reunião, consulta, compromisso..." é um pedido de **criar**. A IA só extrai título, data, hora e duração; o código valida (sem passado, no máximo 1 ano, duração de 5 min a 24 h). Falta o horário? Ele pergunta. Há conflito? Ele avisa. Nada é criado antes de "confirmo" (voz) ou do botão Confirmar (cartão novo na tela). Confirmar duas vezes não cria dois eventos.
- Novo escopo `calendar.events` (só criar na agenda principal; não existe editar nem apagar). **Você precisa reautorizar o Google em Integrações** (e, se o app do Google Cloud estiver em modo de teste, incluir esse escopo na tela de consentimento).
- "o que tenho marcado amanhã" e "agenda um dentista sexta" agora caem no lado certo.

**2. GitHub: "o CI está ok" sem ter verificado nada**
- Causa: toda consulta que falhava virava lista vazia (`.catch(() => [])`) e a fala dizia "nenhum PR" e "CI verde". "Repositórios" também caía no resumo de PRs; nunca lia repositório nenhum. Além disso a voz lia a sigla "CI" de um jeito que soava como "PCI".
- Agora: se uma consulta falha, ele diz qual ("não consegui consultar revisões pedidas") e não afirma o resto como certo. "Testes automáticos passando" só quando verificou de fato; sem permissão de Actions ou sem testes, ele diz isso. Token inválido em tudo vira erro claro, não "tudo bem".
- Novo: "ler meus repositórios" lista os mais recentes; "fala do repositório X" (ou só o nome dele) dá descrição, linguagem, última atividade, último commit e itens abertos, com resumo do README pela IA; "últimos commits do X" lista os commits. Sem siglas na fala (pull request, testes automáticos).

**3. Esquece o contexto depois de olhar a tela**
- Causa: as respostas locais (tela, agenda, GitHub, lixeira) nunca eram gravadas na memória, então o pedido seguinte chegava sem saber o que tinha sido dito ou visto. A pergunta sobre a tela também ia sozinha, sem histórico.
- Agora: toda resposta local entra na conversa (a da tela vai marcada como "vendo a tela"). Enquanto a tela está compartilhada, o comentário seguinte (até 4 min) continua sobre a tela, com a imagem atual e as últimas falas. "Para de ver minha tela" encerra a continuação. Agenda e GitHub consultados também entram no contexto da IA (só título/horário e repo#número, como o design original previa).

**Testes** (`npm run check`, 19 verificações): `test/fixes.mjs` (intenções, validação de data/hora, honestidade do GitHub, histórico da tela) e `test/flow.mjs` (servidor real com Google, GitHub e Gemini simulados: marcar com conflito, confirmar, listar repositórios, falha de consulta, tela e memória). `test/actions.mjs` agora usa pasta de dados própria (antes gravava em `data/`).

**Não consegui testar:** criação de evento no Google real (escopo, consentimento), GitHub e Gemini reais, e nada no navegador (o cartão novo de confirmação, microfone, captura de tela).

## Correção: "marque um compromisso", erro "sheet is not defined" e personalidade
- **"Agenda livre hoje" ao pedir para marcar:** o verbo "marque" (com Q) não era reconhecido (a regra só tinha "marca/marco"). Agora reconhece marque/marquem/marquei e também "me lembra de ... amanhã às 9". "O que tenho na agenda", "quais compromissos eu tenho hoje" continuam só lendo a agenda.
- **GitHub: "sheet is not defined":** o botão GitHub (script principal) usava `sheet`/`closeSheet`, definidos dentro de outro bloco de script. Agora são globais (`window.sheet`, `window.closeSheet`).
- **Personalidade:** o prompt agora manda ter opinião, nunca responder "sou só uma IA" em hipóteses/estratégia/ficção, montar um plano em fases (slides) para perguntas como "como dominaria um país", sem sermão. Limite mantido só para instruções operacionais de violência, armas, fraude eleitoral, ataques e perseguição de pessoas reais.
- Testes novos em `test/intents.mjs` (frases de agenda e presença do `window.sheet`).

## Saudação com pop-ups e barra do topo nova
- **Saudação em cartões**: ao tocar em Iniciar, o palco mostra um painel com 5 pop-ups (clima + cidade, agenda de hoje, e-mails, GitHub e notícias). Cada cartão aparece e acende ("falando") quando o JARVIS chega nele; o de e-mails mostra um carregando até a triagem chegar e destaca o e-mail que está sendo lido.
- Cartões sem integração aparecem apagados com o atalho para conectar (Gmail, agenda, token do GitHub).
- **Notícias** (`lib/news.js`): manchetes do país + até 2 da cidade do perfil, via RSS público do Google Notícias (sem chave, cache de 20 min, limite de 6 s). Só título, fonte, link e horário; os links abrem em nova aba.
- `/api/greeting` agora devolve `brief` (dados enxutos para os cartões) e `newsText` (fala das manchetes). Os campos antigos continuam iguais.
- **Barra do topo**: atalhos Agenda, E-mails, GitHub e Tela agrupados numa peça só, com ícones, destaque âmbar no ativo e selos de contagem (compromissos restantes, e-mails importantes, PRs para revisar). Marca com ponto pulsante, chip do clima com ícone e cidade, botão Integrações em destaque. Em telas estreitas os atalhos viram só ícones; no celular ficam numa segunda linha.
- Testes: simulador de notícias em `test/mocks.mjs` e checagens novas no teste 4 do e2e.
- Não testado num navegador de verdade nem com o RSS real do Google (o ambiente não tem internet).

## Correção dos pop-ups + personalidade JARVIS
- Compromissos, notícias, e-mails e PRs não apareciam nos cartões: a animação de entrada terminava com o texto invisível. Corrigido.
- Cartão do clima cortado embaixo e bolinha dupla nos repositórios: corrigidos.
- Personalidade: novo bloco de estilo JARVIS (mordomo britânico, sereno, humor seco, antecipa o próximo passo), usado na conversa e na visão da tela. A saudação termina com um fecho de mordomo, e as falas fixas (clima, notícias, e-mails) ficaram no mesmo tom.

## Modo hospedado (Vercel)
- **Erro 404 em /api/state:** na Vercel só o `index.html` era servido; o `server.js` nunca rodava. Novo `api/index.js` + `vercel.json` mandam todas as rotas para o servidor.
- **Senha obrigatória** (`JARVIS_PASSWORD`, cookie assinado de 7 dias, 5 erros por IP = 15 min de bloqueio). Sem senha definida, o site responde 503 em tudo.
- Domínio público aceito (`JARVIS_PUBLIC_URL` ou o domínio de produção da Vercel); redirecionamentos do Google deixaram de apontar para localhost; o `state` do OAuth não depende de memória (a função pode trocar de instância entre ida e volta).
- `JARVIS_PROFILE` recria o perfil quando o disco é apagado. Dados gravados vão para `/tmp` (somem quando a função dorme).
- Uso local não muda: continua escutando só em 127.0.0.1, sem senha.

## Login com GitHub (sem senha)
- Removida a senha compartilhada. Hospedado: entra só quem está em JARVIS_ALLOWED_GITHUB (falha fechada: sem configuração, o site recusa tudo). Sessão em cookie criptografado (AES-GCM), sem banco; state do OAuth contra CSRF; refresh do token do GitHub App.
- O token do login serve para ler o GitHub (se não houver token manual). Escrita no GitHub continua exigindo o token de escrita separado.
- Formulário de perfil: idioma em botões, lista de cidades como menu, foco mais claro.
