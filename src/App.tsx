import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileAudio,
  Gauge,
  Layers3,
  Loader2,
  Mic2,
  Music2,
  RefreshCw,
  Radio,
  Sparkles,
  Square,
  Tags,
  Trash2,
  Wand2
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type TtsMode = "builtin" | "design" | "clone";
type OutputMode = "normal" | "stream";

interface ApiStatus {
  configured: boolean;
  baseUrl: string;
  voices: Array<{ id: string; name: string; language: string; gender: string }>;
}

interface CloneSample {
  fileName: string;
  mimeType: string;
  base64: string;
}

interface SavedRecording extends CloneSample {
  id: string;
  name: string;
  createdAt: string;
  durationMs?: number;
  sizeBytes: number;
  source: "recorded" | "uploaded";
}

interface TtsResponse {
  audio: {
    mimeType: string;
    dataUrl: string;
    bytes: number;
  };
  durationMs: number;
  requestPreview: unknown;
  warnings?: string[];
}

interface Option {
  label: string;
  value: string;
}

const modeLabels: Record<TtsMode, string> = {
  builtin: "内置音色",
  design: "VoiceDesign",
  clone: "VoiceClone"
};

const modeHints: Record<TtsMode, string> = {
  builtin: "支持内置音色、唱歌标签、自然语言控制和音频标签控制。",
  design: "通过 user 内容描述音色，不使用内置音色或克隆样本。",
  clone: "上传 mp3/wav 样本作为 voice，并继续支持风格指令和标签控制。"
};

const sceneOptions: Option[] = [
  { label: "旁白", value: "以清晰稳定的叙述口吻朗读，像纪录片旁白一样有画面感。" },
  { label: "新闻播报", value: "以专业新闻播报风格朗读，节奏稳健，重点词略微强调。" },
  { label: "客服说明", value: "以亲切、耐心、可信赖的客服语气朗读，语气自然不夸张。" },
  { label: "角色对白", value: "以角色表演方式朗读，保留情绪起伏和对白节奏。" },
  { label: "睡前故事", value: "以柔和舒缓的睡前故事语气朗读，音量感轻，停顿更自然。" }
];

const emotionOptions: Option[] = [
  { label: "平静", value: "整体情绪保持平静、克制、放松。" },
  { label: "开心", value: "带着明亮开心的情绪，语尾略微上扬。" },
  { label: "激动", value: "带着兴奋和惊喜，语速略快但吐字清楚。" },
  { label: "疲惫", value: "带着轻微疲惫感，气息更软，节奏更慢。" },
  { label: "压抑愤怒", value: "表现压抑的愤怒，音量克制但字句更有力量。" },
  { label: "含泪微笑", value: "表现带着哽咽的微笑，温柔但有情绪层次。" }
];

const paceOptions: Option[] = [
  { label: "较慢", value: "语速较慢，句间停顿更明显。" },
  { label: "自然", value: "语速自然，停顿符合中文口语表达。" },
  { label: "较快", value: "语速略快，保持清楚咬字。" },
  { label: "强节奏", value: "节奏更有推进感，重点短句更利落。" }
];

const timbreOptions: Option[] = [
  { label: "明亮", value: "声音明亮、干净，听感有活力。" },
  { label: "低沉", value: "声音更低沉、稳定，带一点成熟质感。" },
  { label: "温柔", value: "声音温柔、柔和，语气更贴近。" },
  { label: "沙哑", value: "声音略带沙哑和颗粒感，但保持清晰。" },
  { label: "少年感", value: "声音更年轻、轻快，有少年感。" },
  { label: "成熟感", value: "声音更成熟、稳重，有可靠感。" }
];

const directorTemplates: Option[] = [
  {
    label: "电影级角色",
    value:
      "角色设定：冷静、克制但有压迫感的成熟角色。场景：正在向对方交代一件重要决定。表演指导：每句话前半段放慢，关键字加重，句尾带轻微气声。"
  },
  {
    label: "产品发布",
    value:
      "角色设定：专业产品负责人。场景：正在发布一项重要新功能。表演指导：开头稳健，中段更有信心，介绍亮点时语气上扬但不过度营销。"
  },
  {
    label: "故事讲述",
    value:
      "角色设定：温柔的讲述者。场景：夜晚给听众讲一个安静的故事。表演指导：句间留白更长，语气柔和，画面描写处放慢。"
  }
];

const startStyleOptions: Option[] = [
  { label: "唱歌", value: "唱歌" },
  { label: "播报", value: "播报" },
  { label: "耳语", value: "耳语" },
  { label: "喊话", value: "喊话" },
  { label: "温柔", value: "温柔" },
  { label: "严肃", value: "严肃" },
  { label: "夹子音", value: "夹子音" },
  { label: "御姐音", value: "御姐音" },
  { label: "正太音", value: "正太音" },
  { label: "大叔音", value: "大叔音" },
  { label: "台湾腔", value: "台湾腔" },
  { label: "东北话", value: "东北话" },
  { label: "四川话", value: "四川话" },
  { label: "河南话", value: "河南话" },
  { label: "粤语", value: "粤语" },
  { label: "孙悟空", value: "孙悟空" },
  { label: "林黛玉", value: "林黛玉" }
];

const audioCueOptions: Option[] = [
  { label: "微笑", value: "微笑" },
  { label: "轻笑", value: "轻笑" },
  { label: "大笑", value: "大笑" },
  { label: "冷笑", value: "冷笑" },
  { label: "抽泣", value: "抽泣" },
  { label: "哽咽", value: "哽咽" },
  { label: "叹气", value: "叹气" },
  { label: "喘气", value: "喘气" },
  { label: "停顿", value: "停顿" },
  { label: "咳嗽", value: "咳嗽" },
  { label: "颤抖", value: "颤抖" },
  { label: "气声", value: "气声" },
  { label: "鼻音", value: "鼻音" },
  { label: "沙哑", value: "沙哑" },
  { label: "提高音调", value: "提高音调" },
  { label: "放慢语速", value: "放慢语速" },
  { label: "加快语速", value: "加快语速" }
];

const voiceDesignExamples = [
  "温柔舒缓的年轻女声，声音干净柔和，语速偏慢，像在夜晚讲睡前故事。",
  "低沉稳重的成熟男声，带轻微沙哑质感，语气可靠，适合纪录片旁白。",
  "明亮活泼的少年感声音，语速略快，带一点自信和俏皮。"
];

const readingPrompts = [
  "今天的天气很好，窗外有微风，街道也显得格外安静。我想把这份轻松和愉快分享给你，然后用自然、平稳的语速，把接下来的每一句话都读清楚。",
  "请保持安静，列车即将进站，请站在安全线以内。上车时不要拥挤，先下后上，照看好随身物品；如果需要帮助，可以联系站台工作人员。",
  "欢迎来到 MiMo 语音实验室，现在开始采集一段清晰自然的声音样本。请放松肩膀，保持正常音量，按照平时说话的方式朗读，不要刻意压低或抬高声音。",
  "如果你听见这句话，说明录音设备已经准备好了，我们可以继续下一步。请从容地读完这一段，注意逗号处稍作停顿，句号处自然收尾，让声音保持稳定和连贯。",
  "夜色慢慢落下来，窗外的风轻轻吹过，故事也从这里开始。小小的灯光映在桌面上，像一颗安静的星星，陪着旅人穿过漫长却温柔的夜晚。",
  "这是一段用于声音克隆的参考录音，请用平稳自然的语速朗读完整内容。读的时候尽量保持距离不变，避免突然大声、笑场、清嗓或停顿太久，这会让样本更干净。"
];

const exampleTexts = [
  "今晚的月光很轻，适合把一天慢慢放下。",
  "新版本已经上线，所有测试全部通过。",
  "风吹过山岗，星光落在窗前。"
];

const defaultStatus: ApiStatus = {
  configured: false,
  baseUrl: "",
  voices: []
};

const recordingStoreName = "recordings";
const recordingDbName = "mimo-v25-tts";
const cloneVoicePreferenceKey = "mimo-v25-tts-last-clone-voice";

export function App() {
  const [status, setStatus] = useState<ApiStatus>(defaultStatus);
  const [mode, setMode] = useState<TtsMode>("builtin");
  const [outputMode, setOutputMode] = useState<OutputMode>("normal");
  const [voice, setVoice] = useState("mimo_default");
  const [stylePrompt, setStylePrompt] = useState("用自然、清晰、稍带亲切感的语气朗读。");
  const [text, setText] = useState("欢迎使用 MiMo V2.5 TTS。请在这里输入需要合成的文本。");
  const [selectedScenes, setSelectedScenes] = useState<string[]>([]);
  const [selectedEmotions, setSelectedEmotions] = useState<string[]>([]);
  const [selectedPace, setSelectedPace] = useState("自然");
  const [selectedTimbres, setSelectedTimbres] = useState<string[]>([]);
  const [directorTemplate, setDirectorTemplate] = useState("");
  const [startStyles, setStartStyles] = useState<string[]>([]);
  const [audioCues, setAudioCues] = useState<string[]>([]);
  const [customStartStyle, setCustomStartStyle] = useState("");
  const [customAudioCue, setCustomAudioCue] = useState("");
  const [cloneSample, setCloneSample] = useState<CloneSample | null>(null);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [activeCloneRecordingId, setActiveCloneRecordingId] = useState("");
  const [editingCloneRecordingId, setEditingCloneRecordingId] = useState("");
  const [editingCloneRecordingName, setEditingCloneRecordingName] = useState("");
  const [recordingName, setRecordingName] = useState("我的克隆音色");
  const [readingText, setReadingText] = useState(readingPrompts[0]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<TtsResponse | null>(null);
  const [error, setError] = useState("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Float32Array[]>([]);
  const recordingStartedAtRef = useRef(0);

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json())
      .then(setStatus)
      .catch(() => setError("无法连接本地代理，请确认后端服务已启动。"));
  }, []);

  useEffect(() => {
    loadSavedRecordings()
      .then((savedRecordings) => {
        setRecordings(savedRecordings);
        const preferredId = localStorage.getItem(cloneVoicePreferenceKey);
        const preferredRecording =
          savedRecordings.find((recording) => recording.id === preferredId) ?? savedRecordings[0];
        if (preferredRecording) {
          setCloneSample(toCloneSample(preferredRecording));
          setRecordingName(preferredRecording.name);
          setActiveCloneRecordingId(preferredRecording.id);
        }
      })
      .catch(() => setError("读取本地克隆音色失败。"));
  }, []);

  const naturalPrompt = useMemo(() => {
    const selected = [
      ...resolveValues(sceneOptions, selectedScenes),
      ...resolveValues(emotionOptions, selectedEmotions),
      ...resolveValues(timbreOptions, selectedTimbres)
    ];
    const pace = paceOptions.find((item) => item.label === selectedPace)?.value;
    if (pace) {
      selected.push(pace);
    }
    if (directorTemplate) {
      selected.push(directorTemplate);
    }
    if (stylePrompt.trim()) {
      selected.push(stylePrompt.trim());
    }
    return selected.join("\n");
  }, [directorTemplate, selectedEmotions, selectedPace, selectedScenes, selectedTimbres, stylePrompt]);

  const taggedText = useMemo(() => {
    const styleTags = uniqueList([
      ...startStyles,
      ...splitCustomTags(customStartStyle)
    ]);
    const cueTags = uniqueList([
      ...audioCues,
      ...splitCustomTags(customAudioCue)
    ]);
    const stylePrefix = styleTags.length ? `(${styleTags.join(" ")})` : "";
    const cuePrefix = cueTags.map((tag) => `[${tag}]`).join("");
    return `${stylePrefix}${cuePrefix}${text.trim()}`;
  }, [audioCues, customAudioCue, customStartStyle, startStyles, text]);

  const requestPreview = useMemo(() => {
    if (!result?.requestPreview) {
      return "";
    }
    return JSON.stringify(result.requestPreview, null, 2);
  }, [result]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setIsSubmitting(true);

    try {
      const endpoint = outputMode === "stream" ? "/api/tts/stream" : "/api/tts";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode,
          text: taggedText,
          stylePrompt: naturalPrompt,
          voice,
          cloneSample
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error([payload.error, payload.detail].filter(Boolean).join(" "));
      }

      setResult(payload);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "生成失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCloneFile(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = event.target.files?.[0];
    if (!file) {
      setCloneSample(null);
      setActiveCloneRecordingId("");
      localStorage.removeItem(cloneVoicePreferenceKey);
      return;
    }

    const isSupported =
      file.type === "audio/mpeg" ||
      file.type === "audio/mp3" ||
      file.type === "audio/wav" ||
      /\.(mp3|wav)$/i.test(file.name);
    if (!isSupported) {
      setError("音色样本只支持 mp3 或 wav。");
      setCloneSample(null);
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    const base64 = dataUrl.split(",")[1] ?? "";
    if (base64.length > 10 * 1024 * 1024) {
      setError("音色样本 Base64 后不能超过 10 MB。");
      setCloneSample(null);
      return;
    }

    const saved = await saveRecording({
      id: createId(),
      name: recordingName.trim() || stripExtension(file.name),
      fileName: file.name,
      mimeType: file.type || inferMimeType(file.name),
      base64,
      createdAt: new Date().toISOString(),
      sizeBytes: file.size,
      source: "uploaded"
    });
    setCloneSample(toCloneSample(saved));
    setActiveCloneRecordingId(saved.id);
    localStorage.setItem(cloneVoicePreferenceKey, saved.id);
    setRecordings(await loadSavedRecordings());
  }

  async function startRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持现场录音。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const AudioContextCtor = window.AudioContext || getWebkitAudioContext();
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      recordedChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input);
        recordedChunksRef.current.push(copy);
        setRecordingLevel(calculateRms(copy));

        const output = event.outputBuffer.getChannelData(0);
        output.fill(0);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      mediaStreamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      processorRef.current = processor;
      setIsRecording(true);
    } catch (recordError) {
      setError(recordError instanceof Error ? `无法开始录音：${recordError.message}` : "无法开始录音。");
    }
  }

  async function stopRecording() {
    if (!isRecording) {
      return;
    }

    const audioContext = audioContextRef.current;
    const sampleRate = audioContext?.sampleRate ?? 44100;
    const samples = mergeFloat32(recordedChunksRef.current);
    cleanupRecorder();
    setIsRecording(false);
    setRecordingLevel(0);

    if (samples.length < sampleRate * 2) {
      setError("录音太短，建议至少朗读 5-10 秒。");
      return;
    }

    const wav = encodeWav(samples, sampleRate);
    const base64 = bytesToBase64(wav);
    const createdAt = new Date().toISOString();
    const name = recordingName.trim() || `现场录音 ${formatDateTime(createdAt)}`;
    const saved = await saveRecording({
      id: createId(),
      name,
      fileName: `${safeFileName(name)}.wav`,
      mimeType: "audio/wav",
      base64,
      createdAt,
      durationMs: Date.now() - recordingStartedAtRef.current,
      sizeBytes: wav.byteLength,
      source: "recorded"
    });
    setCloneSample(toCloneSample(saved));
    setActiveCloneRecordingId(saved.id);
    localStorage.setItem(cloneVoicePreferenceKey, saved.id);
    setRecordings(await loadSavedRecordings());
  }

  async function useSavedRecording(recording: SavedRecording) {
    setCloneSample(toCloneSample(recording));
    setRecordingName(recording.name);
    setActiveCloneRecordingId(recording.id);
    localStorage.setItem(cloneVoicePreferenceKey, recording.id);
  }

  async function deleteSavedRecording(id: string) {
    await removeRecording(id);
    setRecordings(await loadSavedRecordings());
    setCloneSample((current) => {
      const removed = recordings.find((recording) => recording.id === id);
      return removed && current?.base64 === removed.base64 ? null : current;
    });
    if (activeCloneRecordingId === id) {
      setActiveCloneRecordingId("");
      localStorage.removeItem(cloneVoicePreferenceKey);
    }
  }

  function startRenameRecording(recording: SavedRecording) {
    setEditingCloneRecordingId(recording.id);
    setEditingCloneRecordingName(recording.name);
  }

  async function saveRecordingName(recording: SavedRecording) {
    const nextName = editingCloneRecordingName.trim();
    if (!nextName) {
      setError("音色名称不能为空。");
      return;
    }

    const renamedRecording = {
      ...recording,
      name: nextName,
      fileName: recording.source === "recorded" ? `${safeFileName(nextName)}.wav` : recording.fileName
    };
    await saveRecording(renamedRecording);
    setRecordings(await loadSavedRecordings());
    setRecordingName(nextName);
    setEditingCloneRecordingId("");
    setEditingCloneRecordingName("");
  }

  function pickRandomPrompt() {
    const next = readingPrompts[Math.floor(Math.random() * readingPrompts.length)];
    setReadingText(next === readingText ? readingPrompts[(readingPrompts.indexOf(next) + 1) % readingPrompts.length] : next);
  }

  function cleanupRecorder() {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();
    processorRef.current = null;
    sourceRef.current = null;
    mediaStreamRef.current = null;
    audioContextRef.current = null;
  }

  function resetControls() {
    setSelectedScenes([]);
    setSelectedEmotions([]);
    setSelectedPace("自然");
    setSelectedTimbres([]);
    setDirectorTemplate("");
    setStartStyles([]);
    setAudioCues([]);
    setCustomStartStyle("");
    setCustomAudioCue("");
  }

  return (
    <div className="appShell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MiMo-V2.5-TTS</p>
          <h1>语音合成工作台</h1>
        </div>
        <div className="statusCluster">
          <span className={status.configured ? "statusBadge ok" : "statusBadge warn"}>
            {status.configured ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {status.configured ? "Key 已配置" : "Key 未配置"}
          </span>
          <span className="baseUrl">{status.baseUrl || "等待本地代理"}</span>
        </div>
      </header>

      <form className="workspace" onSubmit={handleSubmit}>
        <aside className="panel configPanel">
          <section>
            <div className="sectionTitle">
              <Mic2 size={18} />
              <h2>模型</h2>
            </div>
            <div className="segmented">
              {(Object.keys(modeLabels) as TtsMode[]).map((item) => (
                <button
                  key={item}
                  className={mode === item ? "active" : ""}
                  type="button"
                  onClick={() => setMode(item)}
                >
                  {modeLabels[item]}
                </button>
              ))}
            </div>
            <p className="fieldHint">{modeHints[mode]}</p>
          </section>

          <section>
            <div className="sectionTitle">
              <Radio size={18} />
              <h2>输出</h2>
            </div>
            <div className="toggleRows">
              <label>
                <input
                  checked={outputMode === "normal"}
                  name="outputMode"
                  type="radio"
                  onChange={() => setOutputMode("normal")}
                />
                <span>非流式 WAV</span>
              </label>
              <label>
                <input
                  checked={outputMode === "stream"}
                  name="outputMode"
                  type="radio"
                  onChange={() => setOutputMode("stream")}
                />
                <span>流式兼容 PCM16 → WAV</span>
              </label>
            </div>
            <p className="fieldHint">
              流式兼容模式会发送 `stream: true`，并使用 `audio.format: "pcm16"`。
            </p>
          </section>

          {mode === "builtin" && (
            <section>
              <div className="sectionTitle">
                <Music2 size={18} />
                <h2>内置音色</h2>
              </div>
              <select value={voice} onChange={(event) => setVoice(event.target.value)}>
                {status.voices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} {item.language ? `· ${item.language}` : ""}
                  </option>
                ))}
              </select>
            </section>
          )}

          {mode === "clone" && (
            <section>
              <div className="sectionTitle">
                <FileAudio size={18} />
                <h2>上传并保存音色</h2>
              </div>
              <label className="fieldLabel" htmlFor="recordingName">
                克隆音色名称
              </label>
              <input
                className="inlineInput"
                id="recordingName"
                value={recordingName}
                onChange={(event) => setRecordingName(event.target.value)}
                placeholder="例如：永雏塔菲-温柔讲述"
              />
              <label className="filePicker">
                <input accept=".mp3,.wav,audio/mpeg,audio/wav" type="file" onChange={handleCloneFile} />
                <FileAudio size={18} />
                <span>{cloneSample ? cloneSample.fileName : "选择 mp3 或 wav"}</span>
              </label>
              <p className="fieldHint">上传后会自动保存到本地音色库，下次可直接选择；Base64 后不超过 10 MB。</p>
            </section>
          )}

          {mode === "clone" && (
            <section className="recorderPanel">
              <div className="sectionTitle">
                <Mic2 size={18} />
                <h2>现场录音</h2>
              </div>
              <div className="readingCard">
                <span>朗读文本</span>
                <p>{readingText}</p>
                <button className="secondaryButton" type="button" onClick={pickRandomPrompt}>
                  <RefreshCw size={16} />
                  换一段
                </button>
              </div>
              <div className="recorderActions">
                {!isRecording ? (
                  <button className="secondaryButton" type="button" onClick={startRecording}>
                    <Mic2 size={16} />
                    开始录音
                  </button>
                ) : (
                  <button className="dangerButton" type="button" onClick={stopRecording}>
                    <Square size={14} />
                    停止并保存音色
                  </button>
                )}
              </div>
              <div className="recordingMeter" aria-label="录音音量">
                <span style={{ width: `${Math.min(recordingLevel * 220, 100)}%` }} />
              </div>
              <p className="fieldHint">建议在安静环境中录制 20-40 秒，单人朗读，避免背景音乐和多人说话。</p>
            </section>
          )}

          {mode === "clone" && (
            <section>
              <div className="sectionTitle">
                <FileAudio size={18} />
                <h2>已保存克隆音色</h2>
              </div>
              {cloneSample && (
                <div className="activeVoiceHint">
                  当前使用：<strong>{recordingName || cloneSample.fileName}</strong>
                </div>
              )}
              <div className="recordingList">
                {recordings.length === 0 ? (
                  <div className="miniEmpty">暂无保存的克隆音色</div>
                ) : (
                  recordings.map((recording) => (
                    <div
                      className={activeCloneRecordingId === recording.id ? "recordingItem active" : "recordingItem"}
                      key={recording.id}
                    >
                      {editingCloneRecordingId === recording.id ? (
                        <>
                          <div>
                            <input
                              className="renameInput"
                              value={editingCloneRecordingName}
                              onChange={(event) => setEditingCloneRecordingName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void saveRecordingName(recording);
                                }
                                if (event.key === "Escape") {
                                  setEditingCloneRecordingId("");
                                  setEditingCloneRecordingName("");
                                }
                              }}
                            />
                            <span>
                              {recording.source === "recorded" ? "现场录音" : "上传文件"} · {formatBytes(recording.sizeBytes)}
                            </span>
                          </div>
                          <div className="recordingButtons">
                            <button type="button" onClick={() => saveRecordingName(recording)}>
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCloneRecordingId("");
                                setEditingCloneRecordingName("");
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <strong>{recording.name}</strong>
                            <span>
                              {recording.source === "recorded" ? "现场录音" : "上传文件"} · {formatBytes(recording.sizeBytes)}
                            </span>
                          </div>
                          <div className="recordingButtons">
                            <button type="button" onClick={() => useSavedRecording(recording)}>
                              {activeCloneRecordingId === recording.id ? "使用中" : "使用"}
                            </button>
                            <button type="button" onClick={() => startRenameRecording(recording)}>
                              改名
                            </button>
                            <button aria-label={`删除 ${recording.name}`} type="button" onClick={() => deleteSavedRecording(recording.id)}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </aside>

        <main className="panel editorPanel">
          <section>
            <div className="sectionTitle">
              <Wand2 size={18} />
              <h2>{mode === "design" ? "自然语言控制 / 音色描述" : "自然语言控制"}</h2>
            </div>
            <ControlGroup title="场景" options={sceneOptions} values={selectedScenes} onChange={setSelectedScenes} />
            <ControlGroup title="情绪" options={emotionOptions} values={selectedEmotions} onChange={setSelectedEmotions} />
            <ControlGroup title="音色质感" options={timbreOptions} values={selectedTimbres} onChange={setSelectedTimbres} />
            <div className="controlBlock">
              <div className="controlHeader">
                <Gauge size={16} />
                <span>语速 / 节奏</span>
              </div>
              <div className="chipGrid compact">
                {paceOptions.map((option) => (
                  <button
                    className={selectedPace === option.label ? "chip active" : "chip"}
                    key={option.label}
                    type="button"
                    onClick={() => setSelectedPace(option.label)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="controlBlock">
              <div className="controlHeader">
                <Layers3 size={16} />
                <span>导演模式模板</span>
              </div>
              <select value={directorTemplate} onChange={(event) => setDirectorTemplate(event.target.value)}>
                <option value="">不使用模板</option>
                {directorTemplates.map((template) => (
                  <option key={template.label} value={template.value}>
                    {template.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              className="promptInput"
              value={stylePrompt}
              onChange={(event) => setStylePrompt(event.target.value)}
              placeholder={mode === "design" ? "例如：温柔舒缓的女声，语速较慢，声音干净。" : "例如：用兴奋但清晰的播报语气朗读。"}
            />
            {mode === "design" && (
              <div className="exampleBar">
                {voiceDesignExamples.map((example) => (
                  <button key={example} type="button" onClick={() => setStylePrompt(example)}>
                    {example.slice(0, 12)}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="sectionTitle">
              <Tags size={18} />
              <h2>音频标签控制</h2>
            </div>
            <ControlGroup title="开头风格标签" options={startStyleOptions} values={startStyles} onChange={setStartStyles} />
            <input
              className="inlineInput"
              value={customStartStyle}
              onChange={(event) => setCustomStartStyle(event.target.value)}
              placeholder="自定义开头标签，多个用逗号或空格分隔"
            />
            <ControlGroup title="插入式音频标签" options={audioCueOptions} values={audioCues} onChange={setAudioCues} />
            <input
              className="inlineInput"
              value={customAudioCue}
              onChange={(event) => setCustomAudioCue(event.target.value)}
              placeholder="自定义音频标签，例如：压低声音、拖长尾音"
            />
          </section>

          <section className="textSection">
            <div className="sectionTitle">
              <Sparkles size={18} />
              <h2>合成文本</h2>
            </div>
            <textarea
              className="textInput"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="目标合成文本"
            />
            <div className="exampleBar">
              {exampleTexts.map((example) => (
                <button key={example} type="button" onClick={() => setText(example)}>
                  {example.slice(0, 14)}
                </button>
              ))}
              <button type="button" onClick={resetControls}>
                清空参数
              </button>
            </div>
          </section>

          <section className="finalPreview">
            <div>
              <strong>最终 user.content</strong>
              <pre>{naturalPrompt || "未设置自然语言控制"}</pre>
            </div>
            <div>
              <strong>最终 assistant.content</strong>
              <pre>{taggedText || "未设置合成文本"}</pre>
            </div>
          </section>

          <button className="submitButton" type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="spin" size={20} /> : <Sparkles size={20} />}
            {isSubmitting ? "生成中" : "生成语音"}
          </button>

          <section className="resultPanel">
            <section>
              <div className="sectionTitle">
                <FileAudio size={18} />
                <h2>结果</h2>
              </div>

              {error && (
                <div className="alert">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              {result ? (
                <div className="resultStack">
                  <audio controls src={result.audio.dataUrl} />
                  <div className="metaGrid">
                    <span>耗时</span>
                    <strong>{result.durationMs} ms</strong>
                    <span>大小</span>
                    <strong>{formatBytes(result.audio.bytes)}</strong>
                  </div>
                  {result.warnings?.map((warning) => (
                    <div className="warning" key={warning}>
                      {warning}
                    </div>
                  ))}
                  <a className="downloadButton" href={result.audio.dataUrl} download={`mimo-tts-${Date.now()}.wav`}>
                    <Download size={18} />
                    下载 WAV
                  </a>
                </div>
              ) : (
                <div className="emptyState">等待生成</div>
              )}
            </section>

            <section className="previewSection">
              <div className="sectionTitle">
                <Sparkles size={18} />
                <h2>请求预览</h2>
              </div>
              <pre>{requestPreview || "生成后显示"}</pre>
            </section>
          </section>
        </main>
      </form>
    </div>
  );
}

function ControlGroup({
  title,
  options,
  values,
  onChange
}: {
  title: string;
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="controlBlock">
      <div className="controlHeader">
        <span>{title}</span>
      </div>
      <div className="chipGrid">
        {options.map((option) => {
          const active = values.includes(option.label);
          return (
            <button
              className={active ? "chip active" : "chip"}
              key={option.label}
              type="button"
              onClick={() => onChange(toggleItem(values, option.label))}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toggleItem(values: string[], item: string): string[] {
  return values.includes(item) ? values.filter((value) => value !== item) : [...values, item];
}

function resolveValues(options: Option[], labels: string[]): string[] {
  return labels
    .map((label) => options.find((option) => option.label === label)?.value)
    .filter((value): value is string => Boolean(value));
}

function splitCustomTags(value: string): string[] {
  return value
    .split(/[\s,，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取音频文件失败。"));
    reader.readAsDataURL(file);
  });
}

function inferMimeType(fileName: string): string {
  return fileName.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function toCloneSample(recording: SavedRecording): CloneSample {
  return {
    fileName: recording.fileName,
    mimeType: recording.mimeType,
    base64: recording.base64
  };
}

function getWebkitAudioContext(): typeof AudioContext {
  return (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? AudioContext;
}

function calculateRms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(samples.length, 1));
}

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const headerBytes = 44;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = headerBytes;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function createId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function safeFileName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 64) || "voice-clone-sample";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function saveRecording(recording: SavedRecording): Promise<SavedRecording> {
  const db = await openRecordingDb();
  await requestToPromise(db.transaction(recordingStoreName, "readwrite").objectStore(recordingStoreName).put(recording));
  db.close();
  return recording;
}

async function loadSavedRecordings(): Promise<SavedRecording[]> {
  const db = await openRecordingDb();
  const recordings = await requestToPromise<SavedRecording[]>(
    db.transaction(recordingStoreName, "readonly").objectStore(recordingStoreName).getAll()
  );
  db.close();
  return recordings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function removeRecording(id: string): Promise<void> {
  const db = await openRecordingDb();
  await requestToPromise(db.transaction(recordingStoreName, "readwrite").objectStore(recordingStoreName).delete(id));
  db.close();
}

function openRecordingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(recordingDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(recordingStoreName)) {
        db.createObjectStore(recordingStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
