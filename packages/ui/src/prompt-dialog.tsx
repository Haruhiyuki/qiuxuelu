'use client';

// usePrompt：把 window.prompt 升级为可访问输入弹窗。prompt() 返回 Promise<string|null>，渲染 promptDialog 节点。
import { useCallback, useRef, useState } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import { Input } from './input';
import { Label } from './label';
import { Textarea } from './textarea';

export interface PromptOptions {
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  multiline?: boolean;
  required?: boolean;
}

export function usePrompt() {
  const resolveRef = useRef<((v: string | null) => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<PromptOptions>({ title: '' });
  const [value, setValue] = useState('');

  const prompt = useCallback((options: PromptOptions) => {
    setOpts(options);
    setValue(options.defaultValue ?? '');
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((v: string | null) => {
    resolveRef.current?.(v);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  const trimmed = value.trim();
  const blocked = (opts.required ?? false) && trimmed.length === 0;

  const promptDialog = (
    <Dialog open={open} onClose={() => settle(null)} title={opts.title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked) {
            return;
          }
          settle(trimmed);
        }}
        className="mt-3 flex flex-col gap-3"
      >
        {opts.label ? <Label htmlFor="prompt-input">{opts.label}</Label> : null}
        {opts.multiline ? (
          <Textarea
            id="prompt-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={opts.placeholder}
            rows={3}
          />
        ) : (
          <Input
            id="prompt-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={opts.placeholder}
          />
        )}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => settle(null)}>
            取消
          </Button>
          <Button type="submit" disabled={blocked}>
            {opts.confirmLabel ?? '确定'}
          </Button>
        </div>
      </form>
    </Dialog>
  );

  return { prompt, promptDialog };
}
