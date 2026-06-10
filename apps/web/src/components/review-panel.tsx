'use client';

import { Alert, Button, Label, Textarea } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { REJECT_REASON_CODES, REJECT_REASON_LABELS } from '@/lib/review-reasons';
import { approvePublish, rejectPublish } from '@/server/actions/review';

export interface ReviewPanelProps {
  requestId: string;
  /** 审稿人即申请人：界面直接禁用（服务端同样会拒绝，这里只是显隐层）。 */
  selfReview: boolean;
}

export function ReviewPanel({ requestId, selfReview }: ReviewPanelProps) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'danger'; text: string } | null>(null);

  async function handleApprove() {
    if (!window.confirm('确认通过审批？该修订将立即发布并公开可见。')) {
      return;
    }
    setPending(true);
    setMessage(null);
    const result = await approvePublish(requestId);
    if (result.ok) {
      setMessage({ kind: 'info', text: '已通过审批，文章已发布' });
      router.refresh();
    } else {
      setMessage({ kind: 'danger', text: result.error });
    }
    setPending(false);
  }

  async function handleReject() {
    if (reason === '') {
      setMessage({ kind: 'danger', text: '驳回必须选择理由码' });
      return;
    }
    setPending(true);
    setMessage(null);
    const result = await rejectPublish(requestId, reason, note);
    if (result.ok) {
      setMessage({ kind: 'info', text: '已驳回，文章退回草稿状态' });
      setRejectOpen(false);
      router.refresh();
    } else {
      setMessage({ kind: 'danger', text: result.error });
    }
    setPending(false);
  }

  if (selfReview) {
    return <Alert variant="warn">不能审批自己提交的发布请求，请等待其他审稿人处理。</Alert>;
  }

  return (
    <div className="flex flex-col gap-3">
      {message !== null ? (
        <Alert variant={message.kind === 'info' ? 'info' : 'danger'}>{message.text}</Alert>
      ) : null}
      <div className="flex items-center gap-3">
        <Button onClick={handleApprove} disabled={pending}>
          {pending ? '处理中…' : '通过并发布'}
        </Button>
        <Button variant="danger" onClick={() => setRejectOpen((open) => !open)} disabled={pending}>
          驳回…
        </Button>
      </div>
      {rejectOpen ? (
        <section className="flex flex-col gap-3 rounded-sm border border-ink-200 bg-paper-50 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reject-reason">驳回理由（必选）</Label>
            <select
              id="reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="h-9 rounded-sm border border-ink-200 bg-paper-50 px-3 text-sm text-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <option value="">请选择理由码…</option>
              {REJECT_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {REJECT_REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reject-note">备注（给作者的修改建议）</Label>
            <Textarea
              id="reject-note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：第二节的时间线与标题不符，建议补充具体复习安排"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button variant="danger" onClick={handleReject} disabled={pending}>
              确认驳回
            </Button>
            <Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={pending}>
              取消
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
