import { useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BookOpen, FolderKanban, Workflow, KeyRound, LogOut, Camera, Loader2, Shield, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../store/auth.jsx';
import { api } from '../lib/api.js';
import ThemeToggle from './ThemeToggle.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';
import { Modal, useToast } from './ui.jsx';
import webPackage from '../../package.json';

/** 侧栏提供项目管理和 muse 账号导入入口。 */
const NAV = [
  { to: '/projects', label: '项目管理', icon: FolderKanban },
  { to: '/scratch', label: 'Mua 画布', icon: Workflow },
  { to: '/accounts', label: 'muse导入', icon: KeyRound },
];

export default function Layout() {
  const { user, logout, patchUser } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const avatarRef = useRef(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const sidebarKey = `mua_sidebar_expanded_${user?.id || user?.email || 'default'}`;
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem(sidebarKey) !== '0'; } catch { return true; }
  });
  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

  const toggleSidebar = () => setSidebarOpen((current) => {
    const next = !current;
    try { localStorage.setItem(sidebarKey, next ? '1' : '0'); } catch { /* Keep the current session preference. */ }
    return next;
  });

  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('请选择图片文件', 'error');
    if (file.size > 5 * 1024 * 1024) return toast('头像不能超过 5 MB', 'error');
    setAvatarBusy(true);
    try {
      const uploaded = await api.upload([file]);
      const updated = await api.updateMe({ avatarUrl: uploaded.files[0].url });
      patchUser({ avatarUrl: updated.user.avatarUrl });
      setAvatarLoadFailed(false);
      toast('头像已更新', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div className="relative flex h-full overflow-hidden bg-ink-900">
      {/* ---------------- 侧边栏 ---------------- */}
      <aside className={clsx('frost relative z-40 flex shrink-0 flex-col border-r border-ink-600 py-4 transition-[width] duration-200', sidebarOpen ? 'w-[224px]' : 'w-[72px]')}>
        <div className={clsx('flex w-full items-center px-3', sidebarOpen ? 'justify-between' : 'flex-col gap-3')}>
          <div className="group/logo relative z-0 hover:z-50 focus-within:z-50">
            <button
              onClick={() => nav('/projects')}
              title="Mua 项目管理"
              className="flex h-11 items-center gap-2.5"
            >
              <img src="/brand/mua-icon.png" alt="Mua" draggable="false" className="h-11 w-11 shrink-0 rounded-2xl border border-white/70 bg-white object-cover shadow-sm transition-transform duration-200 group-hover/logo:scale-110" />
              {sidebarOpen && <span className="text-[16px] font-semibold tracking-wide text-[#171a24]">Mua</span>}
            </button>
            <div className="pointer-events-none absolute left-full top-0 z-50 w-[176px] origin-top-left scale-95 pl-3 opacity-0 transition duration-200 group-hover/logo:pointer-events-auto group-hover/logo:scale-100 group-hover/logo:opacity-100 group-focus-within/logo:pointer-events-auto group-focus-within/logo:scale-100 group-focus-within/logo:opacity-100">
              <div className="rounded-3xl border border-white/80 bg-white/95 p-3 shadow-[0_18px_48px_-20px_rgba(35,44,80,.35)] backdrop-blur-xl">
                <img src="/brand/mua-icon.png" alt="Mua 品牌 Logo 放大预览" draggable="false" className="aspect-square w-full rounded-2xl border border-[#edf0f6] bg-white object-cover" />
                <p className="mt-2 text-center text-[11px] font-medium tracking-wide text-[#596176]">Mua 品牌 Logo</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mist-400 transition hover:bg-ink-800 hover:text-ink-950"
          >
            {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
        </div>

        <nav className={clsx('mt-8 flex w-full flex-col gap-1.5', sidebarOpen ? 'items-stretch px-3' : 'items-center px-2')}>
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} expanded={sidebarOpen} />
          ))}
          <button
            type="button"
            title="使用教程"
            onClick={() => setTutorialOpen(true)}
            className={clsx(
              'group relative flex w-full items-center rounded-2xl py-2.5 transition',
              sidebarOpen ? 'gap-3 px-3 text-left' : 'justify-center',
              'text-mist-400 hover:bg-ink-800 hover:text-ink-950'
            )}
          >
            <BookOpen size={19} strokeWidth={1.8} />
            {sidebarOpen && <span className="text-[13px] font-medium">使用教程</span>}
          </button>
        </nav>

        <div className={clsx('mt-auto flex w-full flex-col gap-2', sidebarOpen ? 'items-stretch px-3' : 'items-center')}>
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            title="修改密码"
            aria-label="修改密码"
            className={clsx('flex rounded-xl py-2 text-mist-400 transition hover:bg-ink-800 hover:text-ink-950', sidebarOpen ? 'items-center gap-3 px-3 text-left' : 'w-10 flex-col items-center gap-1')}
          >
            <Shield size={16} strokeWidth={1.8} />
            {sidebarOpen && <span className="text-[13px] font-medium">修改密码</span>}
          </button>
          <div className={clsx('relative flex items-center', sidebarOpen ? 'gap-3 px-2 py-1' : 'justify-center')}>
            <button
              type="button"
              onClick={() => avatarRef.current?.click()}
              title="上传头像"
              aria-label="上传头像"
              className="group relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-ink-600 bg-ink-800 text-[12px] font-semibold text-ink-950"
            >
              {user?.avatarUrl && !avatarLoadFailed ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setAvatarLoadFailed(true)}
                />
              ) : initial}
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                {avatarBusy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </span>
            </button>
            <input ref={avatarRef} type="file" accept="image/*" hidden onChange={uploadAvatar} />
            {sidebarOpen && <span className="min-w-0 truncate text-[12px] text-mist-300">{user?.name || user?.email}</span>}
          </div>
          <div className={clsx('flex items-center', sidebarOpen ? 'gap-3 px-2' : 'justify-center')}>
            <ThemeToggle compact={!sidebarOpen} />
            {sidebarOpen && <span className="text-[13px] text-mist-300">主题</span>}
          </div>
          <button
            onClick={logout}
            title="退出登录"
            className={clsx('flex h-9 items-center rounded-lg text-mist-400 transition hover:bg-ink-700 hover:text-rose-500', sidebarOpen ? 'gap-3 px-3 text-left' : 'w-9 justify-center')}
          >
            <LogOut size={14} />
            {sidebarOpen && <span className="text-[13px]">退出登录</span>}
          </button>
          <span className={clsx('mt-1 font-mono tracking-wide text-mist-400/70', sidebarOpen ? 'px-3 text-[10px]' : 'text-center text-[8px]')}>{sidebarOpen ? `Mua v${webPackage.version}` : `v${webPackage.version}`}</span>
        </div>
      </aside>

      {/* ---------------- 主区 ---------------- */}
      <main className="page-bg min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <Modal open={tutorialOpen} onClose={() => setTutorialOpen(false)} title="Mua 画布使用教程" width="max-w-2xl">
        <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1 text-[13px] leading-6 text-mist-300">
          <section>
            <h4 className="mb-2 font-semibold text-[#171a24]">基本操作</h4>
            <ul className="space-y-1.5">
              <li>左键点击节点可选择，拖动节点可移动位置。</li>
              <li>在空白处按住左键拖动可框选节点；按住 Shift 点击可追加或取消单个节点，Shift 框选可追加节点。</li>
              <li>右键点击节点也可选择；右键拖动不会移动节点。</li>
              <li>按住鼠标中键拖动可平移画布，普通滚轮上下移动画布。</li>
              <li>在画布内按住 Ctrl 滚动滚轮可缩放画布，浏览器缩放不会触发，缩放以鼠标位置为中心。</li>
              <li>双击空白区域添加节点；拖动节点圆点可连接节点，拖到空白处可新建并自动连线。</li>
              <li>可将图片或视频拖到画布，也可从系统剪贴板粘贴；选中节点后可跨画布复制粘贴。</li>
            </ul>
          </section>
          <section>
            <h4 className="mb-2 font-semibold text-[#171a24]">快捷键</h4>
            <div className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-1.5">
              <kbd className="w-fit rounded bg-[#eef0f6] px-1.5 py-0.5 text-[11px]">Ctrl+C / Ctrl+V</kbd><span>复制和粘贴选中节点</span>
              <kbd className="w-fit rounded bg-[#eef0f6] px-1.5 py-0.5 text-[11px]">Ctrl+滚轮</kbd><span>画布内缩放</span>
              <kbd className="w-fit rounded bg-[#eef0f6] px-1.5 py-0.5 text-[11px]">Delete / Backspace</kbd><span>删除选中节点或连线</span>
              <kbd className="w-fit rounded bg-[#eef0f6] px-1.5 py-0.5 text-[11px]">Esc</kbd><span>清除选择并关闭节点菜单</span>
              <kbd className="w-fit rounded bg-[#eef0f6] px-1.5 py-0.5 text-[11px]">Shift+左键</kbd><span>追加选择节点或框选</span>
            </div>
          </section>
        </div>
      </Modal>
    </div>
  );
}

function NavItem({ to, label, icon: Icon, expanded }) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        clsx(
          'group relative flex w-full rounded-2xl py-2.5 transition',
          expanded ? 'items-center gap-3 px-3' : 'flex-col items-center gap-1',
          isActive ? 'bg-brand-500/10 text-brand-500' : 'text-mist-400 hover:bg-ink-800 hover:text-ink-950'
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute -left-2 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-[#4f7cff] to-[#b14cff]" />
          )}
          <Icon size={19} strokeWidth={1.8} className={isActive ? 'text-brand-300' : ''} />
          <span className={clsx('font-medium tracking-wide', expanded ? 'text-[13px]' : 'text-[11px]')}>{label}</span>
        </>
      )}
    </NavLink>
  );
}
