import { useState } from 'react';
import { Check, Shield } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Field, Input, Modal, useToast } from './ui.jsx';

export default function ChangePasswordModal({ open, onClose }) {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    if (saving) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (newPassword.length < 12) return toast('新密码至少需要 12 个字符', 'error');
    if (newPassword !== confirmPassword) return toast('两次输入的新密码不一致', 'error');

    setSaving(true);
    try {
      await api.updateMe({ password: newPassword, oldPassword: currentPassword });
      toast('密码已更新', 'ok');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onClose();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="修改密码" width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[12px] leading-relaxed text-mist-400">
          修改后请使用新密码登录。建议使用至少 12 个字符的独立密码。
        </p>
        <Field label="当前密码">
          <Input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
        </Field>
        <Field label="新密码" hint="至少 12 个字符">
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>
        <Field label="确认新密码">
          <Input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={close} disabled={saving}>取消</Button>
          <Button type="submit" loading={saving}>
            <Check size={14} /> 保存新密码
          </Button>
        </div>
      </form>
    </Modal>
  );
}
