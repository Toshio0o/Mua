import { useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Sparkles, Workflow, KeyRound, LogOut, Camera, Loader2, Shield } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../store/auth.jsx';
import { api } from '../lib/api.js';
import ThemeToggle from './ThemeToggle.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';
import { useToast } from './ui.jsx';
import webPackage from '../../package.json';

/** 侧栏只保留三个入口：快捷创作 / 无限画布 / muse 导入 */
const NAV = [
  { to: '/create', label: '快捷创作', icon: Sparkles },
  { to: '/canvas', label: 'Mua 画布', icon: Workflow },
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
  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

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
      {/* ---------------- 细侧栏 ---------------- */}
      <aside className="frost relative z-20 flex w-[84px] shrink-0 flex-col items-center border-r border-ink-600 py-4">
        <button
          onClick={() => nav('/create')}
          title="Mua"
          className="mint-btn grid h-11 w-11 place-items-center rounded-2xl"
        >
          <Sparkles size={20} strokeWidth={2.2} />
        </button>

        <nav className="mt-8 flex w-full flex-col items-center gap-1.5 px-2">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            title="修改密码"
            aria-label="修改密码"
            className="flex w-full flex-col items-center gap-1 rounded-xl py-1.5 text-mist-400 transition hover:bg-ink-800 hover:text-ink-950"
          >
            <Shield size={16} strokeWidth={1.8} />
            <span className="text-[9px] font-medium">修改密码</span>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => avatarRef.current?.click()}
              title="上传头像"
              aria-label="上传头像"
              className="group relative grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-ink-600 bg-ink-800 text-[12px] font-semibold text-ink-950"
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
          </div>
          <ThemeToggle />
          <button
            onClick={logout}
            title="退出登录"
            className="grid h-8 w-8 place-items-center rounded-lg text-mist-400 transition hover:bg-ink-700 hover:text-rose-500"
          >
            <LogOut size={14} />
          </button>
          <span className="mt-1 font-mono text-[8px] tracking-wide text-mist-400/70">Mua v{webPackage.version}</span>
        </div>
      </aside>

      {/* ---------------- 主区 ---------------- */}
      <main className="page-bg min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

function NavItem({ to, label, icon: Icon }) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        clsx(
          'group relative flex w-full flex-col items-center gap-1 rounded-2xl py-2.5 transition',
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
          <span className="text-[11px] font-medium tracking-wide">{label}</span>
        </>
      )}
    </NavLink>
  );
}
