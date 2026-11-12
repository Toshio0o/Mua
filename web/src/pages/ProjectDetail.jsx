import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Clock3, FilePlus2, Layers3, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Field, Input, Modal, Spinner, useToast } from '../components/ui.jsx';

function formatDate(value) {
  if (!value) return '刚刚';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}

export default function ProjectDetail({ scratch = false }) {
  const { projectId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [modal, setModal] = useState(null);
  const [name, setName] = useState('');
  const canvasPath = (id) => scratch ? `/scratch/canvas/${id}` : `/canvas/${id}`;

  const load = async () => {
    setLoading(true);
    try {
      const [workspace, jobs] = await Promise.all([
        scratch ? api.scratchProject() : api.projects(),
        scratch ? Promise.resolve({ jobs: [] }) : api.jobs({ projectId, pageSize: 60 }),
      ]);
      const found = scratch ? workspace.project : workspace.projects.find((item) => item.id === projectId);
      if (!found) {
        toast('项目不存在', 'error');
        nav(scratch ? '/scratch' : '/projects', { replace: true });
        return;
      }
      setProject({ ...found, jobs: jobs.jobs || [] });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectId, scratch]);

  const startCreating = async () => {
    if (!project) return;
    if (project.canvases.length) {
      nav(canvasPath(project.canvases[0].id));
      return;
    }
    setCreating(true);
    try {
      const { canvas } = await api.createCanvas(project.id, { name: '主画布' });
      nav(canvasPath(canvas.id));
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const createCanvas = async (event) => {
    event.preventDefault();
    if (!name.trim() || !project) return;
    setCreating(true);
    try {
      const { canvas } = await api.createCanvas(project.id, { name: name.trim() });
      setProject((current) => ({ ...current, canvases: [canvas, ...current.canvases] }));
      setModal(null);
      setName('');
      nav(canvasPath(canvas.id));
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const rename = async (event) => {
    event.preventDefault();
    if (!name.trim() || !project) return;
    try {
      if (modal?.type === 'project') {
        const { project: updated } = await api.renameProject(project.id, { name: name.trim() });
        setProject((current) => ({ ...current, name: updated.name }));
      } else {
        await api.saveCanvas(modal.canvas.id, { name: name.trim() });
        setProject((current) => ({ ...current, canvases: current.canvases.map((canvas) => canvas.id === modal.canvas.id ? { ...canvas, name: name.trim() } : canvas) }));
      }
      setModal(null);
      setName('');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const deleteCanvas = async (canvas) => {
    if (!window.confirm(`删除「${canvas.name}」画布？生成任务和结果会保留在项目中。`)) return;
    try {
      await api.deleteCanvas(canvas.id);
      await load();
      toast('画布已删除', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  if (loading || !project) return <div className="grid min-h-full place-items-center"><Spinner size={24} /></div>;

  const latestCanvas = project.canvases[0];

  return (
    <div className="mx-auto w-full max-w-6xl px-7 py-8">
      <button onClick={() => nav(scratch ? '/scratch' : '/projects')} className="mb-5 inline-flex items-center gap-1.5 text-[12px] text-mist-400 transition hover:text-brand-500">
        <ArrowLeft size={14} /> {scratch ? 'Mua 画布' : '所有项目'}
      </button>

      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-brand-500"><Layers3 size={15} /> {scratch ? '零散创作' : '项目文件夹'}</div>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[26px] font-semibold tracking-tight text-[#171a24]">{project.name}</h1>
            {!scratch && <button
              type="button"
              title="重命名项目"
              onClick={() => { setName(project.name); setModal({ type: 'project' }); }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mist-400 hover:bg-white hover:text-brand-500"
            ><Pencil size={14} /></button>}
          </div>
          <p className="mt-1.5 text-[13px] text-mist-400">{project.canvases.length} 张画布，{project.jobCount || 0} 个生成任务</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setName(''); setModal({ type: 'canvas' }); }}>
            <FilePlus2 size={15} /> 新建画布
          </Button>
          <Button onClick={startCreating} loading={creating}>
            <Sparkles size={15} /> {latestCanvas ? '开始创作' : '创建主画布'}
          </Button>
        </div>
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[#171a24]">项目画布</h2>
          <span className="text-[11px] text-mist-400">每张画布独立保存</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {project.canvases.map((canvas, index) => (
            <article key={canvas.id} className="card group p-4 transition hover:border-brand-400/40 hover:shadow-[0_18px_40px_-28px_rgba(76,70,245,.35)]">
              <button type="button" onClick={() => nav(canvasPath(canvas.id))} className="block w-full text-left">
                <div className="mb-4 flex h-32 items-center justify-center overflow-hidden rounded-xl border border-[#eef0f6] bg-[radial-gradient(#cfd4e2_1px,transparent_1px)] [background-size:16px_16px]">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white bg-white/90 text-brand-500 shadow-sm">
                    <Layers3 size={22} strokeWidth={1.7} />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-semibold text-[#171a24]">{canvas.name}</h3>
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-mist-400"><Clock3 size={12} /> 更新于 {formatDate(canvas.updatedAt)}</p>
                  </div>
                  <ArrowUpRight size={16} className="shrink-0 text-mist-400 group-hover:text-brand-500" />
                </div>
              </button>
              <div className="mt-3 flex justify-end gap-1 border-t border-[#eef0f6] pt-2">
                <button type="button" onClick={() => { setName(canvas.name); setModal({ type: 'canvas', canvas }); }} className="rounded-lg p-1.5 text-mist-400 hover:bg-[#f3efff] hover:text-brand-500" title="重命名画布"><Pencil size={13} /></button>
                {project.canvases.length > 1 && <button type="button" onClick={() => deleteCanvas(canvas)} className="rounded-lg p-1.5 text-mist-400 hover:bg-rose-50 hover:text-rose-500" title="删除画布"><Trash2 size={13} /></button>}
              </div>
              {index === 0 && <span className="sr-only">最近使用</span>}
            </article>
          ))}
          <button type="button" onClick={() => { setName(''); setModal({ type: 'canvas' }); }} className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-[#cfd4e2] bg-white/40 text-mist-400 transition hover:border-brand-400/50 hover:bg-white hover:text-brand-500">
            <span className="text-center"><Plus size={22} className="mx-auto mb-2" /><span className="text-[13px] font-medium">新建另一张画布</span></span>
          </button>
        </div>
      </section>

      {!!project.jobs?.length && (
        <section className="mt-9">
          <h2 className="mb-3 text-[14px] font-semibold text-[#171a24]">最近生成</h2>
          <div className="card divide-y divide-[#eef0f6] px-4">
            {project.jobs.slice(0, 5).map((job) => (
              <div key={job.id} className="flex items-center gap-3 py-3 text-[12px]">
                <span className={`h-2 w-2 rounded-full ${job.status === 'completed' ? 'bg-emerald-400' : job.status === 'failed' ? 'bg-rose-400' : 'bg-brand-400'}`} />
                <span className="min-w-0 flex-1 truncate text-[#3c4458]">{job.prompt}</span>
                <span className="shrink-0 text-mist-400">{job.type === 'video' ? '视频' : '图片'} · {formatDate(job.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.type === 'project' ? '重命名项目' : modal?.canvas ? '重命名画布' : '新建画布'}>
        <form onSubmit={modal?.type === 'canvas' && !modal.canvas ? createCanvas : rename} className="space-y-4">
          <Field label={modal?.type === 'project' ? '项目名称' : '画布名称'}>
            <Input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModal(null)}>取消</Button>
            <Button type="submit" loading={creating}>{modal?.type === 'canvas' && !modal.canvas ? '创建画布' : '保存名称'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
