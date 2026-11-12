import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { clsx } from 'clsx';
import { applyTheme, readTheme } from '../theme.js';

const OPTIONS = [
  ['system', '跟随系统', Monitor],
  ['light', '浅色', Sun],
  ['dark', '深色', Moon],
];

export default function ThemeToggle({ compact = false, drop = 'up' }) {
  const [mode, setMode] = useState(readTheme);
  const [open, setOpen] = useState(false);
  const current = OPTIONS.find(([k]) => k === mode) || OPTIONS[0];
  const Icon = current[2];

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setMode(applyTheme(readTheme()));
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        title={`主题：${current[1]}`}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'grid place-items-center rounded-xl border border-ink-600 bg-ink-800 text-mist-300 transition hover:text-ink-950',
          compact ? 'h-8 w-8' : 'h-9 w-9'
        )}
      >
        <Icon size={15} />
      </button>
      {open && (
        <div className={clsx(
          'absolute z-40 w-[132px] rounded-2xl border border-ink-600 bg-ink-800 p-1.5 shadow-xl',
          'left-full ml-2',
          drop === 'down' ? 'top-11' : 'bottom-11'
        )}>
          {OPTIONS.map(([k, label, ItemIcon]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setMode(applyTheme(k));
                setOpen(false);
              }}
              className={clsx(
                'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12px]',
                mode === k ? 'bg-brand-500/10 text-brand-500' : 'text-mist-200 hover:bg-ink-700'
              )}
            >
              <ItemIcon size={13} /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
