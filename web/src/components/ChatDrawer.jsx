import { useEffect, useRef, useState } from 'react';
import {
  Bot, ChevronDown, Copy, Expand, FileText, Image as ImageIcon, Loader2, MessageSquare,
  Minimize2, Paperclip, Send, Sparkles, Trash2, X, Grip,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useToast } from './ui.jsx';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const MAX_TEXT_FILE_CHARS = 50_000;
const MAX_CONTEXT_CHARS = 120_000;
const MAX_FILES = 10;
const SHOT_HEADING = /^(?:#{1,4}\s*)?(?:镜头|分镜|shot)\s*(?:[\d一二三四五六七八九十百零〇两]+)?\s*[:：.、|｜-]?.*$/i;

function extensionOf(name) {
  return String(name || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
}

function attachmentIcon(file) {
  return file?.mime?.startsWith('image/') ? ImageIcon : FileText;
}

export default function ChatDrawer({ canvasId, canvasName, onInsert }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [panelPosition, setPanelPosition] = useState(null);
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const panelDrag = useRef(null);

  useEffect(() => {
    let active = true;
    setMessages([]);
    setPendingFiles([]);
    setInput('');
    setOpen(false);
    api.canvasChat(canvasId)
      .then((data) => { if (active) setMessages(Array.isArray(data.messages) ? data.messages : []); })
      .catch((error) => { if (active) toast(`读取 Muse 对话失败：${error.message}`, 'error'); });
    return () => { active = false; };
  }, [canvasId, toast]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy, open]);

  const attachmentCount = messages.reduce((total, message) => total + (message.attachments?.length || 0), 0)
    + pendingFiles.length;

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []).map((file, index) => {
      if (file.name) return file;
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1] || 'bin';
      return new File([file], `粘贴素材-${index + 1}.${ext}`, { type: file.type });
    });
    if (!files.length) return;
    if (attachmentCount + files.length > MAX_FILES) {
      toast(`一段 Muse 对话最多附加 ${MAX_FILES} 个文件，清空对话后可以重新开始`, 'error');
      return;
    }
    setUploading(true);
    const added = [];
    try {
      for (const file of files) {
        if (file.size > 40 * 1024 * 1024) throw new Error(`${file.name} 超过 40 MB`);
        const ext = extensionOf(file.name);
        if (TEXT_EXTENSIONS.has(ext)) {
          const text = await file.text();
          if (!text.trim()) throw new Error(`${file.name} 没有可读取的文字`);
          if (text.length > MAX_TEXT_FILE_CHARS) {
            throw new Error(`${file.name} 超过 ${MAX_TEXT_FILE_CHARS.toLocaleString()} 字，请拆分后再附加`);
          }
          added.push({ name: file.name, mime: file.type || 'text/plain', text });
          continue;
        }

        const supportedImage = /^image\/(png|jpeg|gif|webp|heic|heif|avif)$/i.test(file.type)
          || /\.(png|jpe?g|gif|webp|heic|heif|avif)$/i.test(file.name);
        const supportedDoc = /\.(pdf|doc|docx)$/i.test(file.name);
        if (!supportedImage && !supportedDoc) {
          throw new Error(`暂不支持 ${file.name}，可附加图片、PDF、Word、MD 或 TXT`);
        }
        const result = await api.upload([file]);
        const uploaded = result.files?.[0];
        if (!uploaded) throw new Error(`${file.name} 上传失败`);
        added.push({ name: file.name, mime: uploaded.mime, url: uploaded.url, bytes: uploaded.bytes });
      }
      setPendingFiles((current) => [...current, ...added]);
    } catch (error) {
      toast(error.message || '附件读取失败', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !pendingFiles.length) || busy || uploading) return;
    const totalText = messages.reduce((sum, message) => sum
      + (message.attachments || []).reduce((n, file) => n + (file.text?.length || 0), 0), 0)
      + pendingFiles.reduce((sum, file) => sum + (file.text?.length || 0), 0);
    if (totalText > MAX_CONTEXT_CHARS) {
      toast(`文档文字总量超过 ${MAX_CONTEXT_CHARS.toLocaleString()} 字，请清空对话后分段处理`, 'error');
      return;
    }

    const next = [...messages, {
      role: 'user', content: text, ...(pendingFiles.length ? { attachments: pendingFiles } : {}),
    }];
    setMessages(next);
    setInput('');
    setPendingFiles([]);
    setBusy(true);
    try {
      const out = await api.chat({ canvasId, messages: next });
      setMessages(Array.isArray(out.messages) ? out.messages : [...next, { role: 'assistant', content: out.content || '（空响应）' }]);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板', 'ok');
    } catch {
      toast('复制失败', 'error');
    }
  };

  const clear = async () => {
    if (!messages.length && !pendingFiles.length) return;
    if (!window.confirm('清空这张画布的 Muse 对话记录？')) return;
    try {
      await api.clearCanvasChat(canvasId);
      setMessages([]);
      setPendingFiles([]);
      toast('对话记录已清空', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="打开 Muse Agent"
          aria-label="打开 Muse Agent 对话"
          className="absolute left-4 top-4 z-40 flex h-12 items-center gap-2 rounded-full border border-white bg-white/95 px-4 text-[13px] font-semibold text-[#30364a] shadow-[0_12px_35px_-14px_rgba(48,55,90,.42)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-600"
        >
          <Sparkles size={16} className="text-brand-500" /> Muse Agent
          {messages.length > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-500/10 px-1 text-[10px] text-brand-600">{Math.ceil(messages.length / 2)}</span>}
        </button>
      )}

      {open && (
        <aside className={clsx(
          'fixed right-4 top-20 z-50 flex h-[min(78vh,720px)] min-h-[min(380px,calc(100dvh-6rem))] max-h-[calc(100dvh-5rem)] resize flex-col overflow-hidden rounded-2xl border border-[#e5e9f2] bg-white/95 shadow-[0_24px_70px_-25px_rgba(35,44,80,.42)] backdrop-blur-xl transition-[width] duration-200 max-sm:inset-x-2 max-sm:bottom-2 max-sm:top-16 max-sm:h-auto max-sm:min-h-0 max-sm:w-auto max-sm:resize-none',
          expanded ? 'w-[min(680px,calc(100vw-2rem))]' : 'w-[min(420px,calc(100vw-2rem))]'
        )} style={panelPosition ? {
          left: panelPosition.x,
          top: panelPosition.y,
          right: 'auto',
          maxWidth: `calc(100vw - ${panelPosition.x + 8}px)`,
          maxHeight: `calc(100dvh - ${panelPosition.y + 8}px)`,
          minWidth: `min(320px, calc(100vw - ${panelPosition.x + 16}px))`,
          minHeight: `min(380px, calc(100dvh - ${panelPosition.y + 16}px))`,
        } : undefined}>
          <header
            onPointerDown={(event) => {
              if (event.target.closest('button')) return;
              const rect = event.currentTarget.closest('aside').getBoundingClientRect();
              panelDrag.current = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
              event.currentTarget.setPointerCapture(event.pointerId);
              setPanelPosition({ x: rect.left, y: rect.top });
            }}
            onPointerMove={(event) => {
              if (panelDrag.current?.id !== event.pointerId) return;
              const panel = event.currentTarget.closest('aside');
              const drag = panelDrag.current;
              const x = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, event.clientX - drag.dx));
              const y = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, event.clientY - drag.dy));
              setPanelPosition({ x, y });
            }}
            onPointerUp={(event) => { if (panelDrag.current?.id === event.pointerId) panelDrag.current = null; }}
            onPointerCancel={() => { panelDrag.current = null; }}
            className="flex shrink-0 cursor-move touch-none items-center justify-between border-b border-[#edf0f6] px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Grip size={15} className="shrink-0 text-mist-300" />
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#eef1ff] to-[#f5edff] text-brand-600"><Bot size={19} /></span>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold text-[#171a24]">Muse Agent</h2>
                <p className="truncate text-[11px] text-mist-400">{canvasName || '当前画布'} · 对话按画布保存</p>
              </div>
            </div>
            <div className="flex cursor-default items-center gap-1">
              <button type="button" onClick={clear} title="清空本画布对话" aria-label="清空本画布对话" className="grid h-8 w-8 place-items-center rounded-lg text-mist-400 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={14} /></button>
              <button type="button" onClick={() => setExpanded((value) => !value)} title={expanded ? '缩窄面板' : '展开面板'} aria-label={expanded ? '缩窄面板' : '展开面板'} className="grid h-8 w-8 place-items-center rounded-lg text-mist-400 transition hover:bg-[#f2f4f9] hover:text-[#171a24]">{expanded ? <Minimize2 size={14} /> : <Expand size={14} />}</button>
              <button type="button" onClick={() => setOpen(false)} title="收起对话" aria-label="收起 Muse Agent" className="grid h-8 w-8 place-items-center rounded-lg text-mist-400 transition hover:bg-[#f2f4f9] hover:text-[#171a24]"><ChevronDown size={16} /></button>
            </div>
          </header>

          <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#fafbfe] p-4">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#edf0ff] to-[#f6efff] text-brand-500"><Sparkles size={25} /></span>
                <p className="mt-4 text-[14px] font-semibold text-[#252b3c]">和 Muse 一起创作</p>
                <p className="mt-1.5 max-w-64 text-[12px] leading-5 text-mist-400">上传剧本或资料，让 Muse 拆分镜、整理角色和场景。回复可直接放到画布。</p>
                <p className="mt-4 text-[10.5px] text-mist-400">支持 MD、TXT、PDF、Word 和常见图片</p>
              </div>
            ) : messages.map((message, index) => {
              const isAssistant = message.role === 'assistant';
              return (
                <article key={`${index}-${message.role}`} className={clsx('flex gap-2.5', !isAssistant && 'justify-end')}>
                  {isAssistant && <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#edf0ff] to-[#f4eefe] text-brand-600"><Sparkles size={14} /></span>}
                  <div className={clsx('min-w-0 max-w-[88%] rounded-2xl px-3.5 py-2.5 shadow-sm', isAssistant ? 'border border-[#edf0f6] bg-white text-[#33394a]' : 'bg-gradient-to-br from-[#5d6df5] to-[#7960e8] text-white')}>
                    {message.attachments?.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {message.attachments.map((file, fileIndex) => {
                          const FileIcon = attachmentIcon(file);
                          return (
                            <span key={`${file.name}-${fileIndex}`} title={file.name} className={clsx('inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[10.5px]', isAssistant ? 'bg-[#f3f5fa] text-[#5c6477]' : 'bg-white/15 text-white')}>
                              <FileIcon size={12} className="shrink-0" /><span className="max-w-48 truncate">{file.name}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {message.content && <p className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.65]">{message.content}</p>}
                    {isAssistant && message.content && (
                      <div className="mt-2 flex flex-wrap gap-3 border-t border-[#f0f2f7] pt-2">
                        <button type="button" onClick={() => copy(message.content)} className="inline-flex items-center gap-1 text-[10.5px] text-mist-400 transition hover:text-brand-600"><Copy size={11} />复制</button>
                        {message.content.split(/\r?\n/).filter((line) => SHOT_HEADING.test(line.trim())).length > 1 && (
                          <button type="button" onClick={() => onInsert(message.content, true)} className="inline-flex items-center gap-1 text-[10.5px] text-brand-600 transition hover:text-brand-700"><MessageSquare size={11} />拆分为镜头节点</button>
                        )}
                        <button type="button" onClick={() => onInsert(message.content, false)} className="inline-flex items-center gap-1 text-[10.5px] text-brand-600 transition hover:text-brand-700"><MessageSquare size={11} />放入一个节点</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
            {busy && <div className="flex items-center gap-2 pl-9 text-[11.5px] text-mist-400"><Loader2 size={13} className="animate-spin text-brand-500" />Muse 正在思考…</div>}
          </div>

          <div className="shrink-0 border-t border-[#edf0f6] bg-white p-3">
            {pendingFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pendingFiles.map((file, index) => {
                  const FileIcon = attachmentIcon(file);
                  return <span key={`${file.name}-${index}`} title={file.name} className="inline-flex max-w-[48%] items-center gap-1.5 rounded-lg border border-[#e6eaf2] bg-[#f7f8fc] py-1 pl-2 pr-1 text-[10.5px] text-[#596176]"><FileIcon size={12} className="shrink-0 text-brand-500" /><span className="max-w-36 truncate">{file.name}</span><button type="button" onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== index))} aria-label={`移除${file.name}`} className="ml-0.5 grid h-5 w-5 place-items-center rounded-md hover:bg-white hover:text-rose-500"><X size={11} /></button></span>;
                })}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-[#e4e8f1] bg-[#fafbfe] p-2 focus-within:border-brand-400/60">
              <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/avif,.md,.markdown,.txt,.pdf,.doc,.docx" className="hidden" onChange={(event) => addFiles(event.target.files)} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || uploading} title="添加图片或文档" aria-label="添加图片或文档" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-mist-400 transition hover:bg-white hover:text-brand-600 disabled:opacity-50">{uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}</button>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.items || [])
                    .filter((item) => item.kind === 'file')
                    .map((item) => item.getAsFile())
                    .filter(Boolean);
                  if (!files.length) return;
                  event.preventDefault();
                  addFiles(files);
                }}
                maxLength={20_000}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }}
                rows={2}
                placeholder="发消息给 Muse，Enter 发送"
                className="max-h-32 min-h-[42px] min-w-0 flex-1 resize-y bg-transparent px-1 py-2 text-[12.5px] leading-relaxed text-[#252b3c] outline-none placeholder:text-mist-400"
              />
              <button type="button" onClick={send} disabled={busy || uploading || (!input.trim() && !pendingFiles.length)} title="发送给 Muse" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#5d6df5] to-[#7960e8] text-white shadow-sm transition hover:brightness-105 disabled:opacity-45">{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button>
            </div>
            <p className="mt-1.5 px-1 text-[10px] text-mist-400">MD、TXT 内容会作为文本发送；图片、PDF 和 Word 会附加到 Muse 对话。</p>
          </div>
        </aside>
      )}
    </>
  );
}
