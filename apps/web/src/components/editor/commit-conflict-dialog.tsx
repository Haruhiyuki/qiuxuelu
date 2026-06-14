'use client';

// 直接提交撞「同块两人都改」的真冲突时弹出：逐块在「你的版本 / 当前版本」间裁决，按裁决重新提交（合并）。
// 与修订申请的三栏裁决同形（ADR-0012）；裁决结果回传 commitRevision(docId, message, resolutions)。
import { useState } from 'react';
import type { CommitConflictView, ConflictResolutions } from '@/server/merge';

export function CommitConflictDialog({
  conflicts,
  pending,
  error,
  onResolve,
  onCancel,
}: {
  conflicts: CommitConflictView[];
  pending: boolean;
  error: string | null;
  onResolve: (resolutions: ConflictResolutions) => void;
  onCancel: () => void;
}) {
  const [choices, setChoices] = useState<ConflictResolutions>({});
  const allChosen = conflicts.every((c) => choices[c.blockId] !== undefined);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="解决提交冲突"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onCancel}
        className="overlay-in absolute inset-0 bg-ink-900/40 backdrop-blur-[1px]"
      />
      <div className="pop-in relative flex max-h-[88vh] w-[min(44rem,94vw)] flex-col overflow-hidden rounded-lg border border-ink-200 bg-paper-50 shadow-float">
        <header className="border-ink-200/70 border-b px-5 py-3.5">
          <h2 className="font-medium font-serif text-ink-900 text-lg">提交冲突需要裁决</h2>
          <p className="mt-1 text-ink-500 text-sm leading-relaxed">
            你编辑期间，他人已提交了对同一段落的改动。其余改动已自动合并；以下 {conflicts.length}{' '}
            处同段冲突请逐处选择保留哪一版，然后按裁决提交。
          </p>
        </header>

        <ul className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          {conflicts.map((c, i) => {
            const choice = choices[c.blockId];
            return (
              <li key={c.blockId} className="rounded-md border border-ink-200 bg-paper-100 p-4">
                <p className="mb-3 font-medium text-ink-600 text-sm">冲突 {i + 1}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label
                    className={`flex cursor-pointer flex-col gap-2 rounded-sm border p-3 transition-colors ${
                      choice === 'ours' ? 'border-brand-500 bg-brand-50' : 'border-ink-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`c-${c.blockId}`}
                        checked={choice === 'ours'}
                        onChange={() => setChoices((p) => ({ ...p, [c.blockId]: 'ours' }))}
                      />
                      <span className="font-medium text-ink-800">你的版本</span>
                    </span>
                    <span className="whitespace-pre-wrap text-ink-600 text-sm leading-relaxed">
                      {c.oursText ?? '（你删除了此段）'}
                    </span>
                  </label>
                  <label
                    className={`flex cursor-pointer flex-col gap-2 rounded-sm border p-3 transition-colors ${
                      choice === 'theirs' ? 'border-brand-500 bg-brand-50' : 'border-ink-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`c-${c.blockId}`}
                        checked={choice === 'theirs'}
                        onChange={() => setChoices((p) => ({ ...p, [c.blockId]: 'theirs' }))}
                      />
                      <span className="font-medium text-ink-800">当前版本</span>
                    </span>
                    <span className="whitespace-pre-wrap text-ink-600 text-sm leading-relaxed">
                      {c.theirsText ?? '（当前已删除此段）'}
                    </span>
                  </label>
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="flex items-center gap-3 border-ink-200/70 border-t px-5 py-3.5">
          {error !== null ? <span className="text-accent-700 text-sm">{error}</span> : null}
          <button
            type="button"
            onClick={() => onResolve(choices)}
            disabled={pending || !allChosen}
            className="ml-auto rounded-sm bg-fill px-4 py-2 font-medium text-on-fill text-sm transition-colors hover:bg-fill-hover disabled:opacity-50"
          >
            {pending ? '合并提交中…' : '按裁决提交'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-ink-500 text-sm transition-colors hover:text-ink-700 disabled:opacity-50"
          >
            取消
          </button>
        </footer>
      </div>
    </div>
  );
}
