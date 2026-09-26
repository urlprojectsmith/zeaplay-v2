'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiClientError } from '@zea-play/api-client';
import { Button, Card, CardHeader, CardTitle, Input, Skeleton, Textarea } from '@zea-play/ui';
import { Send } from 'lucide-react';
import {
  authorizePublicFormUpload,
  completePublicFormUpload,
  getPublicForm,
  submitPublicForm,
  type FormField,
  type FormSchema,
  type PublicUploadAnswerRef,
} from '../../../services/workspace-forms';

export function PublicFormPage({ publicId }: { publicId: string }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitted, setSubmitted] = useState(false);
  const formQuery = useQuery({
    queryKey: ['public-form', publicId],
    queryFn: () => getPublicForm(publicId),
    retry: false,
  });
  const submitMutation = useMutation({
    mutationFn: () => submitPublicForm(publicId, answers),
    onSuccess: () => {
      setSubmitted(true);
      setAnswers({});
    },
  });

  if (formQuery.isLoading) {
    return (
      <PublicShell>
        <Skeleton className="mx-auto h-80 max-w-2xl rounded-md" />
      </PublicShell>
    );
  }

  if (formQuery.error || !formQuery.data) {
    return (
      <PublicShell>
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>Form Unavailable</CardTitle>
          </CardHeader>
        </Card>
      </PublicShell>
    );
  }

  if (submitted) {
    return (
      <PublicShell>
        <Card className="mx-auto max-w-xl">
          <CardHeader>
            <CardTitle>
              {formQuery.data.settings.successMessage ?? 'Thanks. Your response was submitted.'}
            </CardTitle>
          </CardHeader>
        </Card>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <main className="mx-auto grid max-w-2xl gap-5">
        <header className="border-b border-border pb-4">
          <h1 className="text-3xl font-semibold tracking-normal">{formQuery.data.title}</h1>
          {formQuery.data.description ? (
            <p className="mt-2 text-sm text-muted-foreground">{formQuery.data.description}</p>
          ) : null}
        </header>
        <FormBody
          publicId={publicId}
          formVersionNumber={formQuery.data.versionNumber}
          schema={formQuery.data.schema}
          answers={answers}
          onChange={setAnswers}
          onSubmit={() => submitMutation.mutate()}
        />
        {submitMutation.error ? (
          <p className="text-sm text-destructive">{errorMessage(submitMutation.error)}</p>
        ) : null}
      </main>
    </PublicShell>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background p-6 text-foreground">{children}</main>;
}

function FormBody({
  publicId,
  formVersionNumber,
  schema,
  answers,
  onChange,
  onSubmit,
}: {
  publicId: string;
  formVersionNumber: number;
  schema: FormSchema;
  answers: Record<string, unknown>;
  onChange: (answers: Record<string, unknown>) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input type="text" name="company" className="hidden" tabIndex={-1} autoComplete="off" />
      {schema.fields.map((field) => (
        <label key={field.id} className="grid gap-2 text-sm">
          <span className="font-medium">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          {field.type === 'FILE_UPLOAD' ? (
            <PublicFileInput
              publicId={publicId}
              formVersionNumber={formVersionNumber}
              field={field}
              value={uploadRefs(answers[field.id])}
              onChange={(value) => onChange({ ...answers, [field.id]: value })}
            />
          ) : field.type === 'SIGNATURE' ? (
            <PublicSignatureInput
              publicId={publicId}
              formVersionNumber={formVersionNumber}
              field={field}
              value={uploadRefs(answers[field.id])}
              onChange={(value) => onChange({ ...answers, [field.id]: value[0] })}
            />
          ) : field.type === 'TEXTAREA' ? (
            <Textarea
              required={field.required}
              value={inputValue(answers[field.id])}
              onChange={(event) => onChange({ ...answers, [field.id]: event.target.value })}
            />
          ) : field.type === 'CHECKBOX' ? (
            <input
              type="checkbox"
              checked={Boolean(answers[field.id])}
              onChange={(event) => onChange({ ...answers, [field.id]: event.target.checked })}
            />
          ) : (
            <Input
              required={field.required}
              type={
                field.type === 'NUMBER' || field.type === 'RATING'
                  ? 'number'
                  : field.type === 'DATE'
                    ? 'date'
                    : 'text'
              }
              value={inputValue(answers[field.id])}
              onChange={(event) => onChange({ ...answers, [field.id]: event.target.value })}
            />
          )}
        </label>
      ))}
      <Button type="submit">
        <Send className="h-4 w-4" />
        Submit
      </Button>
    </form>
  );
}

function PublicFileInput({
  publicId,
  formVersionNumber,
  field,
  value,
  onChange,
}: {
  publicId: string;
  formVersionNumber: number;
  field: FormField;
  value: PublicUploadAnswerRef[];
  onChange: (value: PublicUploadAnswerRef[]) => void;
}) {
  const [message, setMessage] = useState('');
  const maxFiles = Math.max(1, Math.min(field.maxFiles ?? 1, 10));
  return (
    <div className="grid gap-2">
      <Input
        type="file"
        accept={field.accept?.join(',')}
        disabled={value.length >= maxFiles}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          void uploadPublicFile(publicId, formVersionNumber, field, file)
            .then((ref) => {
              onChange([...value, ref].slice(0, maxFiles));
              setMessage('Upload ready');
            })
            .catch((error: unknown) => setMessage(safeUploadError(error)));
        }}
      />
      {value.length ? (
        <p className="text-xs text-muted-foreground">{value.length} file ready</p>
      ) : null}
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}

function PublicSignatureInput({
  publicId,
  formVersionNumber,
  field,
  value,
  onChange,
}: {
  publicId: string;
  formVersionNumber: number;
  field: FormField;
  value: PublicUploadAnswerRef[];
  onChange: (value: PublicUploadAnswerRef[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [message, setMessage] = useState(value.length ? 'Signature ready' : '');
  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !drawingRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
    ctx.lineTo(event.clientX - rect.left, event.clientY - rect.top);
    ctx.stroke();
  };
  return (
    <div className="grid gap-2">
      <canvas
        ref={canvasRef}
        width={640}
        height={180}
        className="h-36 w-full touch-none rounded-md border border-border bg-background"
        onPointerDown={(event) => {
          drawingRef.current = true;
          const canvas = canvasRef.current;
          const rect = canvas?.getBoundingClientRect();
          const ctx = canvas?.getContext('2d');
          if (!rect || !ctx) return;
          ctx.beginPath();
          ctx.moveTo(event.clientX - rect.left, event.clientY - rect.top);
        }}
        onPointerMove={draw}
        onPointerUp={() => {
          drawingRef.current = false;
        }}
        onPointerLeave={() => {
          drawingRef.current = false;
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const canvas = canvasRef.current;
            canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
            onChange([]);
            setMessage('');
          }}
        >
          Clear
        </Button>
        <Button
          type="button"
          onClick={() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.toBlob((blob) => {
              if (!blob) {
                setMessage('Upload failed');
                return;
              }
              const file = new File([blob], 'signature.png', { type: 'image/png' });
              void uploadPublicFile(publicId, formVersionNumber, field, file)
                .then((ref) => {
                  onChange([ref]);
                  setMessage('Signature ready');
                })
                .catch((error: unknown) => setMessage(safeUploadError(error)));
            }, 'image/png');
          }}
        >
          Upload signature
        </Button>
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}

async function uploadPublicFile(
  publicId: string,
  formVersionNumber: number,
  field: FormField,
  file: File,
) {
  const authorization = await authorizePublicFormUpload(publicId, {
    fieldId: field.id,
    formVersionNumber,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  });
  const upload = await fetch(authorization.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': authorization.constraints.mimeType },
    body: file,
  });
  if (!upload.ok) throw new Error('UPLOAD_FAILED');
  await completePublicFormUpload(publicId, {
    fieldId: field.id,
    formVersionNumber,
    assetId: authorization.assetId,
    uploadToken: authorization.uploadToken,
    sizeBytes: file.size,
  });
  return { assetId: authorization.assetId, uploadToken: authorization.uploadToken };
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.body.code || error.body.message;
  if (error instanceof Error) return error.message;
  return 'Submission failed';
}

function inputValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function uploadRefs(value: unknown): PublicUploadAnswerRef[] {
  if (Array.isArray(value)) {
    return value.filter(isUploadRef);
  }
  return isUploadRef(value) ? [value] : [];
}

function isUploadRef(value: unknown): value is PublicUploadAnswerRef {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as PublicUploadAnswerRef).assetId === 'string' &&
    typeof (value as PublicUploadAnswerRef).uploadToken === 'string',
  );
}

function safeUploadError(error: unknown) {
  if (error instanceof ApiClientError && error.body.code === 'FORM_UPLOAD_TYPE_NOT_ALLOWED') {
    return 'File type not allowed';
  }
  if (error instanceof ApiClientError && error.body.code === 'FORM_UPLOAD_TOO_LARGE') {
    return 'File too large';
  }
  return 'Upload failed';
}
