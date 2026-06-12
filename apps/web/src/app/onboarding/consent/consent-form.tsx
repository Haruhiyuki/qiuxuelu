'use client';

import { Alert, Button } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { recordConsent } from '@/server/actions/consent';

export function ConsentForm() {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await recordConsent(agree);
    if (r.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError(r.error);
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-4">
      {error !== null ? <Alert variant="danger">{error}</Alert> : null}
      <label className="flex items-start gap-3 text-ink-700 text-sm leading-relaxed">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-1 h-4 w-4"
        />
        <span>
          我已阅读并同意：我发布与贡献的内容以{' '}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans"
            rel="license noopener"
            target="_blank"
            className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
          >
            CC BY-SA 4.0
          </a>{' '}
          协议共享（署名归原作者及贡献者，修订历史即贡献凭证），并遵守{' '}
          <a
            href="/covenant"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
          >
            社区公约
          </a>
          。
        </span>
      </label>
      <Button onClick={submit} loading={busy} disabled={!agree} className="self-start">
        同意并继续
      </Button>
    </div>
  );
}
