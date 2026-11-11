import { useCallback, useEffect, useState } from 'react';
import {
  X, Play, Pause, ArrowUp, ArrowDown, Trash2, Loader2, Clock, Plus, ListOrdered, Zap,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { useToast } from './ui.jsx';

const STATUS = {
  pending: { label: '待执行', cls: 'bg-amber-50 text-amber-700' },
  running: { label: '执行中', cls: 'bg-[#f3efff] text-brand-600' },
  done: { label: '已执行', cls: 'bg-emerald-50 text-emerald-700' },
  paused: { label: '已暂停', cls: 'bg-[#eef0f6] text-mist-300' },
  failed: { label: '失败', cls: 'bg-rose-50 text-rose-600' },
};

export default function QueueDrawer({ open, onClose, prompt, duration, size }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [intervalMin, setIntervalMin] = useState(5);
  const [maxRuns, setMaxRuns] = useState(3);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.queue();
      setItems(out.items);
      setStats(out.stats);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [open, load]);

  const add = async () => {
    if (!prompt?.trim()) return toast('请先在下方输入框写好提示词', 'error');
    setBusy(true);
    try {
      await api.addQueue({ prompt: prompt.trim(), duration, size, intervalMin, maxRuns });
      toast('已加入队列', 'ok');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg, 'ok');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#171a24]/28 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="frost fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-[#e6eaf2] fade-in">
        <div className="flex items-center justify-between border-b border-[#eef0f6] px-4 py-3.5">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[#171a24]">
            <ListOrdered size={15} className="text-brand-400" /> 自动执行任务
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-mist-400 hover:bg-[#eef0f6] hover:text-[#171a24]">
            <X size={15} />
          </button>
        </div>

        {/* 添加 */}
        <div className="border-b border-[#eef0f6] p-4">
          <div className="mb-2 rounded-lg border border-[#e6eaf2] bg-white px-3 py-2">
            <p className="line-clamp-2 text-[12px] leading-relaxed text-mist-300">
              {prompt?.trim() || '（下方输入框里还没有提示词）'}
            </p>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-[10.5px] text-mist-400">默认间隔（分钟）</label>
              <input
                type="number"
                min={1}
                max={1440}
                value={intervalMin}
                onChange={(e) => setIntervalMin(Number(e.target.value) || 1)}
                className="h-9 w-full rounded-lg border border-[#e6eaf2] bg-white px-2.5 font-mono text-[12px] text-[#171a24] outline-none focus:border-brand-500/50"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-[10.5px] text-mist-400">执行次数</label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxRuns}
                onChange={(e) => setMaxRuns(Number(e.target.value) || 1)}
                className="h-9 w-full rounded-lg border border-[#e6eaf2] bg-white px-2.5 font-mono text-[12px] text-[#171a24] outline-none focus:border-brand-500/50"
              />
            </div>
            <button
              onClick={add}
              disabled={busy}
              className="flex h-9 items-center gap-1 rounded-lg brand-gradient px-3 text-[12px] font-medium text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} 加入
            </button>
          </div>

          <p className="mt-2 font-mono text-[10px] text-mist-400">
            单次 {10 + 2 * (duration || 5)} 积分 · 共 {maxRuns} 次 · 约 {(10 + 2 * (duration || 5)) * maxRuns} 积分
          </p>
        </div>

        {/* 统计 */}
        <div className="flex items-center justify-between border-b border-[#eef0f6] px-4 py-2">
          <div className="flex gap-3 text-[10.5px] text-mist-400">
            <span>待执行 <b className="font-mono text-gold-400">{stats.pending || 0}</b></span>
            <span>执行中 <b className="font-mono text-brand-500">{stats.running || 0}</b></span>
            <span>已执行 <b className="font-mono text-emerald-600">{stats.done || 0}</b></span>
            <span>暂停 <b className="font-mono text-mist-300">{stats.paused || 0}</b></span>
          </div>
          <button onClick={load} className="text-[10.5px] text-mist-400 hover:text-[#171a24]">
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="grid place-items-center py-20 text-center">
              <Clock size={26} className="text-mist-400/50" />
              <p className="mt-2 text-[12px] text-mist-400">还没有队列任务</p>
              <p className="mt-0.5 text-[11px] text-ink-500">写好评语后点上面的「加入」</p>
            </div>
          ) : (
            <div className="divide-y divide-[#eef0f6]">
              {items.map((q, i) => {
                const st = STATUS[q.status] || STATUS.pending;
                return (
                  <div key={q.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-ink-500">{String(i + 1).padStart(2, '0')}</span>
                          <span className={clsx('rounded px-1.5 py-0.5 text-[10px]', st.cls)}>{st.label}</span>
                          <span className="font-mono text-[10px] text-mist-400">
                            {q.runs}/{q.maxRuns} 次
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-mist-200">{q.prompt}</p>
                        <p className="mt-1 font-mono text-[9.5px] text-ink-500">
                          {q.nextRunAt && q.status === 'pending'
                            ? `下次 ${new Date(q.nextRunAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                            : q.lastRunAt
                              ? `上次 ${fmtAgo(q.lastRunAt)}`
                              : '尚未执行'}
                          {' · '}间隔 {q.intervalMin} 分钟
                        </p>
                        {q.note && <p className="mt-0.5 truncate text-[9.5px] text-mist-400">{q.note}</p>}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-1">
                      {q.status === 'paused' ? (
                        <IconAction icon={Play} title="恢复" onClick={() => act(() => api.patchQueue(q.id, { status: 'pending' }), '已恢复')} />
                      ) : (
                        <IconAction icon={Pause} title="暂停" onClick={() => act(() => api.patchQueue(q.id, { status: 'paused' }), '已暂停')} />
                      )}
                      <IconAction icon={ArrowUp} title="上移" onClick={() => act(() => api.moveQueue(q.id, 'up'))} />
                      <IconAction icon={ArrowDown} title="下移" onClick={() => act(() => api.moveQueue(q.id, 'down'))} />
                      <button
                        onClick={() => { api.deleteQueue(q.id).then(load).catch((e) => toast(e.message, 'error')); }}
                        className="ml-auto grid h-7 w-7 place-items-center rounded-md text-mist-400 transition hover:bg-[#eef0f6] hover:text-rose-500"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex gap-2 border-t border-[#eef0f6] p-3">
          <button
            onClick={() => act(() => api.clearQueueDone(), '已清理已完成')}
            className="flex-1 rounded-lg border border-[#e6eaf2] bg-white py-2 text-[11.5px] text-mist-300 transition hover:border-brand-400/40 hover:text-[#171a24]"
          >
            清理已完成
          </button>
          <button
            onClick={() => {
              if (!confirm('清空全部队列任务？')) return;
              act(() => api.clearQueueAll(), '已清空所有任务');
            }}
            className="flex-1 rounded-lg border border-rose-200 py-2 text-[11.5px] text-rose-600 transition hover:bg-rose-50"
          >
            清空全部
          </button>
        </div>
      </aside>
    </>
  );
}

function IconAction({ icon: Icon, title, onClick }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="grid h-7 w-7 place-items-center rounded-md text-mist-400 transition hover:bg-[#eef0f6] hover:text-[#171a24]"
    >
      <Icon size={12} />
    </button>
  );
}
