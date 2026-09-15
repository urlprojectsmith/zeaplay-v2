'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { apiClient } from '../../services/api';
import { useSessionStore } from '../../stores/session';

interface Project {
  id: string;
  name: string;
  description?: string | null;
  status: string;
}

interface Asset {
  id: string;
  projectId: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  checksum?: string | null;
}

interface UploadInit {
  asset: Asset;
  uploadUrl: string;
  expiresAt: string;
}

export function ProjectList() {
  const { accessToken, organizationId, hydrated, hydrate } = useSessionStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated || !accessToken || !organizationId) return;
    apiClient
      .request<{ items: Project[] }>('/projects', {
        headers: { 'x-organization-id': organizationId },
      })
      .then((response) => setProjects(response.data.items))
      .catch(() => setError('Projects could not be loaded.'));
  }, [accessToken, hydrated, organizationId]);

  if (!hydrated) return <main className="page-shell">Loading...</main>;
  if (!accessToken) return <main className="page-shell">Redirecting...</main>;

  return (
    <main className="page-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>Project workspace</h1>
        </div>
        <Link className="text-link" href="/dashboard">
          Dashboard
        </Link>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      <section className="project-grid">
        {projects.map((project) => (
          <Link
            className="project-card"
            href={`/dashboard/projects/${project.id}` as Route}
            key={project.id}
          >
            <strong>{project.name}</strong>
            <span>{project.status}</span>
          </Link>
        ))}
        {projects.length === 0 && !error ? <p>No projects yet.</p> : null}
      </section>
    </main>
  );
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { accessToken, organizationId, hydrated, hydrate } = useSessionStore();
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<string>('Idle');
  const [progress, setProgress] = useState(0);

  const headers = useMemo(
    () => (organizationId ? { 'x-organization-id': organizationId } : undefined),
    [organizationId],
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated || !accessToken || !headers) return;
    void load();
  }, [accessToken, headers, hydrated]);

  async function load() {
    if (!headers) return;
    const [projectResponse, assetResponse] = await Promise.all([
      apiClient.request<Project>(`/projects/${projectId}`, { headers }),
      apiClient.request<{ items: Asset[] }>(`/projects/${projectId}/assets`, { headers }),
    ]);
    setProject(projectResponse.data);
    setAssets(assetResponse.data.items);
  }

  async function upload(file: File) {
    if (!headers) return;
    setError(null);
    setProgress(0);
    try {
      setUploadState('Preparing upload');
      const init = await apiClient.request<UploadInit>(
        `/projects/${projectId}/assets/upload-init`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }),
        },
      );
      setUploadState('Uploading');
      await uploadToStorage(init.data.uploadUrl, file, setProgress);
      setUploadState('Finalizing');
      await apiClient.request<Asset>(
        `/projects/${projectId}/assets/${init.data.asset.id}/upload-complete`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ sizeBytes: file.size }),
        },
      );
      setUploadState('Processing');
      await load();
    } catch {
      setUploadState('Failed');
      setError('Upload failed.');
    }
  }

  async function download(assetId: string) {
    if (!headers) return;
    const response = await apiClient.request<{ downloadUrl: string }>(
      `/projects/${projectId}/assets/${assetId}/download`,
      { headers },
    );
    window.location.assign(response.data.downloadUrl);
  }

  async function remove(assetId: string) {
    if (!headers) return;
    await apiClient.request(`/projects/${projectId}/assets/${assetId}`, {
      method: 'DELETE',
      headers,
    });
    await load();
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }

  if (!hydrated) return <main className="page-shell">Loading...</main>;
  if (!accessToken) return <main className="page-shell">Redirecting...</main>;

  return (
    <main className="page-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{project?.name ?? 'Project'}</h1>
        </div>
        <Link className="text-link" href={'/dashboard/projects' as Route}>
          Projects
        </Link>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <strong>Upload asset</strong>
        <input type="file" onChange={onFileInput} />
        <span>{uploadState}</span>
        {progress > 0 ? <progress max={100} value={progress} /> : null}
      </div>
      <section className="asset-list">
        {assets.map((asset) => (
          <article className="asset-row" key={asset.id}>
            <div>
              <strong>{asset.displayName}</strong>
              <span>
                {asset.status} - {Math.round(asset.sizeBytes / 1024)} KB
              </span>
            </div>
            <div className="row-actions">
              <button
                type="button"
                onClick={() => void download(asset.id)}
                disabled={asset.status !== 'READY'}
              >
                Download
              </button>
              <button type="button" onClick={() => void remove(asset.id)}>
                Delete
              </button>
            </div>
          </article>
        ))}
        {assets.length === 0 ? <p>No assets yet.</p> : null}
      </section>
    </main>
  );
}

function uploadToStorage(url: string, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('content-type', file.type || 'application/octet-stream');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error('Upload failed'));
    request.onerror = () => reject(new Error('Upload failed'));
    request.send(file);
  });
}
