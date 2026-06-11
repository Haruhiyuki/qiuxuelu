'use client';

// 确认弹窗 + useConfirm：把 window.confirm 升级为可设计、可访问的确认框。
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} description={description}>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          {cancelLabel ?? '取消'}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel ?? '确认'}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * 用法：const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: '确认删除？', danger: true }))) return;
 * 并在 JSX 里渲染 {confirmDialog}。
 */
export function useConfirm() {
  const resolveRef = useRef<((v: boolean) => void) | null>(null);
  const [state, setState] = useState<{ open: boolean; opts: ConfirmOptions }>({
    open: false,
    opts: { title: '' },
  });

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setState({ open: true, opts });
      }),
    [],
  );

  const settle = useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      open={state.open}
      {...state.opts}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}
