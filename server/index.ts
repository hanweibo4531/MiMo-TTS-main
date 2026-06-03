import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BUILTIN_VOICES,
  MIMO_BASE_URL_DEFAULT,
  MODEL_OPTIONS,
  TtsValidationError,
  buildMimoPayload,
  collectPcmFromStream,
  extractErrorDetail,
  extractNonStreamingAudioBase64,
  mapMimoError,
  pcm16ToWav,
  sanitizePayload
} from "./mimo.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: "14mb" }));

app.get("/api/status", (_req, res) => {
  res.json({
    configured: Boolean(getApiKey()),
    baseUrl: getBaseUrl(),
    models: MODEL_OPTIONS,
    voices: BUILTIN_VOICES
  });
});

app.post("/api/config", async (req, res) => {
  try {
    const apiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
    const baseUrl = typeof req.body.baseUrl === "string" ? req.body.baseUrl.trim() : "";

    if (!apiKey && !getApiKey()) {
      throw new TtsValidationError("请填写 API Key。", "MIMO_API_KEY_REQUIRED");
    }

    if (baseUrl) {
      try {
        new URL(baseUrl);
      } catch {
        throw new TtsValidationError("Base URL 格式不正确。", "MIMO_BASE_URL_INVALID");
      }
    }

    if (apiKey) {
      process.env.MIMO_API_KEY = apiKey;
    }
    const nextBaseUrl = baseUrl || MIMO_BASE_URL_DEFAULT;
    process.env.MIMO_BASE_URL = nextBaseUrl;

    await saveEnvConfig({
      ...(apiKey ? { MIMO_API_KEY: apiKey } : {}),
      MIMO_BASE_URL: nextBaseUrl,
      PORT: String(port)
    });

    res.json({
      configured: Boolean(getApiKey()),
      baseUrl: getBaseUrl(),
      models: MODEL_OPTIONS,
      voices: BUILTIN_VOICES
    });
  } catch (error) {
    sendAppError(res, error);
  }
});

app.post("/api/tts", async (req, res) => {
  const startedAt = Date.now();

  try {
    const payload = buildMimoPayload({ ...req.body, stream: false });
    const response = await callMimo(payload);

    if (!response.ok) {
      return sendMimoError(res, response);
    }

    const json = await response.json();
    const audioBase64 = extractNonStreamingAudioBase64(json);

    res.json({
      audio: {
        mimeType: "audio/wav",
        dataUrl: `data:audio/wav;base64,${audioBase64}`,
        bytes: Buffer.byteLength(audioBase64, "base64")
      },
      durationMs: Date.now() - startedAt,
      requestPreview: sanitizePayload(payload)
    });
  } catch (error) {
    sendAppError(res, error);
  }
});

app.post("/api/tts/stream", async (req, res) => {
  const startedAt = Date.now();

  try {
    const payload = buildMimoPayload({ ...req.body, stream: true });
    const response = await callMimo(payload);

    if (!response.ok) {
      return sendMimoError(res, response);
    }

    const contentType = response.headers.get("content-type") ?? "";
    let pcm: Buffer;

    if (contentType.includes("application/json")) {
      const json = await response.json();
      pcm = Buffer.from(extractNonStreamingAudioBase64(json), "base64");
    } else if (response.body) {
      pcm = await collectPcmFromStream(response.body);
    } else {
      throw new TtsValidationError("MiMo 流式响应为空。", "STREAM_BODY_MISSING", 502);
    }

    if (pcm.length === 0) {
      throw new TtsValidationError("MiMo 流式响应中没有找到 PCM 音频数据。", "STREAM_AUDIO_MISSING", 502);
    }

    const wav = pcm16ToWav(pcm);

    res.json({
      audio: {
        mimeType: "audio/wav",
        dataUrl: `data:audio/wav;base64,${wav.toString("base64")}`,
        bytes: wav.length
      },
      durationMs: Date.now() - startedAt,
      requestPreview: sanitizePayload(payload),
      warnings: ["MiMo-V2.5-TTS 当前为流式兼容模式，结果会在推理完成后一次性返回。"]
    });
  } catch (error) {
    sendAppError(res, error);
  }
});

app.listen(port, () => {
  console.log(`MiMo TTS API proxy listening on http://localhost:${port}`);
});

async function callMimo(payload: unknown): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new TtsValidationError("未配置 MIMO_API_KEY，请先复制 .env.example 为 .env 并填写 Key。", "MIMO_API_KEY_MISSING", 500);
  }

  return fetch(`${getBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify(payload)
  });
}

async function sendMimoError(res: express.Response, response: Response) {
  const body = await response.text();
  res.status(response.status).json({
    error: mapMimoError(response.status),
    detail: extractErrorDetail(body),
    status: response.status
  });
}

function sendAppError(res: express.Response, error: unknown) {
  if (error instanceof TtsValidationError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      status: error.status
    });
  }

  console.error(error);
  res.status(500).json({
    error: "本地代理处理失败，请查看终端日志。",
    status: 500
  });
}

function getApiKey(): string | undefined {
  return process.env.MIMO_API_KEY?.trim() || undefined;
}

function getBaseUrl(): string {
  return (process.env.MIMO_BASE_URL?.trim() || MIMO_BASE_URL_DEFAULT).replace(/\/$/, "");
}

async function saveEnvConfig(values: Record<string, string>) {
  const envPath = path.join(process.cwd(), ".env");
  const existing = await readEnvFile(envPath);
  const lines = existing ? existing.split(/\r?\n/) : [];
  const pending = new Map(Object.entries(values));
  const nextLines = lines.map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match || !pending.has(match[1])) {
      return line;
    }

    const value = pending.get(match[1]) ?? "";
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });

  for (const [key, value] of pending) {
    nextLines.push(`${key}=${value}`);
  }

  await writeFile(envPath, `${nextLines.filter((line, index) => line || index < nextLines.length - 1).join("\n")}\n`, "utf8");
}

async function readEnvFile(envPath: string): Promise<string> {
  try {
    return await readFile(envPath, "utf8");
  } catch {
    return "";
  }
}
