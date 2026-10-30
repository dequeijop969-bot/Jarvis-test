# Jarvis Desktop (app + mascote)

`JarvisDesktop.exe` é o Jarvis como aplicativo de Windows:
- **sobe o servidor** do Jarvis (se ainda não estiver rodando) e **abre o site numa janela própria** (Chrome/Edge em modo app; o microfone e o reconhecimento de voz dependem do navegador);
- mostra o **mascote** em pixel art por cima de todas as janelas. Ele pensa enquanto o Jarvis processa, anda até o app, abre o app e pula em cima da janela;
- fica na **bandeja** (perto do relógio).

## Por que C# e não Python
O Python não está instalado nesta máquina (o `python` é só o atalho da Microsoft Store). O C# com WinForms e Win32 é compilado pelo `csc.exe` que **já vem no Windows** (.NET Framework 4.8): não precisa baixar nada nem usar o PyInstaller. A janela transparente com clique-através por pixel (`UpdateLayeredWindow`), a bandeja e as APIs de janela são nativas. O resultado é um `.exe` de ~60 KB.

## Estrutura
```
mascote/
  JarvisDesktop.exe     o app (gerado pelo build.cmd)
  config.json           criado na 1ª execução (veja abaixo)
  build.cmd             compila tudo
  sprites/              walk_01..08, jump_01..08, think_01..08 (.png, fundo transparente)
    fonte/              as folhas originais (andar-pular.webp, pensar.png)
  src/
    Program.cs          bandeja, menu, atalho de teste, inicialização
    Mascot.cs           máquina de estados + passos (andar, pular, cair, agir, esperar janela)
    Overlay.cs          janela transparente sempre no topo, sem foco, fora do Alt+Tab; arrastar
    Sprites.cs          carrega os quadros, alinha pelos pés, escala inteira e espelho
    Desktop.cs          janelas e monitores (posição, app aberto?, chão abaixo)
    Actions.cs          abre apps SÓ da allowlist
    JarvisClient.cs     eventos do Jarvis (SSE) e envio do resultado
    ServerHost.cs       sobe o servidor do Jarvis e abre a janela do site
    WinApi.cs           chamadas ao Windows
    app.manifest        DPI por monitor (100%, 125%, 150%...)
  tools/SpriteCutter.cs recorta as folhas de sprites em quadros
  logs/                 mascote.log e jarvis-servidor.log
```

## Máquina de estados
```
IDLE ──pensando_inicio──▶ THINKING ──concluido / erro──▶ IDLE
  │                          │
  └─────────── acao ─────────┴──▶ (JUMPING: desce da janela, se estiver numa)
                                    ─▶ WALKING até a janela do app (se aberta) ou ao centro, sobre a barra de tarefas
                                    ─▶ ACTING: abre o app da allowlist (ou traz a janela para a frente) e espera a janela
                                    ─▶ JUMPING para a barra de título ─▶ IDLE em cima da janela

qualquer estado ──arrastar──▶ DRAGGED (ação cancelada na hora) ──soltar──▶ FALLING ──▶ IDLE (chão ou janela abaixo)
IDLE em cima de uma janela que fechou/minimizou ──▶ FALLING
```
Tudo roda na thread da interface com **um** timer (16 ms em movimento, 100 ms parado). Cancelar é esvaziar a fila de passos: não sobram threads nem timers. Se o app já tinha sido aberto quando você arrasta, ele continua aberto; só o que ainda não aconteceu é cancelado.

## Janela flutuante (falar sem abrir o app)
Bandeja → **Janela flutuante**. Abre o Jarvis em modo compacto (`/app?mini=1`) no **canto inferior esquerdo**, sempre por cima das outras, **sem barra de título**, com cantos arredondados e o fundo **levemente transparente** (`opacidadeFlutuante`, padrão 0.88):
- o círculo de falar, o switch **Talk / Code**, o que você disse e a legenda da resposta;
- quando a IA faz **slides**, a janela cresce e mostra a apresentação em miniatura (com "Esconder slides" e "Abrir completo");
- **Tab** (`atalhoFalar`) começa/para de ouvir de qualquer lugar; se a janela não estiver aberta, o atalho abre. Enquanto o atalho estiver ligado, o Tab não chega aos outros programas: pause pela bandeja (**Atalho de falar**) ou troque no config.json (ex.: `"Ctrl+Alt+F"`).

Como fica sem barra e translúcida: o navegador abre a página e o app "adota" essa janela dentro de uma moldura própria (`src/Floating.cs`); a barra do navegador fica fora da área visível. A página pede para crescer/encolher por `POST /api/ui/size`, que chega aqui como o evento `janela`.

### Modos Talk e Code
- **Talk**: a conversa de sempre, com slides. Também abre apps e sites quando você pede.
- **Code**: especializado em ações no PC. A IA só escolhe UMA ação de uma lista fechada (abrir app/site, pesquisar no Google/YouTube/imagens/Maps/Wikipédia/GitHub, abrir um endereço https, olhar a tela, **escrever um arquivo de código**) e o servidor valida e executa pelo mascote. Não clica e não roda comandos.

### Escrever código no VS Code (modo Code)
Diga, no modo Code: "abre o VS Code e cria um html de uma calculadora", "escreve um script python que renomeia fotos", "faz um site sobre gatos".
1. A IA escreve o conteúdo; o Jarvis cria um arquivo **novo e vazio** em `Documentos\Jarvis Code` (`index.html`, `index-2.html`...; nunca sobrescreve nada; só extensões de código/texto, nada de `.bat`/`.ps1`/`.exe`).
2. O Jarvis Code (é assim que o Jarvis chama o mascote) anda, abre o VS Code com a pasta e o arquivo e pula **em cima da janela flutuante do Jarvis** (se ela estiver aberta; senão, em cima do VS Code), deixando o editor livre. Lá ele **pega o notebook**: enquanto roda a animação do notebook (mãos rápidas, rostinho trocando), ele **digita de verdade**, tecla por tecla, num ritmo rápido e irregular (~55 caracteres/s; a indentação sai de rajada).
3. Proteções da digitação:
   - só digita se a janela da frente for o VS Code **com esse arquivo ativo**; clicou em algo ou trocou de janela? Ele pausa e, quando o VS Code volta com o arquivo, foca o editor (Ctrl+1) e continua;
   - a pasta `Jarvis Code` ganha um `.vscode/settings.json` (criado uma vez) que desliga o que bagunçaria o texto: fechar tags/aspas/parênteses, indentar sozinho, sugestões, Emmet, Copilot. Também liga o salvamento automático. Vale só para essa pasta;
   - no fim, ele confere o arquivo salvo e, se algo saiu diferente, grava o conteúdo certo (o VS Code recarrega);
   - arrastar o mascote (ou dar outro comando) para a digitação na hora, e o arquivo é completado no disco; pausado por mais de 45 s, idem.
   - Prefere sem teclas? `"modoEscrita": "arquivo"` no config.json volta ao modo antigo (grava o arquivo em pedaços).
   - Na primeira vez, o VS Code pode perguntar se você confia na pasta `Jarvis Code`: responda e ele começa a digitar.
- Sem o mascote conectado, o Jarvis grava o arquivo inteiro e abre o VS Code direto.
- Teste sem o Jarvis: bandeja → Modo de teste → **Escrever um HTML no VS Code**, ou `--teste=vscode`.
- Dica: deixe o arquivo sem editar enquanto ele escreve (com alterações não salvas, o VS Code não recarrega).
- O switch fica na janela flutuante e na barra do app completo; a escolha é salva no perfil.

Ela usa um perfil próprio do navegador (pasta `navegador-flutuante`) para a voz tocar sem precisar de um clique antes; na primeira vez, o navegador pede o microfone nessa janela. Com `abrirFlutuante: true`, o app abre a flutuante ao iniciar, no lugar da janela grande (a bandeja grava essa escolha).

## Notebook e passeio (ocioso)
- **Abrindo um app** (enquanto espera a janela aparecer): ele mexe no notebook.
- **Parado 1 minuto** sem nada acontecer: pega o notebook e fica digitando (`ociosoNotebook`, em segundos).
- **Parado 2 minutos**: sai andando à toa até 1 a 3 pontos do monitor, com pausas, e volta a ficar parado (`ociosoPasseio`). Se estiver em cima de uma janela, desce antes.
- Qualquer coisa do Jarvis (pensar, abrir, ler a tela) ou arrastar interrompe na hora. Use `0` para desligar cada um.
- Os quadros `notebook_01..48.png` (6 expressões × 8 quadros) são gerados por `tools/NotebookFrames.cs` a partir do `think_01` original (o boneco é o mesmo; as mãos são dois cubos pretos digitando rápido, a 12 quadros/s, e o rosto troca devagar entre concentrado, normal, determinado, feliz e assustado, com piscadas rápidas, seguindo `notebook_expressoes.txt` (grupo e segundos; dá para editar à mão); o notebook é cinza, de perfil, e a tela solta uma luz azulada fraca que oscila); `notebook_ancora.txt` guarda onde ficam os pés. Sem esses arquivos, ele usa o pensar.
- Teste: bandeja → Modo de teste → "Mexer no notebook" / "Passear", ou `--teste-ocioso=notebook|passeio`.

## Ler a tela onde o mascote está
Diga "olha minha tela", "o que tem nessa janela?" ou "me explica esse erro". Se você não compartilhou a tela pelo navegador, o Jarvis pede ao mascote **uma** foto:
- da **janela em que ele está em pé**;
- do **monitor onde ele está**, se ele estiver no chão.

O mascote não aparece na foto. Ela vai só para o Jarvis no seu PC, que a manda para a IA (Gemini/Anthropic) junto com a pergunta e não grava nada. Os comentários seguintes, por 4 minutos, continuam sobre a tela. Para desligar: `"permitirLerTela": false` no config.json. Ele só **olha**: não clica nem digita.

## Protocolo com o Jarvis
- O mascote conecta em `GET /api/mascot/events?apps=<apelidos>` (SSE) com o cabeçalho `x-jarvis: 1`. Páginas de outros sites não conseguem enviar esse cabeçalho.
- Eventos:
  - `pensando_inicio {}`
  - `acao {"id","acao":"abrir_app","alvo":"bloco de notas"}`
  - `acao {"id","acao":"abrir_url","alvo":"navegador","url":"https://..."}`
  - `acao {"id","acao":"escrever","alvo":"vs code","arquivo":"C:\\...\\Jarvis Code\\index.html","conteudo":"..."}` (só se o mascote conectou com `escrever=1`; ele confere de novo a pasta, o nome, a extensão e que o arquivo está vazio)
  - `concluido {}`
  - `erro {"mensagem"}`
  - `capturar {"id"}`: o mascote responde em `POST /api/mascot/capture {"id","image":"data:image/jpeg;base64,...","janela"}`
- O resultado volta por `POST /api/mascot/result {"id","status":"ok|cancelado|erro|nao_permitido","detalhe"}`.
- O Jarvis só delega o que o mascote declarou saber abrir. Sem o mascote conectado, ou com um app fora da lista dele, o Jarvis abre do jeito antigo.

**Mudanças no Jarvis:** `lib/mascot.js` (novo), mais três pontos em `server.js` (avisos na conversa, delegação do "abrir" e as duas rotas) e uma linha de status no painel. Teste: `test/mascot.mjs`.

## config.json
| Campo | O que faz |
|---|---|
| `jarvisUrl` | endereço do Jarvis (padrão `http://localhost:3000`) |
| `pastaJarvis` | pasta do Jarvis, para subir o servidor (padrão `..\jarvis`) |
| `iniciarServidor` / `abrirAppAoIniciar` | sobe o servidor / abre a janela do site ao iniciar |
| `navegadorApp` | `chrome` ou `msedge` (janela do site) |
| `pastaSprites` | pasta com os PNGs (troque pelos seus quando quiser) |
| `escala` | escala inteira a 100% de DPI (em 125%/150% vira o inteiro mais próximo) |
| `fps.andar` / `fps.pular` / `fps.pensar` / `fps.notebook` | velocidade de cada animação |
| `ociosoNotebook` / `ociosoPasseio` | segundos parado até pegar o notebook / sair passeando (0 = nunca) |
| `velocidadeAndar` | pixels por segundo (a 100%) |
| `pensarEntrada` / `pensarLoop` | ordem dos quadros do pensar (padrão: 1–2 uma vez, depois 3–8 em loop) |
| `atalhoFalar` / `abrirFlutuante` / `opacidadeFlutuante` | atalho global para falar com a janela flutuante (padrão `Tab`; aceita tecla sozinha) / abrir a flutuante ao iniciar / opacidade da moldura (0.3 a 1) |
| `atalhoTeste` | atalho global do modo de teste (padrão `Ctrl+Alt+J`) |
| `permitirEscrever` / `pastaCodigo` | modo Code pode escrever arquivos novos (padrão sim) / pasta deles (padrão `%USERPROFILE%\Documents\Jarvis Code`; se mudar, use o mesmo valor em `JARVIS_CODE_DIR` no `.env` do Jarvis) |
| `modoEscrita` | `digitar` (padrão: teclas uma a uma no VS Code) ou `arquivo` (grava o arquivo em pedaços, sem teclas) |
| `velocidadeDigitacao` / `velocidadeEscrita` / `escritaMaxSegundos` | caracteres por segundo digitando (padrão 55) / gravando em pedaços (padrão 90) / arquivos grandes aceleram para terminar nesse tempo (padrão 40) |
| `apps` | **allowlist**: `chave`, `nome`, `apelidos`, `comando` (aceita `%VARIAVEIS%`), `argumentos`, `argumentosUrl` (`{url}`), `argumentosArquivo` (`{pasta}` `{arquivo}`, só o VS Code), `janela.processos` e `janela.titulos` (como reconhecer a janela) |

Para incluir um app: copie um item de `apps`, coloque o caminho do `.exe` em `comando`, os nomes falados em `apelidos` e o nome do processo em `janela.processos`. O Jarvis só manda abrir pelo mascote o que estiver aqui.

## Como rodar
1. Compile (só precisa uma vez, ou depois de mudar o código):
   ```bash
   build.cmd
   ```
2. Dê dois cliques em `JarvisDesktop.exe`. Ele sobe o servidor do Jarvis se não estiver rodando, abre a janela do site e mostra o mascote no canto inferior direito.
3. **Modo de teste sem o Jarvis:** `Ctrl+Alt+J`, ou na bandeja: Modo de teste → Abrir o Bloco de Notas.
4. Fale com o Jarvis: "abre o bloco de notas", "abre a calculadora", "abre o YouTube".
5. Arraste o mascote a qualquer momento: a ação é cancelada e ele cai no chão (ou na janela embaixo). Com o botão direito sobre ele, abre o menu.

Opções: `--sem-janela` (não abre a janela do site), `--sem-jarvis`, `--teste=notepad|calc|navegador`, `--teste-arrastar=4000`, `--sair-apos=30`.

## Empacotar / levar para outro PC
Não precisa de PyInstaller: o `JarvisDesktop.exe` já é o executável e roda em qualquer Windows 10/11 (o .NET Framework 4.8 vem no sistema). Para levar, copie a pasta `mascote` (exe + `config.json` + `sprites`) e a pasta `jarvis` ao lado. Para iniciar com o Windows, crie um atalho do exe em `shell:startup`.

## Testado
- Autoteste real neste PC: pensar → andar → abrir o Bloco de Notas → pular na janela (recorte de tela conferido: nítido, em pé na borda).
- Arrastar no meio da caminhada cancela (a Calculadora não abriu), cai e volta ao ocioso.
- Ponta a ponta com o Jarvis (demo): "abre a calculadora" → o Jarvis delega → o mascote anda, abre e sobe na janela da Calculadora (app da Loja, reconhecida pelo título).
- O app sobe o servidor sozinho e o encerra ao sair.
- **Não testado:** monitores múltiplos e DPI 125%/150% de verdade (esta máquina tem um monitor a 100%), e a janela do site em modo app.

## Próximos passos
- Animação de "falando" sincronizada com a voz (o site avisaria o mascote quando começa e termina de falar).
- Balão de texto com a resposta curta do Jarvis.
- Quadros próprios de ocioso (piscar, olhar para os lados) e de "comemorar" ao chegar.
- Ícone e instalador (por exemplo, Inno Setup), se quiser distribuir.

## Comemorar e brincar (Jarvis Code)
- Quando termina de escrever um arquivo no VS Code, o Jarvis Code comemora com pulinhos.
- No **modo Talk**, com a janela flutuante aberta, ele mora em cima dela: anda pela borda, mexe no notebook, pensa e dá pulinhos, com pausas. Se for chamado para alguma coisa (abrir um app, ler a tela), vai e depois volta. No modo Code, fica onde estiver, como antes.

## Clicar em qualquer app (modo Code)
Diga, no modo Code: "abre o YouTube, vê minha tela e escolhe um vídeo pra gente ver", "clica na biblioteca da Steam", "clica no primeiro resultado".
1. Se o pedido cita um app ou site, o Jarvis Code abre (ou traz para a frente, se já estiver aberto) e sobe na janela; o Jarvis espera carregar.
2. Ele tira UMA foto da janela (ou do monitor, se estiver no chão ou em cima da janela do Jarvis); a IA escolhe onde clicar (caixa 0–1000 na foto).
3. O Jarvis Code confere e clica em **qualquer app**: a foto tem que ser dele e recente (2 min), e o ponto não pode cair numa janela de segurança do Windows (aviso de administrador, pedido de senha, tela de login, Segurança do Windows) nem atrás da janela flutuante do Jarvis. Ele pula ao lado do ponto, clica UMA vez e o cursor volta para onde estava.
- A IA recusa cliques para comprar, pagar, assinar, apagar, enviar, publicar, comentar, curtir/seguir, fazer login, digitar senha, permitir, baixar/instalar, anúncios e configurações.
- Desligar: `"permitirClicar": false` no config.json (também desliga se `permitirLerTela` for false).

## Tarefas de vários passos (modo Code)
Diga: "no meu segundo monitor abre o Discord e entra na chamada do servidor Sei lá", "abre a Steam e inicia o Geometry Dash", "olha minha tela e resolve esse problema".
1. O Jarvis planeja: abre o app (no monitor pedido) e, a cada passo, tira UMA foto do monitor inteiro, raciocina sobre o que vê e manda UM passo ao Jarvis Code: clicar (ou clique duplo), rolar, digitar, apertar uma tecla, abrir algo ou esperar. Depois olha de novo para conferir, até concluir (no máximo 12 passos / 2,5 min).
2. Jogos da Steam: a Steam inicia o jogo direto (`steam://rungameid/<id>`), sem cliques.
- **Digitar**: só palavras que **você falou no pedido** (o nome do servidor, do jogo...). Nada lido da tela é digitado, nem senhas. Só na janela da frente, nunca na do próprio Jarvis nem em janelas de segurança do Windows; se a janela da frente mudar no meio, ele para.
- **Teclas**: só uma lista fixa (Enter, Esc, Tab, setas, Page Up/Down, Home/End, F5, Ctrl+K/F/L/A/T, Alt+←). Nada de Win, Alt+F4 ou Delete.
- A IA desiste (e explica o caminho) se o próximo passo for comprar, apagar, enviar mensagem, fazer login, autorizar, instalar programas ou mexer em configurações do Windows.
- **Cancelar**: arraste o Jarvis Code. Repetir o mesmo passo 3 vezes também encerra.
- Desligar só o teclado/rolagem: `"permitirTeclado": false` (cliques continuam). O Discord já vem na lista de apps.

## Instalar jogos da Steam (modo Code)
"baixa o Hollow Knight na Steam pra mim": o Jarvis acha o jogo na loja da Steam e pede ao app da Steam a janela de instalação (`steam://install/<id>`). Você confirma lá. Ele não faz login nem digita senhas: a Steam já fica logada no seu PC. Se o jogo não estiver na sua biblioteca, a Steam mostra a página da loja.

## App completo
- "Abrir JARVIS" (bandeja) e "Abrir completo" (janela flutuante) abrem o app em janela própria, sem abas, no mesmo perfil do navegador da janela flutuante (`navegador-flutuante`): mesma sessão, microfone liberado e voz sem clique.

## Ao abrir (4.0)
- O JarvisDesktop.exe abre a página principal do Jarvis. O modo flutuante (janela transparente ao lado + Jarvis Code) liga pelo botão **Flutuante** da barra do topo ou pela bandeja; ao ligar, a janela grande recolhe, e "Abrir completo" a traz de volta.
- O Jarvis Code começa guardado e aparece com o modo flutuante, ou sozinho quando o modo Code pede uma ação.
