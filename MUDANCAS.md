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

## 3.2: landing page, imagens e acabamento visual
- **Landing page** em `/` (`landing.html`); o assistente passou para **`/app`**. A landing tem uma lista de primeiros passos que lê `/api/state` ao vivo (servidor, chave de IA, perfil, voz, navegador/microfone, Google, GitHub, imagens), com progresso, passo a passo e atalhos (`/app#integracoes`, `/app#imagens`), além de recursos, comandos de voz por categoria (copiar com um toque) e privacidade. Os retornos do OAuth (Google e Canva) agora voltam para `/app`.
- **Imagens** (`lib/images.js`): busca no Google (Programmable Search, `GOOGLE_CSE_KEY` + `GOOGLE_CSE_ID`) com plano B no Openverse (sem chave). Voz: "pesquisa imagens de X". Galeria no palco e no painel **Imagens** da barra: ampliar (com setas), baixar, abrir a origem, selecionar e **exportar em ZIP** com créditos. Rotas: `GET /api/images/search`, `GET /api/images/<id>/thumb|file`, `POST /api/images/zip`. Sem URL arbitrária vinda do navegador, IP privado recusado, 15 MB por imagem.
- **Visual**: grafite mais profundo, botões e campos refinados, painel de integrações centralizado em vidro, cartões de integração com ícone âmbar, legendas com brilho, halo no círculo ao ouvir/falar, barras de rolagem discretas. O cartão de confirmação (lixeira, agenda, GitHub) **não tinha estilo nenhum** e agora tem. Botões **Imagens** e **Guia** na barra.
- Removido um bloco de CSS duplicado (~200 linhas idênticas).
- Testes: `test/images.mjs` (intenção de voz, Google → Openverse, bloqueio de IP privado, ZIP com CRC conferido, rotas) e o e2e verifica a landing. `npm run check` passa.
- Conferido no navegador interno, no modo demo: landing, checklist, painel de imagens com busca real no Openverse, exportação ZIP real e galeria pela voz. Não testado: busca real no Google (precisa da sua chave), áudio e microfone.

## Correção: "a IA não consegue me apresentar as imagens"
- **Causa:** frases reais como "pode me pesquisar um meme no Google" e "me mostre uma imagem" não batiam com o detector (ele exigia "imagens **de** algo"). O pedido caía na conversa comum, e a IA, que não sabia da ferramenta, respondia que "não possui galeria".
- **Agora a IA sabe que mostra imagens:** o prompt ganhou a seção IMAGENS e o campo `image_search`. Quando o pedido é de imagem (inclusive sem tema, usando o assunto da conversa), a IA preenche a busca, o servidor pesquisa e a galeria vem junto na resposta. Ela não diz mais que não consegue.
- **Detector mais flexível:** aceita meme, gif e figurinha; pedidos sem "de" ("pesquisa um meme"); "no Google" em qualquer posição ("pesquisa no google imagens de gatos").
- **Sem resultado exato:** tenta versões mais curtas ("meme do verity" → "meme verity" → "verity") e avisa na fala e na galeria qual busca usou.
- **Miniaturas mais rápidas:** o servidor começa a baixá-las logo após a busca, enquanto o JARVIS fala, e os cartões mostram animação de carregamento.
- Testes novos em `test/images.mjs` (suas frases reais, IA pedindo imagens, busca relaxada). `npm run check` passa.

## Fotos dentro dos slides
- Cada slide pode ter `"image"`: uma busca curta que a própria IA escolhe. O prompt (seção FOTOS NOS SLIDES) manda usar fotos em assuntos visuais (lugares, pessoas públicas, animais, objetos, obras, eventos, jogos), com 1 a 3 slides de imagem por apresentação, inclusive slides novos só para mostrar a foto. Ideias abstratas e números continuam com gráficos.
- O servidor busca as fotos dos slides em paralelo (até 4 slides, 9 s no máximo cada) e anexa até 6 opções por slide. Se a busca não acha nada, o slide segue sem foto, sem erro.
- No palco: texto à esquerda e foto à direita (empilhado no celular), com animação de carregamento, miniatura imediata trocada pela versão grande, zoom lento, legenda com autor, fonte e licença, e botões "outra foto", baixar e origem. Tocar na foto amplia. Se uma imagem falha, pula para a próxima opção. A foto do próximo slide é pré-carregada enquanto o atual é narrado.
- Slides agora também guardam `"points"` (tópicos curtos), que antes eram descartados.
- Teste novo em `test/images.mjs`: apresentação com foto, slide cuja busca falha e slide só com gráfico.

## Voz ilimitada sem depender da ElevenLabs
- `lib/edgetts.js`: voz neural gratuita da Microsoft (a mesma da "Leitura em voz alta" do Edge), sem chave e sem cota. Padrão: **Antonio** (pt-BR, grave e sereno), um pouco mais lenta (-4%) e grave (-2 Hz) para soar como mordomo. Também há Ryan (inglês britânico), Andrew, Álvaro, Francisca e Thalita. Devolve o tempo de cada palavra, então as legendas continuam sincronizadas. Usa um cliente WebSocket próprio (o nativo do Node não completa o handshake com esse servidor) e se acerta sozinho se o relógio do PC estiver fora de hora.
- `lib/tts.js`: escolha de provedor. **Automático**: ElevenLabs se configurada; sem créditos, limite ou rede, passa para a Microsoft. Sem ElevenLabs, usa a Microsoft direto. Também dá para escolher só Microsoft, só ElevenLabs ou a **voz do navegador**.
- Último recurso no navegador: se o servidor não conseguir voz nenhuma (sem internet, por exemplo), o JARVIS fala com a melhor voz do sistema (prefere as "Natural"/"Online" do Edge), com legenda sincronizada.
- Integrações → **Voz**: provedor, voz, velocidade, "Ouvir amostra" e "Salvar". Fica salvo no perfil (`voice`).
- Aviso: é um serviço não oficial da Microsoft. Se ele mudar, o JARVIS cai para a ElevenLabs (se houver) ou para a voz do navegador, sem travar.
- Teste novo: `test/voice.mjs` (servidor da Microsoft simulado, escape do SSML, escolha de provedor, planos B, validação do perfil). Conferido de verdade: amostra real gerada em ~1 s pelo app.

## Abrir apps e sites por voz
- `lib/launcher.js`: "abre o Chrome", "abre o YouTube", "abre uma guia do g1.com", "abre uma nova guia", "pesquisa no Google receita de bolo", "abre a calculadora". Sites abrem no Chrome (ou no navegador padrão, se não houver Chrome).
- Só **abre**: não fecha, não clica, não digita. Apps só de uma lista fixa (Chrome, Edge, Bloco de Notas, Calculadora, Paint, Explorador, Downloads, Configurações, Spotify, Discord, Steam, VS Code, Word, Excel, PowerPoint...) ou cadastrados por você (caminho completo de um .exe/.lnk existente). Sites só `https`. Nenhum texto falado vai para um shell; e só a sua fala aciona (textos de e-mails ou páginas não).
- Integrações → **Abrir apps e sites por voz**: liga/desliga (fica no perfil) e cadastro de apps próprios ("valorant" → caminho do .exe).
- "abre esse" (e-mails) e "abre minha agenda" continuam funcionando como antes.
- Teste novo: `test/launcher.mjs` (frases, bloqueio de injeção, comandos exatos, cadastro, interruptor, rota protegida).

## Jarvis Desktop: app de Windows + mascote (pasta `mascote/`)
- `JarvisDesktop.exe` (C#, compilado pelo `csc.exe` do Windows, sem downloads): fica na bandeja, sobe este servidor se precisar (e o encerra ao sair), abre o site numa janela própria e mostra o mascote em pixel art por cima de todas as janelas.
- Mascote: pensa enquanto o Jarvis processa, anda até o app, abre (só apps da allowlist do `config.json` dele), pula na barra de título e acompanha a janela. Arrastar cancela a ação. Detalhes, diagrama e protocolo em `mascote/README.md`.
- Mudanças aqui: `lib/mascot.js` (eventos SSE `pensando_inicio`, `acao`, `concluido`, `erro`); em `server.js`, a conversa avisa o mascote, o "abrir" é delegado a ele quando ele sabe abrir o app (senão segue como antes), e há as rotas `GET /api/mascot/events` (exige `x-jarvis`) e `POST /api/mascot/result`. O painel mostra se o mascote está conectado.
- Teste: `test/mascot.mjs`. Ponta a ponta conferido de verdade neste PC.

## Ler a tela onde o mascote está
- "olha minha tela" sem tela compartilhada no navegador: o Jarvis pede ao mascote UMA foto da janela em que ele está em pé (ou do monitor, se estiver no chão), e a análise usa a mesma `askScreen` de antes, agora com o nome da janela. Nada é gravado; ele só olha (não clica nem digita).
- `lib/mascot.js`: `capture()` e `captureResult()` (prazo de 6 s, só aceita JPEG que foi pedido). Rota `POST /api/mascot/capture`. O mascote declara a capacidade com `tela=1` e pode desligá-la com `permitirLerTela: false`.
- Teste em `test/mascot.mjs`. Conferido de verdade com a IA simulada do demo (a tela não saiu do PC): no chão, foto do monitor; em cima do Bloco de Notas, foto só da janela.

## Janela flutuante (/app?mini=1)
- Modo compacto do mesmo site: só o círculo, o que você disse e a legenda. Sem a saudação longa: o primeiro toque já começa a ouvir.
- Quando a resposta tem slides (mais de um, gráfico, quadro ou foto), a janela cresce e mostra a apresentação em miniatura no canto inferior esquerdo; "Esconder slides" volta ao compacto.
- `GET /api/ui/events` + `POST /api/ui/talk`: o atalho global do Jarvis Desktop (Ctrl+Alt+F) faz a janela flutuante começar/parar de ouvir. O fluxo só leva o aviso, sem dado nenhum. Teste em `test/mascot.mjs`.

## Modos Talk e Code
- Switch Talk/Code (janela flutuante e barra do app). Vai no corpo do `/api/chat` como `mode` e fica salvo no perfil (`mode`).
- Code: intenções locais primeiro ("abre o YouTube" não gasta IA); senão a IA escolhe UMA ação de uma lista fechada e `codeTarget()` valida (allowlist de apps, só https, sem endereço local, pesquisas com URL montada aqui). Executa pelos caminhos do Talk (mascote quando conectado). Pedidos de digitar/clicar/rodar comandos recebem uma resposta curta explicando que o modo Code não faz isso.
- No Code, a continuação automática sobre a tela fica desligada (cada frase é uma ação nova).
- `POST /api/ui/size` (a janela flutuante pede para crescer com slides; o Jarvis Desktop dimensiona a moldura). Testes em `test/mascot.mjs`.

## Modo Code: escrever código no VS Code com o mascote
- "abre o VS Code e cria um html de...", "escreve um script python...", "faz um site sobre...": no modo Code, a IA ganhou a ação `escrever` (nome do arquivo + o que ele deve ter). Frases assim vão direto para a IA (não caem no "abrir" local).
- `lib/codewriter.js`: uma segunda chamada à IA escreve o arquivo inteiro (sem cercas de markdown); o servidor cria um arquivo NOVO e vazio em `Documentos\Jarvis Code` (`JARVIS_CODE_DIR` muda a pasta). Nome limpo, nunca sobrescreve (`index-2.html`...), só extensões de código/texto.
- Com o mascote: evento `acao {acao:"escrever", alvo:"vs code", arquivo, conteudo}`. Ele abre o VS Code, sobe na janela e, no estado novo **Writing**, roda a animação do notebook enquanto grava o arquivo aos poucos (~90 caracteres/s, até 40 s); o VS Code mostra o código chegando. Nenhuma tecla é enviada. Arrastar cancela a animação, mas o arquivo é completado.
- Sem o mascote: grava o arquivo inteiro e abre o VS Code (`launcher.openInEditor`).
- Mascote: `config.json` ganhou o VS Code na allowlist (`argumentosArquivo`), `permitirEscrever`, `pastaCodigo`, `velocidadeEscrita`, `escritaMaxSegundos`; bandeja → Modo de teste → "Escrever um HTML no VS Code" (ou `--teste=vscode`).
- Testes em `test/mascot.mjs` (ação, pasta, sem cercas, arquivo vazio, não sobrescreve, nome perigoso). `npm run check` passa.
- Conferido de verdade neste PC com `--teste=vscode`: andou, abriu o VS Code, pulou na janela, escreveu 1062 caracteres em ~12 s. Não conferido: a IA real escolhendo `escrever` (depende da sua chave) e o visual do VS Code recarregando (só pelo log e pelo arquivo).

## Digitação de verdade no VS Code
- Antes o arquivo aparecia em blocos (o VS Code só recarrega o disco de vez em quando). Agora o mascote digita tecla por tecla (`mascote/src/Typing.cs`, SendInput Unicode), ~55 caracteres/s com ritmo irregular e a indentação em rajada, enquanto roda a animação do notebook.
- Só digita com o VS Code na frente e ESTE arquivo ativo (pelo título); clique ou troca de janela pausa, e ao voltar ele foca o editor (Ctrl+1). Pausado mais de 45 s ou arrastado: para e completa o arquivo no disco.
- `Documentos\Jarvis Code\.vscode\settings.json` (criado uma vez) desliga fechar tags/aspas, indentação automática, sugestões, Emmet e Copilot, e liga o salvamento automático. No fim ele confere o arquivo salvo e corrige se algo saiu diferente.
- `"modoEscrita": "arquivo"` volta ao modo antigo. Conferido neste PC: 1036 caracteres digitados em ~18 s, arquivo salvo idêntico ao esperado.

## Jarvis Code
- O Jarvis agora chama o mascote de **Jarvis Code**: nas falas ("O Jarvis Code está abrindo...", "o Jarvis Code está digitando"), na personalidade da IA (Talk e Code), no painel de Integrações, nos avisos e no menu da bandeja.
- Escrevendo código com a janela flutuante aberta, o Jarvis Code anda até ela, pula em cima da moldura e digita de lá (o VS Code fica livre na tela). Sem a flutuante, sobe no VS Code como antes. Se a flutuante crescer (slides), ele acompanha.
- Conferido neste PC: andou até a flutuante, abriu o VS Code, pulou nela e digitou 1036 caracteres; arquivo conferido.

## Jarvis Code: comemoração e brincadeiras no modo Talk
- Terminou de escrever um arquivo: o Jarvis Code comemora com pulinhos no lugar, virando para um lado e para o outro (`CelebrateStep`).
- Modo Talk: o servidor avisa o modo ao Jarvis Code (evento `modo`, na conexão e quando você troca o switch). No Talk, com a janela flutuante aberta, ele vai até ela, sobe e fica brincando em cima: anda pela borda, mexe no notebook, fica pensando, dá pulinhos, com pausas sorteadas. Qualquer coisa do Jarvis (pensar, abrir, escrever) ou arrastar interrompe na hora; se ele sair para abrir um app, volta para a janela depois. No Code, segue como antes.
- Conferido neste PC: comemoração após digitar e, no Talk, as brincadeiras em cima da flutuante.

## Modo Code: clicar no navegador e instalar jogos da Steam
- **Clicar**: nova ação `clicar` ("abre o YouTube, vê minha tela e escolhe um vídeo"). Abre pelo Jarvis Code (o servidor agora espera o resultado com `mascot.waitResult`), espera a página carregar, pede uma foto, `lib/clicker.js` pede à IA a caixa do item (0–1000) ou uma recusa, e o Jarvis Code clica (`mascote/src/Clicking.cs`). Travas: só janelas de navegador da allowlist, só dentro da foto recente que ele tirou, nada por cima, UM clique, recusa de compras/pagamentos/apagar/enviar/login/permissões/downloads/anúncios, registro no audit.log. `permitirClicar` no config.json desliga.
- **Steam**: nova ação `instalar_steam` ("baixa o Hollow Knight na Steam"). `lib/steam.js` acha o id na busca pública da loja e o Jarvis abre `steam://install/<id>`; a Steam mostra a janela de instalação e você confirma. Sem login e sem senha.
- Login por você: não implementado (pedido retirado).
- Testes em `test/mascot.mjs` (abrir → foto → clique com o ponto certo, recusa, caixa inválida, Steam). `npm run check` passa.
- Conferido de verdade neste PC: "abre o youtube ve minha tela e escolhe um video pra gente ver" abriu o YouTube (no 2º monitor), a IA escolheu um vídeo e o Jarvis Code clicou nele. A Steam não foi testada de verdade (só com a loja simulada).

## Personalidade do JARVIS de volta
- `PERSONA` (lib/assistant.js) reforçada: o JARVIS do Tony Stark, levemente arrogante e sarcástico, sempre elegante; chama de "senhor" com frequência; proibido tom de atendente ("Claro! Fico feliz em ajudar!").
- O modo Code não recebia a personalidade: agora o prompt dele inclui a `PERSONA` e cada ação traz uma `fala` com o tom do JARVIS, dita antes do relato do que foi feito. O prompt de cliques (`lib/clicker.js`) também.
- Frases fixas (abrir, Jarvis Code, escrever, clicar, Steam) ganharam alfinetadas que variam (`QUIPS` no server.js).
- Conferido com a IA real: "Uma decisão brilhante, senhor, caso o seu objetivo seja parecer um zumbi deprimido amanhã cedo."

## Cliques em qualquer app
- Antes o Jarvis Code só clicava em navegadores (a IA recusava a Steam e o Jarvis Code também conferia o programa). Agora clica em qualquer app; só não clica em janelas de segurança do Windows (consent, CredentialUIBroker, LogonUI, SecHealthUI) nem atrás da janela flutuante do Jarvis.
- A ação `clicar` usa `abrir` também para trazer para a frente um app já aberto ("clica na biblioteca da steam"). Steam entrou na lista de apps que o Jarvis Code abre (`steam://open/main`).
- Em cima da janela flutuante, a foto é do monitor (antes saía a própria janela do Jarvis).
- Conferido neste PC: "clica na biblioteca da steam" trouxe a Steam para a frente e clicou na aba Biblioteca.

## Mais rápido, olhar a tela antes e o app completo
- **Velocidade**: o `gemini-3.8-flash` estava sem cota (429) e cada pedido perdia ~4 s tentando de novo antes do plano B. Novo disjuntor em `lib/router.js`: com 429 e plano B disponível, não repete; o modelo fica 5 min de lado (ou o tempo do `retry-after`) e os pedidos vão direto ao próximo. Medido: de 6,4 s para 1,2–2,7 s. Teste: `test/router.mjs`.
- **Olhar a tela antes**: com a tela disponível (Jarvis Code ou tela compartilhada), a conversa ganhou `ver_tela` ("e isso aqui?", "o que acha disso?", "resolve esse erro"): o Jarvis olha e responde vendo. No modo Code, a ação `ver_tela` faz ele tirar a foto e decidir a ação de novo, com a imagem. Testes em `test/mascot.mjs`. Conferido com a IA real.
- **App completo**: "Abrir JARVIS" (bandeja) e "Abrir completo" (janela flutuante) abrem o app (`/app`, não mais a página de guia) como janela de aplicativo, no mesmo perfil do navegador da flutuante: mesma sessão, microfone já liberado e voz sem clique. Rota `POST /api/ui/open-full` (evento `abrir_completo` para o Jarvis Desktop); sem o Jarvis Desktop, a página abre `/app` sozinha.
- Correção: o app completo abria "vazio". O Chrome guarda a posição das janelas de app pelo endereço, e ele herdava a da janela flutuante, que nasce escondida em -3000,-3000 com 430x240. Agora o Jarvis Desktop acha a janela nova e a coloca no centro do monitor principal (1280x860) e na frente (`ServerHost.PlaceAppWindow`). Conferido com foto da janela.

## 4.0: página principal primeiro, modo flutuante, switch animado e tarefas da agenda
- **Ao abrir o JarvisDesktop.exe**: abre a página principal do Jarvis (app completo). O Jarvis Code começa guardado. Novo botão **Flutuante** na barra do topo liga o modo flutuante: janela transparente ao lado + Jarvis Code na tela, e a janela grande recolhe. Clicar de novo desliga. "Abrir completo" traz a janela grande de volta, sem abrir outra. Rotas `POST /api/ui/desktop` (evento `modo_desktop`) e `POST /api/mascot/estado`; `/api/state` mostra `mascot.flutuante`. Se o modo Code pede uma ação com o Jarvis Code guardado, ele aparece para fazer.
- **Switch Talk/Code**: no Talk, um balão com pontinhos "digitando"; no Code, o Jarvis Code (os quadros do Jarvis Desktop, servidos em `/jc/walk_NN.png`) correndo de um lado para o outro sobre o ciano. Com o Code ligado, a casa muda: ponto da marca e linha de varredura ciano no topo, brilho frio no círculo e uma varredura atravessa a tela na troca. Respeita "reduzir movimento".
- **Interface**: a barra do topo não cabia em 1280 px (o botão Integrações ficava cortado e "E-mails" quebrava em duas linhas); os atalhos viram só ícones abaixo de 1480 px. Os cartões da saudação se sobrepunham quando faltava altura (as linhas do grid eram espremidas); agora cada linha tem a altura do conteúdo e o painel rola.
- **Talk recomenda o Code**: pedidos que são trabalho do Jarvis Code (clicar, escrever código, Steam) voltam com `sugerir_code` e uma recomendação com personalidade; aparece o aviso "Fazer no modo Code", que troca o modo e refaz o pedido.
- **Saudação com tarefas da agenda** (`lib/codeplan.js`): compromissos de hoje em que o Code ajuda viram o cartão "Já separei para hoje", com a tarefa, os apps necessários (só os que o Jarvis sabe abrir), "Preparar apps" (`POST /api/code/prepare`) e "Fazer no modo Code". Dizer "prepara" abre os apps. O JARVIS fala o plano logo depois da agenda.
- Testes: `test/codeplan.mjs` (novo) e `test/mascot.mjs`. Conferido no navegador (modo demonstração) e no Jarvis Desktop real.

## Abrir qualquer app instalado, sem cadastro
- `lib/launcher.js` lê a lista do menu Iniciar do Windows (`Get-StartApps`: programas, apps da Microsoft Store, jogos com atalho) quando o servidor sobe, e de novo a cada 30 min ou quando um nome não é achado (no máximo 1 leitura por minuto). Desinstaladores, ajuda/suporte, sites e links ficam de fora.
- "abre o OBS", "abre o jogo Valorant", "abre o Teams": acha pelo nome (igual, começo, todas as palavras ou o nome dentro da frase) e abre pelo Windows (`explorer.exe shell:AppsFolder\<ID>`), só com IDs que vieram da lista, nunca com texto falado. Ordem: lista fixa → apps cadastrados → sites conhecidos/domínios → apps instalados.
- Integrações mostra quantos apps foram achados; o cadastro manual fica só para programas fora do menu Iniciar. O texto "não clica e não digita" (desatualizado desde o modo Code) foi corrigido.
- Teste em `test/launcher.mjs` (lista injetada). Conferido neste PC: 134 apps; "abre a ferramenta de captura" abriu a Ferramenta de Captura.

## Olhar a tela: só quando pedido ou pelo contexto (sem a etapa extra)
- Removido o "ver_tela" (a IA decidia se olhava; custava uma chamada a mais nas frases vagas e atrasava). No lugar, regras locais sem custo: com o Jarvis Code na tela, no modo Talk, frases que apontam para algo ("isso aqui", "esse erro", "nessa janela", "aqui na tela") e perguntas genéricas curtas ("o que você acha disso?", "e isso?", "tá certo assim?", "ficou bom?") olham a tela direto, numa chamada só. Frases com assunto ("esse filme é bom?") seguem normais. `POINTS_AT_SCREEN` e `GENERIC_SCREEN_Q` em `lib/assistant.js`.

## Dois monitores
- "abre o VS Code no segundo monitor", "abra o vs code e programe no meu segundo monitor", "abre o YouTube na outra tela", "olha meu segundo monitor". Numeração: 1 = principal, depois os outros da esquerda para a direita. `monitorOf()` lê a frase (Talk e Code); no Code a IA também pode mandar `monitor`.
- O Jarvis Code anda até o monitor pedido, abre o app, leva a janela para lá e maximiza (`MoveToMonitorStep`), e pula nela; ao escrever código, digita nesse VS Code. A foto da tela e o clique podem ser de um monitor específico (`capturar {monitor}`).
- Conferido neste PC (principal 1920x1080 + segundo 1366x768 à esquerda): "abre o bloco de notas no segundo monitor" → o Jarvis Code atravessou até o segundo monitor, abriu e maximizou lá. Testes em `test/mascot.mjs`.
