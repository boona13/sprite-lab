export interface CurrentUser {
  id: number;
  email: string;
  name: string;
  createdAt: string;
}

export interface Project {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectImage {
  id: number;
  projectId: number;
  kind: 'generated' | 'attached';
  name: string;
  prompt?: string;
  model?: string;
  imageData: string;
  createdAt: string;
}

async function apiJSON<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  }
  return data as T;
}

export async function fetchMe(): Promise<CurrentUser | null> {
  const response = await fetch('/api/auth/me');
  if (response.status === 401) return null;
  const data = await apiJSON<{ user: CurrentUser }>(response);
  return data.user;
}

export async function login(email: string, password: string): Promise<CurrentUser> {
  const data = await apiJSON<{ user: CurrentUser }>(
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
  return data.user;
}

export async function register(email: string, name: string, password: string): Promise<CurrentUser> {
  const data = await apiJSON<{ user: CurrentUser }>(
    await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password }),
    }),
  );
  return data.user;
}

export async function logout(): Promise<void> {
  await apiJSON(await fetch('/api/auth/logout', { method: 'POST' }));
}

export async function listProjects(): Promise<Project[]> {
  const data = await apiJSON<{ projects: Project[] }>(await fetch('/api/projects'));
  return data.projects;
}

export async function createProject(name: string): Promise<Project> {
  const data = await apiJSON<{ project: Project }>(
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  );
  return data.project;
}

export async function listProjectImages(projectId: number): Promise<ProjectImage[]> {
  const data = await apiJSON<{ images: ProjectImage[] }>(await fetch(`/api/projects/${projectId}/images`));
  return data.images;
}

export async function addProjectImage(
  projectId: number,
  image: Omit<ProjectImage, 'id' | 'projectId' | 'createdAt'>,
): Promise<ProjectImage> {
  const data = await apiJSON<{ image: ProjectImage }>(
    await fetch(`/api/projects/${projectId}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(image),
    }),
  );
  return data.image;
}
