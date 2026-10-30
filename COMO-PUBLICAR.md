# Como publicar o JARVIS (site na Vercel + app no seu PC)

## Como fica

| Parte | Onde roda | Chaves de API |
|---|---|---|
| **Site** (início, página do Windows, login, download) | Vercel | **nenhuma**: o site não usa IA |
| **Assistente** (conversa, voz, slides, e-mail, correio, Jarvis Code) | **o seu PC**, pelo app instalado | só no `jarvis/.env` do seu computador |
| **Instalador** (`JarvisSetup.exe`) | Release do GitHub | nenhuma (o empacotador deixa `.env`, `data/` e chaves de fora) |

Ninguém consegue usar ou roubar suas chaves pelo site: na Vercel não existe rota de IA nenhuma, e qualquer endereço do
assistente (`/app`, `/api/chat`…) responde "isso só existe no Jarvis instalado".

## 1. GitHub

1. Crie um repositório (pode ser **privado**), por exemplo `jarvis`.
2. Extraia `jarvis-github.zip` e envie o conteúdo da pasta para ele:
   ```
   git init
   git add .
   git commit -m "JARVIS: site e app"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/jarvis.git
   git push -u origin main
   ```
   O `.gitignore` já impede `.env`, `data/`, chaves, perfil, memória e executáveis de subir.

## 2. Instalador (Release)

1. No GitHub: **Releases > Draft a new release**, tag `v1.0`, e anexe o `JarvisSetup.exe` (está ao lado deste zip).
2. O link fixo do último instalador fica:
   `https://github.com/SEU-USUARIO/jarvis/releases/latest/download/JarvisSetup.exe`

> Repositório **privado**: o arquivo do Release só baixa logado no GitHub. Para outras pessoas baixarem, deixe o
> repositório público (não há segredo nenhum nele) ou hospede o `.exe` em outro lugar e troque `JARVIS_DOWNLOAD_URL`.

## 3. Vercel

1. **Add New > Project**, importe o repositório. Framework: **Other**. Não mude os comandos de build.
2. **Settings > Environment Variables > Import .env** e escolha `variaveis-vercel.env`.
   Troque `SEU-USUARIO` em `JARVIS_DOWNLOAD_URL` pelo seu usuário do GitHub.
3. **Deploy**. Abra o endereço: o site aparece. Em **Entrar**, use o e-mail e a senha de `SENHA-DO-SITE.txt`
   (depois apague esse arquivo). Em **Baixar**, o instalador do Release.

## 4. No seu PC

O app continua igual: `mascote\JarvisDesktop.exe`. As chaves ficam em `jarvis\.env` (modelo em `.env.example`).

## Atualizar depois

- **Site**: mude os arquivos, `git commit` e `git push`. A Vercel publica sozinha.
- **Instalador**: rode `mascote\build.cmd`, gere o instalador novo (Jarvis rodando no PC: `http://localhost:3000/download/JarvisSetup.exe`)
  e anexe num Release novo (o link `latest` passa a apontar para ele).

## 5. Contas de cada pessoa (Supabase)

O Supabase guarda as contas (e-mail e senha) de quem usa o site. O site só confere o login: nenhuma tabela,
nenhum dado do Jarvis vai para lá. As chaves de IA continuam só no seu PC.

1. Em **supabase.com**, entre com o GitHub e clique em **New project**.
   Nome: `jarvis`. Região: **South America (São Paulo)**. Crie uma senha do banco forte e guarde (não é usada pelo site).
2. **Project Settings > API Keys**: copie a **Publishable key** (`sb_publishable_...`; em projetos antigos, a **anon**).
   **Nunca** use a **secret**/**service_role**: o site recusa essa chave de propósito.
   Em **Project Settings > Data API** (ou na tela **Connect**), copie a **Project URL** (`https://xxxx.supabase.co`).
3. **Authentication > Sign In / Providers > Email**: deixe **Enable Email provider** e **Confirm email** ligados.
4. **Authentication > URL Configuration**:
   - **Site URL**: `https://SEU-SITE.vercel.app/entrar` (o link de confirmação leva a pessoa direto para o login);
   - **Redirect URLs**: adicione `https://SEU-SITE.vercel.app/**`.
5. (Opcional) **Authentication > Emails > Templates > Confirm signup**: traduza o e-mail. Exemplo de assunto:
   `Confirme sua conta no JARVIS`. No corpo, mantenha o `{{ .ConfirmationURL }}`.
6. Na **Vercel > Settings > Environment Variables**:
   - `SUPABASE_URL` = a Project URL;
   - `SUPABASE_ANON_KEY` = a Publishable key;
   - `JARVIS_ALLOW_SIGNUP` = `1`.
   Depois, **Deployments > ... > Redeploy** (variável nova só vale depois de publicar de novo).
7. Teste: abra `/entrar`, vá em **Criar conta**, confirme pelo e-mail e entre. **Baixar** deve abrir.

Bom saber:
- O e-mail grátis do Supabase manda poucas mensagens por hora (é para testes). Para abrir para mais gente, ligue um
  SMTP próprio em **Authentication > Emails > SMTP Settings** (o Resend tem plano grátis).
- A conta do dono (`JARVIS_OWNER_*`) continua entrando, mesmo com o Supabase fora do ar.
- Para fechar o cadastro de novo: `JARVIS_ALLOW_SIGNUP=0` e Redeploy. Quem já tem conta continua entrando.
- Para ver ou apagar contas: **Authentication > Users**.
