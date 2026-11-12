import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, ArrowRight, Gift, Zap, Film, Layers } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../store/auth.jsx';
import { Button, Field, Input, useToast } from '../components/ui.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

const HIGHLIGHTS = [
  { icon: Film, title: '文生视频 · 图生视频', desc: '一句话出 5–10 秒成片，首尾帧与参考图都能喂' },
  { icon: Layers, title: 'Mua 画布 · 节点工作流', desc: '拖拽节点串起生成流程，自动保存不用管' },
  { icon: Zap, title: '账号池 · 自动调度', desc: '多账号轮转与续期，失败自动退还积分' },
];

export default function Login() {
  const { login, register } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const ref = params.get('ref') || '';
  const [mode, setMode] = useState(ref ? 'register' : 'login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password);
        toast('欢迎回来', 'ok');
      } else {
        await register(form.email.trim(), form.password, form.name.trim() || undefined, ref || undefined);
        toast(ref ? '注册成功，受邀奖励已到账' : '注册成功，已赠送积分', 'ok');
      }
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-bg flex h-full items-center justify-center overflow-hidden px-4 py-10">
      <div className="absolute right-5 top-5">
        <ThemeToggle drop="down" />
      </div>
      <div className="relative grid w-full max-w-[1000px] gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center">
        {/* ---------------- 左：品牌 ---------------- */}
        <div className="hidden lg:block">
          <div className="flex items-baseline gap-1">
            <span className="font-display text-[36px] font-extrabold italic leading-none tracking-tight text-[#171a24]">Muse</span>
            <span className="font-display text-[36px] font-extrabold leading-none tracking-tighter brand-text">API</span>
            <span className="mb-3 text-[13px] font-semibold uppercase tracking-[0.1em] text-brand-400">-Video</span>
          </div>

          <h1 className="mt-6 text-[30px] font-semibold leading-tight tracking-tight text-[#171a24]">
            把一句话<br />
            变成<span className="brand-text"> 能用的片子</span>
          </h1>
          <p className="mt-3 max-w-md text-[13px] leading-relaxed text-mist-400">
            Mua 集图片、视频生成、画布创作与账号管理于一体。
          </p>

          <div className="mt-8 space-y-3">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="flex items-start gap-3">
                <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#e6eaf2] bg-white text-brand-500 shadow-sm">
                  <h.icon size={15} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-mist-200">{h.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-mist-400">{h.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 font-mono text-[10px] tracking-[0.2em] text-ink-500">
            MUSE.AI · ACCOUNT POOL · VIDEO GENERATION
          </p>
        </div>

        {/* ---------------- 右：表单 ---------------- */}
        <div className="w-full">
          {/* 移动端 logo */}
          <div className="mb-7 flex items-baseline justify-center gap-1 lg:hidden">
            <span className="font-display text-[24px] font-extrabold italic text-[#171a24]">Muse</span>
            <span className="font-display text-[24px] font-extrabold brand-text">API</span>
            <span className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-brand-400">-Video</span>
          </div>

          <div className="frost rounded-2xl border border-white p-6 shadow-[0_24px_60px_-36px_rgba(55,65,120,.55)]">
            <div className="capsule-bar mb-5 w-full">
              {[
                ['login', '登录'],
                ['register', '注册'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => { setMode(k); setErr(''); }}
                  className={clsx(
                    'flex-1',
                    mode === k && 'on'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-3.5">
              {ref && (
                <div className="flex items-center gap-2 rounded-lg border border-brand-400/20 bg-[#f3efff] px-3 py-2 text-[11.5px] text-brand-600">
                  <Gift size={13} /> 你被邀请注册，完成后双方各得 50 积分
                </div>
              )}

              {mode === 'register' && (
                <Field label="昵称">
                  <Input value={form.name} onChange={set('name')} placeholder="随便起个名字" />
                </Field>
              )}

              <Field label="邮箱">
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={set('email')}
                  placeholder="you@example.com"
                  autoComplete="username"
                />
              </Field>

              <Field label="密码" hint={mode === 'register' ? '至少 6 位' : undefined}>
                <Input
                  type="password"
                  required
                  value={form.password}
                  onChange={set('password')}
                  placeholder={mode === 'register' ? '至少 6 位' : '输入密码'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </Field>

              {err && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-600">
                  {err}
                </div>
              )}

              <Button type="submit" size="lg" loading={loading} className="w-full">
                {mode === 'login' ? '进入工作台' : '注册并开始'}
                {!loading && <ArrowRight size={16} />}
              </Button>
            </form>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-[10.5px] text-ink-500">
              <Sparkles size={11} /> 首次使用请先在「账号管理」绑定 muse.ai 账号
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
