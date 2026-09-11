import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { v4 as uuid } from "uuid";

const DEFAULT_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 15 * 60 * 1000);
const DEFAULT_MAX_MB = Number(process.env.MAX_REMOTE_VIDEO_MB || 4096);

function validateRemoteUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("A URL do vídeo é inválida."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("A URL do vídeo precisa usar HTTP ou HTTPS.");
  return url;
}

export async function downloadVideo(urlValue: string, destinationDir: string) {
  const url = validateRemoteUrl(urlValue);
  await fsPromises.mkdir(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, `${uuid()}-source`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`Falha ao baixar o vídeo (HTTP ${response.status}).`);

    const maxBytes = DEFAULT_MAX_MB * 1024 * 1024;
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`O vídeo excede o limite remoto de ${DEFAULT_MAX_MB} MB.`);
    }

    let received = 0;
    // Node's fetch exposes a Web ReadableStream whose TypeScript generic differs
    // slightly from the Node stream definitions. The runtime conversion is safe.
    const source = Readable.fromWeb(response.body as any);
    source.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) controller.abort();
    });
    await pipeline(source, fs.createWriteStream(destination));
    return destination;
  } catch (error) {
    await fsPromises.unlink(destination).catch(() => {});
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("O download do vídeo excedeu o tempo limite ou o tamanho máximo.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
