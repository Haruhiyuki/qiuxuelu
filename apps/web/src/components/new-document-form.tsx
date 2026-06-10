'use client';

import { Alert, Button, Input, Label } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { createDocument } from '@/server/actions/document';

export interface SectionOption {
  id: string;
  name: string;
}

export function NewDocumentForm({ sections }: { sections: SectionOption[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (title.trim().length === 0) {
      setError('请输入文章标题');
      return;
    }
    if (sectionId === '') {
      setError('请选择板块');
      return;
    }
    setPending(true);
    const result = await createDocument(title, sectionId);
    if (result.ok) {
      router.push(`/write/${result.data.docId}`);
      return;
    }
    setError(result.error);
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {error !== null ? <Alert variant="danger">{error}</Alert> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-doc-title">标题</Label>
        <Input
          id="new-doc-title"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：我的高三数学逆袭路线"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-doc-section">板块</Label>
        <select
          id="new-doc-section"
          value={sectionId}
          onChange={(event) => setSectionId(event.target.value)}
          className="h-9 rounded-sm border border-ink-200 bg-paper-50 px-3 text-sm text-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? '创建中…' : '新建文章'}
      </Button>
    </form>
  );
}
