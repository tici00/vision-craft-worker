# Vision Craft Worker

Worker independente de processamento de mídia para o projeto Vision Craft.

## Estado atual

O worker mantém os endpoints legados e agora também possui um fluxo assíncrono de renderização por URL.

### Já disponível

- verificação da API e do FFmpeg;
- autenticação por `VIDEO_WORKER_TOKEN`;
- extração de áudio via multipart;
- renderização de cortes via multipart (legado);
- criação de jobs assíncronos por `videoUrl`;
- download do vídeo por streaming para disco temporário;
- um único download do vídeo por job;
- progresso por corte;
- resultado parcial quando apenas parte dos cortes falha;
- retry dos cortes que falharam.

### Ainda não é produção

- persistência dos jobs fora da memória do processo;
- armazenamento persistente dos vídeos e cortes;
- recuperação automática de jobs após reinício do worker;
- fila distribuída/concurrency control;
- limpeza programada de resultados;
- transcrição, análise multimodal e seleção inteligente dentro do worker.

## Executar localmente

1. Copie `.env.example` para `.env`.
2. Troque `VIDEO_WORKER_TOKEN` por um token longo e secreto.
3. Execute:

```bash
npm install
npm run dev
```

Validação:

```bash
npm run typecheck
npm run build
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

### POST /render-jobs

Cria uma renderização assíncrona sem reenviar o arquivo inteiro ao worker.

Header:

```text
x-worker-token: SEU_TOKEN
Content-Type: application/json
```

Body:

```json
{
  "videoUrl": "https://storage.example/video.mp4",
  "clips": [
    {"start": 120, "end": 165, "name": "corte-1"},
    {"start": 420, "end": 470, "name": "corte-2"}
  ]
}
```

A resposta é `202 Accepted` com um `jobId`. O worker baixa o vídeo uma única vez e processa os cortes localmente.

### GET /render-jobs/:id

Consulta o estado do job.

Exemplo de resposta durante o processamento:

```json
{
  "ok": true,
  "job": {
    "id": "...",
    "status": "rendering",
    "progress": 50,
    "completed": 1,
    "failed": 0,
    "total": 2,
    "clips": []
  }
}
```

Estados do job: `queued`, `downloading`, `rendering`, `completed`, `partial` e `failed`.

### POST /render-jobs/:id/retry

Repete somente os cortes que falharam no job.

### POST /render-clips (legado)

Continua disponível para compatibilidade com a integração atual. Recebe o vídeo diretamente via multipart e mantém o comportamento síncrono anterior.

## Limitações importantes

O armazenamento dos jobs ainda é em memória. Um reinício do processo perde o estado dos jobs em andamento. Por isso, o Vision Craft ainda não deve migrar para `/render-jobs` em produção até que a persistência e o armazenamento definitivo estejam integrados.

O `videoUrl` precisa ser acessível pelo worker. Para produção, a integração deve fornecer uma URL temporária/assinada do armazenamento privado do Vision Craft, e não uma URL pública permanente.
