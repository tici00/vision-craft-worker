# Vision Craft Worker

Worker independente de processamento de mídia para o projeto Vision Craft.

## O que esta primeira versão já faz

- verifica se o FFmpeg está funcionando;
- protege os endpoints com `VIDEO_WORKER_TOKEN`;
- recebe vídeos via multipart;
- extrai áudio em MP3;
- recebe uma lista de timestamps;
- renderiza cortes reais em MP4;
- não impõe limite artificial de duração;
- apaga o arquivo original temporário após o processamento.

## O que ainda será implementado depois

- fila persistente de jobs;
- progresso em tempo real;
- download do vídeo por URL segura, sem reupload entre Vision Craft e worker;
- armazenamento persistente dos arquivos;
- limpeza programada dos resultados;
- transcrição com timestamps;
- análise multimodal;
- seleção inteligente de candidatos;
- renderização de highlights e vídeo longo;
- formatos verticais e layouts com webcam;
- retries e recuperação de falhas.

## Executar localmente

1. Copie `.env.example` para `.env`.
2. Troque `VIDEO_WORKER_TOKEN` por um token longo e secreto.
3. Execute:

```bash
npm install
npm run dev
```

Teste:

```text
GET http://localhost:10000/health
```

## Docker

```bash
docker build -t vision-craft-worker .
docker run --rm -p 10000:10000 \
  -e VIDEO_WORKER_TOKEN=SEU_TOKEN_SECRETO \
  vision-craft-worker
```

## Endpoints

### GET /health

Verifica a API e o FFmpeg.

### POST /extract-audio

Header:

```text
x-worker-token: SEU_TOKEN
```

Multipart:

```text
video: arquivo de vídeo
```

### POST /render-clips

Header:

```text
x-worker-token: SEU_TOKEN
```

Multipart:

```text
video: arquivo de vídeo
clips: [{"start":120,"end":165},{"start":420,"end":470}]
```

## Importante

Esta versão é o motor inicial para provar o processamento real. Para conectar ao Vision Craft com vídeos grandes, o próximo passo será substituir o envio direto do arquivo por URLs seguras de armazenamento e transformar o processamento em jobs assíncronos.
