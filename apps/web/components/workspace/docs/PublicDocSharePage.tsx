'use client';

import { useState } from 'react';
import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiClientError } from '@zea-play/api-client';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@zea-play/ui';
import { PublicBrandShell } from '../../branding/PublicBrandShell';
import { getPublicDocShare, verifyPublicDocSharePassword } from '../../../services/workspace-docs';
import {
  defaultPublicBranding,
  type PublicBranding,
} from '../../../services/public-branding.shared';
import { useLanguage } from '../../../contexts/language-provider';

const renderExtensions = [
  StarterKit,
  Underline,
  Link.configure({ protocols: ['http', 'https', 'mailto'] }),
  Image,
  TaskList,
  TaskItem,
  Table,
  TableRow,
  TableHeader,
  TableCell,
];

export function PublicDocSharePage({ token }: { token: string }) {
  const { locale, t } = useLanguage();
  const [password, setPassword] = useState('');
  const [access, setAccess] = useState<string | undefined>();
  const shareQuery = useQuery({
    queryKey: ['public-doc-share', token, access],
    queryFn: () => getPublicDocShare(token, access),
    retry: false,
  });
  const passwordMutation = useMutation({
    mutationFn: () => verifyPublicDocSharePassword(token, password),
    onSuccess: (result) => {
      setAccess(result.access);
      setPassword('');
    },
  });

  if (shareQuery.isLoading)
    return (
      <PublicShell brand={defaultPublicBranding}>
        <Skeleton className="h-80 rounded-md" />
      </PublicShell>
    );

  if (isPasswordRequired(shareQuery.error)) {
    return (
      <PublicShell brand={defaultPublicBranding}>
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>{t(locale, 'publicBranding.protectedDoc')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Input
              label={t(locale, 'publicBranding.password')}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="button" disabled={!password} onClick={() => passwordMutation.mutate()}>
              {t(locale, 'publicBranding.open')}
            </Button>
          </CardContent>
        </Card>
      </PublicShell>
    );
  }

  if (shareQuery.error || !shareQuery.data) {
    return (
      <PublicShell brand={defaultPublicBranding}>
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>{t(locale, 'publicBranding.docUnavailable')}</CardTitle>
          </CardHeader>
        </Card>
      </PublicShell>
    );
  }

  const html = sanitizeRenderedHtml(generateHTML(shareQuery.data.content, renderExtensions));

  return (
    <PublicShell brand={shareQuery.data.branding}>
      <article className="mx-auto grid max-w-4xl gap-5">
        <header className="border-b border-border pb-4">
          <h1 className="text-3xl font-semibold tracking-normal">{shareQuery.data.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(locale, 'publicBranding.updated')}{' '}
            {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
              new Date(shareQuery.data.updatedAt),
            )}
          </p>
        </header>
        <div
          className="max-w-none text-sm leading-7 [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-3xl [&_h2]:text-2xl [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>
    </PublicShell>
  );
}

function PublicShell({ brand, children }: { brand: PublicBranding; children: React.ReactNode }) {
  return <PublicBrandShell brand={brand}>{children}</PublicBrandShell>;
}

function isPasswordRequired(error: unknown) {
  return error instanceof ApiClientError && error.body.code === 'SHARE_PASSWORD_REQUIRED';
}

function sanitizeRenderedHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\shref="javascript:[^"]*"/gi, ' href="#"')
    .replace(/\ssrc="javascript:[^"]*"/gi, ' src=""');
}
