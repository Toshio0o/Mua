import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { CFG } from '../config.js';
import { db, now } from '../db.js';

const r = Router();
const UPLOAD_DIR = path.join(CFG.dataDir, 'uploads');
const MAX_CHAT_FILES = 10;
const MAX_CHAT_FILE_BYTES = 48 * 1024 * 1024;
const MAX_CHAT_TEXT = 120_000;

export const TEXT_MODELS = [
  { id: 'muse-spark', name: 'Muse Spark', desc: 'Muse 网页端文本对话' },
];

function ownedCanvas(userId, canvasId) {
  return db.prepare('SELECT id FROM canvases WHERE id = ? AND user_id = ?').get(canvasId, userId);
}

function cleanMessages(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(-40).filter((message) =>
    message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
  ).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 20_000),
    ...(Array.isArray(message.attachments) ? {
      attachments: message.attachments.slice(0, MAX_CHAT_FILES).map((file) => ({
        name: String(file?.name || '附件').slice(0, 200),
        mime: String(file?.mime || '').slice(0, 120),
        ...(typeof file?.url === 'string' ? { url: file.url.slice(0, 500) } : {}),
        ...(typeof file?.text === 'string' ? { text: file.text.slice(0, MAX_CHAT_TEXT) } : {}),
      })),
    } : {}),
  }));
}

function saveMessages(userId, canvasId, messages) {
  db.prepare(`
    INSERT INTO canvas_conversations(user_id, canvas_id, messages_json, updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(user_id, canvas_id) DO UPDATE SET
      messages_json = excluded.messages_json,
      updated_at = excluded.updated_at
  `).run(userId, canvasId, JSON.stringify(messages), now());
}

function attachmentDataUrl(userId, url) {
  const match = String(url || '').match(/^\/uploads\/(up_[A-Za-z0-9_-]+\.[A-Za-z0-9]+)$/);
  if (!match) throw Object.assign(new Error('附件链接无效，请重新上传'), { status: 400 });
  const file = db.prepare('SELECT filename, mime, bytes FROM uploads WHERE user_id = ? AND filename = ?')
    .get(userId, match[1]);
  if (!file) throw Object.assign(new Error('找不到此附件或当前账号无权读取'), { status: 403 });
  if (!file.mime.startsWith('image/') && ![
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ].includes(file.mime)) {
    throw Object.assign(new Error(`Muse 对话暂不支持此附件类型：${file.mime}`), { status: 400 });
  }
  const fullPath = path.join(UPLOAD_DIR, file.filename);
  if (!fs.existsSync(fullPath)) throw Object.assign(new Error('附件文件已不存在，请重新上传'), { status: 410 });
  const bytes = fs.statSync(fullPath).size;
  if (bytes > 40 * 1024 * 1024) throw Object.assign(new Error('单个附件不能超过 40 MB'), { status: 413 });
  return { data: `data:${file.mime};base64,${fs.readFileSync(fullPath).toString('base64')}`, bytes };
}

r.get('/chat/models', requireAuth, (_req, res) => res.json({ models: TEXT_MODELS }));

r.get('/chat/canvases/:canvasId', requireAuth, (req, res) => {
  if (!ownedCanvas(req.user.id, req.params.canvasId)) return res.status(404).json({ error: '画布不存在或无权访问' });
  const row = db.prepare('SELECT messages_json, updated_at FROM canvas_conversations WHERE user_id = ? AND canvas_id = ?')
    .get(req.user.id, req.params.canvasId);
  let messages = [];
  try { messages = JSON.parse(row?.messages_json || '[]'); } catch { messages = []; }
  res.json({ messages, updatedAt: row?.updated_at || null });
});

r.delete('/chat/canvases/:canvasId', requireAuth, (req, res) => {
  if (!ownedCanvas(req.user.id, req.params.canvasId)) return res.status(404).json({ error: '画布不存在或无权访问' });
  db.prepare('DELETE FROM canvas_conversations WHERE user_id = ? AND canvas_id = ?')
    .run(req.user.id, req.params.canvasId);
  res.json({ ok: true });
});

/** Muse 对话与画布关联，附件会通过上游真实网页聊天输入框附加。 */
r.post('/chat', requireAuth, async (req, res) => {
  const canvasId = String(req.body?.canvasId || '');
  if (!canvasId || !ownedCanvas(req.user.id, canvasId)) return res.status(404).json({ error: '画布不存在或无权访问' });
  const messages = cleanMessages(req.body?.messages);
  if (!messages.length) return res.status(400).json({ error: '请先输入消息' });
  const latest = messages.at(-1);
  if (latest.role !== 'user') return res.status(400).json({ error: '最后一条消息必须来自用户' });

  const filesByUrl = new Map();
  for (const message of messages) {
    for (const file of message.attachments || []) {
      if (file.text) continue;
      if (file.url) filesByUrl.set(file.url, file.name);
    }
  }
  if (filesByUrl.size > MAX_CHAT_FILES) {
    return res.status(400).json({ error: `当前对话最多保留 ${MAX_CHAT_FILES} 个 Muse 附件，请清空对话后继续` });
  }

  let totalBytes = 0;
  const images = [];
  try {
    for (const url of filesByUrl.keys()) {
      const attachment = attachmentDataUrl(req.user.id, url);
      totalBytes += attachment.bytes;
      if (totalBytes > MAX_CHAT_FILE_BYTES) {
        return res.status(413).json({ error: '对话附件总大小不能超过 48 MB，请精简附件后重试' });
      }
      images.push(attachment.data);
    }
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  let totalText = 0;
  for (const message of messages) {
    for (const file of message.attachments || []) totalText += file.text?.length || 0;
  }
  if (totalText > MAX_CHAT_TEXT) {
    return res.status(400).json({ error: `文档文字总量超过 ${MAX_CHAT_TEXT.toLocaleString()} 字，请拆分文档后发送` });
  }
  const museMessages = messages.map((message) => {
    let content = message.content;
    for (const file of message.attachments || []) {
      if (file.text) content += `\n\n【文档：${file.name}】\n${file.text}\n【文档结束】`;
      else if (file.url) content += `\n\n【已附加${file.mime.startsWith('image/') ? '图片' : '文档'}：${file.name}】`;
    }
    return { role: message.role, content };
  });
  try {
    saveMessages(req.user.id, canvasId, messages);
  } catch (error) {
    return res.status(400).json({ error: error.message || '对话内容无法保存' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  try {
    const upstreamBody = { model: 'muse-spark', messages: museMessages, stream: false };
    if (images.length) upstreamBody.images = images;
    const up = await fetch(`${CFG.museBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CFG.museKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });

    const text = await up.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!up.ok) return res.status(up.status).json({ error: data?.error?.message || data?.detail || `上游 HTTP ${up.status}` });

    const content = String(data?.choices?.[0]?.message?.content ?? '').slice(0, 20_000);
    const completed = [...messages, { role: 'assistant', content }].slice(-40);
    saveMessages(req.user.id, canvasId, completed);
    res.json({ content, model: data?.model || 'muse-spark', usage: data?.usage || null, messages: completed });
  } catch (error) {
    const status = error.name === 'AbortError' ? 504 : 502;
    res.status(status).json({ error: error.name === 'AbortError' ? 'Muse 响应超时，请稍后重试' : `Muse 请求异常：${error.message}` });
  } finally {
    clearTimeout(timer);
  }
});

export default r;
