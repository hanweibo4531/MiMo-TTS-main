export type TtsMode = "builtin" | "design" | "clone";
export type OutputMode = "normal" | "stream";

export const MIMO_BASE_URL_DEFAULT = "https://token-plan-cn.xiaomimimo.com/v1";
export const MAX_CLONE_BASE64_LENGTH = 10 * 1024 * 1024;
export const PCM_SAMPLE_RATE = 24000;

export const BUILTIN_VOICES = [
  { id: "mimo_default", name: "MiMo-默认", language: "自动", gender: "" },
  { id: "冰糖", name: "冰糖", language: "中文", gender: "女" },
  { id: "茉莉", name: "茉莉", language: "中文", gender: "女" },
  { id: "苏打", name: "苏打", language: "中文", gender: "男" },
  { id: "白桦", name: "白桦", language: "中文", gender: "男" },
  { id: "Mia", name: "Mia", language: "English", gender: "Female" },
  { id: "Chloe", name: "Chloe", language: "English", gender: "Female" },
  { id: "Milo", name: "Milo", language: "English", gender: "Male" },
  { id: "Dean", name: "Dean", language: "English", gender: "Male" }
] as const;

export const MODEL_OPTIONS = [
  {
    mode: "builtin",
    model: "mimo-v2.5-tts",
    label: "内置音色",
    requiresVoice: true
  },
  {
    mode: "design",
    model: "mimo-v2.5-tts-voicedesign",
    label: "VoiceDesign",
    requiresVoice: false
  },
  {
    mode: "clone",
    model: "mimo-v2.5-tts-voiceclone",
    label: "VoiceClone",
    requiresVoice: true
  }
] as const;

const MODEL_BY_MODE = {
  builtin: "mimo-v2.5-tts",
  design: "mimo-v2.5-tts-voicedesign",
  clone: "mimo-v2.5-tts-voiceclone"
} satisfies Record<TtsMode, string>;

export type Role = "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface CloneSample {
  fileName?: string;
  mimeType?: string;
  base64?: string;
}

export interface TtsBuildInput {
  mode: TtsMode;
  text: string;
  stylePrompt?: string;
  voice?: string;
  cloneSample?: CloneSample;
  stream?: boolean;
}

export interface MimoPayload {
  model: string;
  messages: ChatMessage[];
  audio: {
    format: "wav" | "pcm16";
    voice?: string;
  };
  stream?: true;
}

export class TtsValidationError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = "VALIDATION_ERROR", status = 400) {
    super(message);
    this.name = "TtsValidationError";
    this.status = status;
    this.code = code;
  }
}

export function buildMimoPayload(input: TtsBuildInput): MimoPayload {
  const text = normalizeRequired(input.text, "请输入需要合成的文本。");
  const stylePrompt = input.stylePrompt?.trim() ?? "";
  const stream = input.stream === true;
  const messages: ChatMessage[] = [];

  if (input.mode === "design" && !stylePrompt) {
    throw new TtsValidationError("VoiceDesign 模式需要填写音色描述。", "VOICE_DESIGN_PROMPT_REQUIRED");
  }

  if (stylePrompt) {
    messages.push({ role: "user", content: stylePrompt });
  }

  messages.push({ role: "assistant", content: text });

  const payload: MimoPayload = {
    model: MODEL_BY_MODE[input.mode],
    messages,
    audio: {
      format: stream ? "pcm16" : "wav"
    }
  };

  if (input.mode === "builtin") {
    payload.audio.voice = input.voice?.trim() || "mimo_default";
  }

  if (input.mode === "clone") {
    payload.audio.voice = buildCloneVoice(input.cloneSample);
  }

  if (stream) {
    payload.stream = true;
  }

  return payload;
}

export function sanitizePayload(payload: MimoPayload): MimoPayload {
  const clonePrefix = /^data:audio\/[^;]+;base64,/;
  const voice = payload.audio.voice;
  return {
    ...payload,
    audio: {
      ...payload.audio,
      ...(voice && clonePrefix.test(voice)
        ? { voice: voice.replace(/base64,.+$/, "base64,<redacted>") }
        : {})
    }
  };
}

export function extractNonStreamingAudioBase64(responseJson: unknown): string {
  const data = getNestedString(responseJson, ["choices", 0, "message", "audio", "data"]);
  if (!data) {
    throw new TtsValidationError("MiMo 响应中没有找到音频数据。", "AUDIO_DATA_MISSING", 502);
  }
  return data;
}

export function extractPcmChunksFromSseText(text: string): Buffer[] {
  const chunks: Buffer[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }

    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    try {
      const parsed = JSON.parse(data);
      const audioBase64 =
        getNestedString(parsed, ["choices", 0, "delta", "audio", "data"]) ||
        getNestedString(parsed, ["choices", 0, "message", "audio", "data"]);
      if (audioBase64) {
        chunks.push(Buffer.from(audioBase64, "base64"));
      }
    } catch {
      continue;
    }
  }

  return chunks;
}

export async function collectPcmFromStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: Buffer[] = [];
  let pending = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    pending += decoder.decode(value, { stream: true });
    const parts = pending.split(/\r?\n\r?\n/);
    pending = parts.pop() ?? "";

    for (const part of parts) {
      chunks.push(...extractPcmChunksFromSseText(part));
    }
  }

  pending += decoder.decode();
  chunks.push(...extractPcmChunksFromSseText(pending));

  return Buffer.concat(chunks);
}

export function pcm16ToWav(pcm: Buffer, sampleRate = PCM_SAMPLE_RATE, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export function mapMimoError(status: number): string {
  const messages: Record<number, string> = {
    400: "请求格式不正确，请检查文本、模型、音频格式和必填参数。",
    401: "鉴权失败，请检查 .env 中的 MIMO_API_KEY 和 api-key 请求头。",
    402: "账户余额不足，请检查 MiMo 控制台余额。",
    403: "当前服务不可用或 API Key 被限制，请检查区域、风控状态或重新创建 Key。",
    421: "内容被安全策略拦截，请调整输入文本或音色样本。",
    429: "请求过于频繁或套餐额度已用尽，请稍后重试。",
    500: "MiMo 服务器内部错误，请稍后重试。",
    503: "MiMo 服务当前负载较高，请稍后重试。"
  };

  return messages[status] ?? `MiMo API 调用失败，HTTP 状态码 ${status}。`;
}

export function extractErrorDetail(body: string): string | undefined {
  if (!body.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body);
    const detail =
      getNestedString(parsed, ["error", "message"]) ||
      getNestedString(parsed, ["message"]) ||
      getNestedString(parsed, ["detail"]);
    return detail?.slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

function buildCloneVoice(sample?: CloneSample): string {
  const base64 = sample?.base64?.trim() ?? "";
  if (!base64) {
    throw new TtsValidationError("VoiceClone 模式需要上传 mp3 或 wav 音色样本。", "VOICE_CLONE_SAMPLE_REQUIRED");
  }

  if (base64.length > MAX_CLONE_BASE64_LENGTH) {
    throw new TtsValidationError("音色样本 Base64 后不能超过 10 MB。", "VOICE_CLONE_SAMPLE_TOO_LARGE");
  }

  const mimeType = normalizeCloneMimeType(sample?.mimeType, sample?.fileName);
  return `data:${mimeType};base64,${base64}`;
}

function normalizeCloneMimeType(mimeType?: string, fileName?: string): "audio/mpeg" | "audio/mp3" | "audio/wav" {
  const normalized = mimeType?.trim().toLowerCase();
  if (normalized === "audio/mpeg" || normalized === "audio/mp3" || normalized === "audio/wav") {
    return normalized;
  }

  const lowerName = fileName?.toLowerCase() ?? "";
  if (lowerName.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (lowerName.endsWith(".wav")) {
    return "audio/wav";
  }

  throw new TtsValidationError("音色样本只支持 mp3 或 wav。", "VOICE_CLONE_SAMPLE_TYPE");
}

function normalizeRequired(value: string | undefined, message: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new TtsValidationError(message);
  }
  return normalized;
}

function getNestedString(value: unknown, path: Array<string | number>): string | undefined {
  let current: unknown = value;

  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[key];
      continue;
    }

    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current ? current : undefined;
}
