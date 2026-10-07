# JARVIS

Assistente de IA por voz, em português do Brasil, com alma de mordomo digital: você fala, ele pensa (Gemini ou Anthropic), responde com voz (ElevenLabs) e apresenta slides narrados com legendas sincronizadas e gráficos em SVG. Roda só no seu computador (localhost).

O nome vive em uma constante só: `ASSISTANT_NAME` em `lib/config.js`.

## Como rodar
1. Instale o Node.js 20.6 ou mais novo.
2. Copie `.env.example` para `.env` (pode ficar quase vazio: as chaves também podem ser salvas pela interface).
3. `npm start` e abra **http://localhost:3000** no **Chrome ou Edge**.
4. Preencha o perfil (nome, tratamento, cidade, idioma), conecte o Gmail se quiser, toque em **Iniciar**.

Sem nenhuma chave? `npm run demo` sobe tudo com serviços simulados (IA, voz muda, Gmail falso com um e-mail suspeito, clima).
- `DEMO_FAIL=gemini npm run demo`: o Gemini cai e você vê o plano B (chip "plano B" no topo).
- `DEMO_TTS=fallback` (sem timestamps) e `DEMO_TTS=off` (sem voz).
- Na demo, fale algo com "falha" para derrubar o Gemini só naquele pedido.

`npm run check`: sintaxe + testes unitários + teste de aceitação completo (sem internet).

## Onde pegar as chaves
- **Gemini**: aistudio.google.com, em "Get API key".
- **Anthropic**: console.anthropic.com, em API Keys.
- **ElevenLabs**: elevenlabs.io, em Developers > API Keys. O ID da voz fica na página da voz ("Copy voice ID").

Salve em **Integrações** (barra no topo) e use **Testar**. Elas ficam em `data/keys.local.json` (permissão 600, fora do git). O `.env` continua valendo como alternativa; a chave salva pela interface tem prioridade.

## Google (Gmail e Agenda): passo a passo no Google Cloud
1. Entre em console.cloud.google.com e **crie um projeto** (ex.: "jarvis-local").
2. Em **APIs e serviços > Biblioteca**, ative a **Gmail API** e a **Google Calendar API**.
3. Em **Tela de consentimento OAuth** (Google Auth Platform): tipo **Externo**, nome do app, seu e-mail de suporte e de contato.
4. Em **Acesso a dados / Escopos**, adicione `gmail.modify` (ler e mover para a lixeira), `calendar.readonly` (ler a agenda) e `calendar.events` (criar compromissos, sempre com confirmação). Se você já tinha conectado antes, adicione os escopos novos e **reconecte** em Integrações.
5. Em **Público-alvo**, deixe em **Teste** e adicione seu e-mail como **usuário de teste**.
6. Em **Clientes / Credenciais > Criar ID do cliente OAuth**: tipo **Aplicativo da Web**, URI de redirecionamento autorizado: `http://localhost:3000/auth/google/callback` (troque a porta se mudou `PORT`).
7. Copie o ID e o segredo para o `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) e reinicie.
8. Na interface: **Integrações > Gmail > Conectar**. O Google vai avisar que o app não é verificado: é o seu próprio app, pode continuar.

**Atenção**: em modo de teste o login expira em cerca de **7 dias**. Quando expirar, o JARVIS avisa e é só conectar de novo.

O JARVIS lê apenas remetente, assunto, data, trecho e cabeçalhos de autenticação (SPF/DKIM/DMARC). O corpo só é lido quando você pede "abrir esse", e nunca é guardado. Nada é enviado, apagado, arquivado ou alterado.

## Canva
A estrutura OAuth (Canva Connect, com PKCE) está pronta, mas aparece como **"em breve"**: nenhuma função usa o Canva ainda. Para testar o login, crie uma integração em canva.dev (exige MFA), use o redirect `http://127.0.0.1:3000/auth/canva/callback` (o Canva não aceita "localhost") e preencha `CANVA_CLIENT_ID`/`CANVA_CLIENT_SECRET`. Integrações privadas exigem plano Enterprise; confira os requisitos atuais.

## Modelos (`models.config.json`)
Os níveis JARVIS 1.0, 2.5 e 5.1 são apelidos. Cada um aponta para provedor + modelo + raciocínio + plano B. Hoje:
- **2.5** = `gemini-3.8-flash`, raciocínio `low` (esse modelo não aceita `minimal`), plano B `gemini-3.5-flash-lite`.
- **1.0** e **5.1** = "a definir". Confira os IDs atuais na documentação do provedor e preencha.
- **Reserva** = Anthropic `claude-sonnet-5-5`. **Confira esse ID** na documentação da Anthropic antes de depender dele.

A configuração é validada ao iniciar; níveis sem modelo aparecem como "sem modelo" no seletor.

## Comandos de voz
- Conversa livre: pergunte qualquer coisa; assuntos maiores viram slides.
- E-mails: "próximo", "abrir esse", "ignorar", "ver os outros", "fechar tudo".
- Agenda: "o que tenho hoje / amanhã / na semana", "quando estou livre"; para criar: "marca reunião com a Ana amanhã às 15h" (ele confirma antes: diga "confirmo" ou toque em Confirmar).
- GitHub: "tenho pull request para revisar?", "ler meus repositórios", "fala do repositório jarvis-app", "últimos commits do jarvis-app".
- Tela: "olha minha tela"; os comentários seguintes continuam sobre ela. "Para de ver minha tela" encerra.
- Memória: "esqueça isso", "esqueça tudo", "o que você lembra de mim?".
- Toque no círculo para interromper; Esc encerra.

## Arquivos locais (todos fora do git, em `data/`)
`profile.json`, `keys.local.json`, `tokens.local.json`, `memory.json` (turnos, resumo, preferências e resumos curtos de e-mails por 7 dias).

## Várias contas da ElevenLabs (fallback)

No `.env`, preencha `ELEVENLABS_API_KEY`, `ELEVENLABS_API_KEY_2`, `_3` e `_4`. A primeira é usada sempre; a próxima só entra quando a anterior falha (sem créditos, limite de uso, chave inválida ou instabilidade). O `ELEVENLABS_VOICE_ID` vale para todas; se a voz for diferente em alguma conta, use `ELEVENLABS_VOICE_ID_2`, `_3`, `_4`.
