'use client';

// 通行密钥（WebAuthn）自助管理：列出已注册凭证、添加（唤起系统验证器，
// Apple 设备即面容/触控 ID + iCloud 钥匙串）、删除。私钥不经过服务器。
import { Alert, Button, Input, Label, useConfirm, useToast } from '@harublog/ui';
import { KeyRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { formatDate } from '@/lib/format';

interface PasskeyItem {
  id: string;
  name?: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt?: Date | string | null;
}

export function PasskeySection() {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [items, setItems] = useState<PasskeyItem[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reload = useCallback(async () => {
    const { data, error: listError } = await authClient.passkey.listUserPasskeys();
    if (listError) {
      setItems([]);
      return;
    }
    setItems((data ?? []) as PasskeyItem[]);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleAdd() {
    setError(null);
    if (typeof window.PublicKeyCredential === 'undefined') {
      setError('当前浏览器不支持通行密钥');
      return;
    }
    setPending(true);
    const trimmed = name.trim();
    const res = await authClient.passkey.addPasskey(trimmed.length > 0 ? { name: trimmed } : {});
    if (res?.error) {
      // 用户取消系统弹窗也会落到这里，文案保持中性
      setError('未完成添加：操作被取消，或设备不支持通行密钥');
      setPending(false);
      return;
    }
    toast('通行密钥已添加', 'success');
    setName('');
    setPending(false);
    await reload();
  }

  async function handleDelete(item: PasskeyItem) {
    const ok = await confirm({
      title: '删除这枚通行密钥？',
      description: `「${item.name ?? '未命名'}」删除后将无法再用它登录本站；设备/钥匙串中的对应条目需自行清理。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) {
      return;
    }
    const res = await authClient.passkey.deletePasskey({ id: item.id });
    if (res?.error) {
      toast('删除失败，请稍后重试', 'error');
      return;
    }
    toast('通行密钥已删除', 'success');
    await reload();
  }

  return (
    <section className="flex flex-col gap-3 border-ink-200 border-t pt-8">
      {confirmDialog}
      <h2 className="font-medium font-serif text-ink-800 text-lg">通行密钥</h2>
      <p className="text-ink-600 text-sm leading-relaxed">
        用面容 ID、触控 ID 或硬件密钥直接登录，免输密码与验证码，天然防钓鱼。密钥可保存在 iCloud
        钥匙串、1Password 等密码管理器中跨设备同步。
      </p>

      {items === null ? (
        <p className="text-ink-400 text-sm">加载中…</p>
      ) : items.length > 0 ? (
        <ul className="divide-y divide-ink-100 rounded-sm border border-ink-200">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <KeyRound className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink-800 text-sm">
                  {item.name ?? '未命名通行密钥'}
                </p>
                <p className="text-ink-400 text-xs">
                  {item.deviceType === 'multiDevice' ? '可跨设备同步' : '仅本设备'}
                  {item.backedUp ? ' · 已云端备份' : ''}
                  {item.createdAt ? ` · 添加于 ${formatDate(new Date(item.createdAt))}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(item)}
                className="shrink-0 text-ink-400 text-xs transition-colors hover:text-accent-700"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-400 text-sm">还没有通行密钥。</p>
      )}

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pk-name">密钥名称（可选）</Label>
          <Input
            id="pk-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：我的 iPhone"
            className="w-52"
          />
        </div>
        <Button type="button" onClick={handleAdd} disabled={pending}>
          {pending ? '等待验证器…' : '添加通行密钥'}
        </Button>
      </div>
      {error !== null ? <Alert variant="danger">{error}</Alert> : null}
    </section>
  );
}
