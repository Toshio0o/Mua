import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Folder, Layers3, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Field, Input, Modal, Spinner, useToast } from '../components/ui.jsx';

const MIGRATED_KEY = 'mua_legacy_workspace_migrated';

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

function findLegacyCanvas() {
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || ['xm_projects', 'xm_job_projects', 'muse_studio_token'].includes(key)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(value?.nodes) && Array.isArray(value?.links)) return value;
    } catch { /* Skip unrelated storage entries. */ }
  }
  return null;
}

function formatDate(value) {
  if (!value) return '尚未创作';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value));
}

export default function Projects() {
  const nav = useNavigate();
  const toast = useToast();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [name, setName] = useState('');

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const legacy = localStorage.getItem(MIGRATED_KEY) ? {} : {
          legacyProjects: readJson('xm_projects', []),
          legacyJobProjects: readJson('xm_job_projects', {}),
          legacyDocument: findLegacyCanvas(),
        };
        const out = await api.bootstrapProjects(legacy);
        if (!active) return;
        setProjects(out.projects || []);
        localStorage.setItem(MIGRATED_KEY, '1');
      } catch (error) {
        if (active) toast(error.message, 'error');
      } finally {
        if (active) setLoading(false);
      }
    };
    initialize();
    return () => { active = false; };
  }, [toast]);

  const createProject = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { project } = await api.createProject({ name: name.trim() });
      setProjects((items) => [project, ...items]);
      setModal(null);
      setName('');
      nav(`/projects/${project.id}`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const renameProject = async (event) => {
    event.preventDefault();
    if (!name.trim() || !modal?.project) return;
    setSaving(true);
    try {
      const { project: updated } = await api.renameProject(modal.project.id, { name: name.trim() });
      setProjects((items) => items.map((item) => item.id === updated.id ? { ...item, name: updated.name, updatedAt: updated.updatedAt } : item));
      setModal(null);
      setName('');
      toast('文件夹已重命名', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async (event) => {
    event.preventDefault();
    if (!modal?.project) return;
    setSaving(true);
    try {
      await api.deleteProject(modal.project.id);
      setProjects((items) => items.filter((item) => item.id !== modal.project.id));
      setModal(null);
      toast('文件夹已删除，生成记录已保留', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const submitModal = modal?.type === 'create' ? createProject : modal?.type === 'rename' ? renameProject : deleteProject;

  return (
    <div className="mx-auto w-full max-w-6xl px-7 py-8">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-brand-500">
            <Sparkles size={15} /> Mua 工作区
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-[#171a24]">项目管理</h1>
          <p className="mt-1.5 text-[13px] text-mist-400">按项目整理创作，每个项目可以拥有多张独立画布。</p>
        </div>
        <Button onClick={() => { setName(''); setModal({ type: 'create' }); }}>
          <Plus size={16} /> 新建项目
        </Button>
      </header>

      {loading ? (
        <div className="grid min-h-64 place-items-center"><Spinner size={24} /></div>
      ) : projects.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className="card group relative p-5 transition hover:-translate-y-0.5 hover:border-brand-400/40 hover:shadow-[0_18px_40px_-28px_rgba(76,70,245,.35)]"
            >
              <div className="mb-5 flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f3efff] text-brand-500">
                  <Folder size={21} strokeWidth={1.8} />
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" title="重命名文件夹" aria-label={`重命名${project.name}`} onClick={() => { setName(project.name); setModal({ type: 'rename', project }); }} className="grid h-8 w-8 place-items-center rounded-lg text-mist-400 hover:bg-[#f3efff] hover:text-brand-500"><Pencil size={14} /></button>
                  <button type="button" title="删除文件夹" aria-label={`删除${project.name}`} onClick={() => setModal({ type: 'delete', project })} className="grid h-8 w-8 place-items-center rounded-lg text-mist-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={14} /></button>
                  <ArrowUpRight size={17} className="ml-1 text-mist-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-500" />
                </div>
              </div>
              <button type="button" onClick={() => nav(`/projects/${project.id}`)} className="block w-full text-left">
                <h2 className="truncate text-[16px] font-semibold text-[#171a24]">{project.name}</h2>
                <div className="mt-3 flex items-center gap-4 text-[12px] text-mist-400">
                  <span className="inline-flex items-center gap-1.5"><Layers3 size={14} /> {project.canvases?.length || 0} 张画布</span>
                  <span>{project.jobCount || 0} 个生成任务</span>
                </div>
                <p className="mt-4 border-t border-[#eef0f6] pt-3 text-[11px] text-mist-400">最近更新 {formatDate(project.updatedAt)}</p>
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="card grid min-h-64 place-items-center px-6 py-10 text-center">
          <div>
            <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#f3efff] text-brand-500"><Folder size={22} /></span>
            <h2 className="text-[16px] font-semibold text-[#171a24]">先建立一个项目</h2>
            <p className="mt-1.5 text-[13px] text-mist-400">项目会有自己的画布和生成记录。</p>
            <Button className="mt-5" onClick={() => { setName(''); setModal({ type: 'create' }); }}><Plus size={15} /> 新建项目</Button>
          </div>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.type === 'create' ? '新建文件夹' : modal?.type === 'rename' ? '重命名文件夹' : '删除文件夹'}>
        <form onSubmit={submitModal} className="space-y-4">
          {modal?.type === 'delete' ? (
            <div className="space-y-2 text-[13px] leading-6 text-mist-300">
              <p>确定删除「{modal.project.name}」文件夹及其中的画布吗？</p>
              <p>画布内容会删除，生成记录和结果会保留在作品历史中。</p>
            </div>
          ) : (
            <Field label="文件夹名称" hint={modal?.type === 'create' ? '创建后会自动生成一张主画布。' : undefined}>
              <Input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：春季品牌短片" required />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModal(null)}>取消</Button>
            {modal?.type === 'delete' ? (
              <Button type="submit" variant="danger" loading={saving}><Trash2 size={15} /> 删除文件夹</Button>
            ) : modal?.type === 'rename' ? (
              <Button type="submit" loading={saving}><Pencil size={15} /> 保存名称</Button>
            ) : (
              <Button type="submit" loading={saving}><Plus size={15} /> 创建文件夹</Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
