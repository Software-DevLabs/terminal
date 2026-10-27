import type {
  ElevateResult,
  FindResult,
  ListResult,
  ReadResult,
  SearchResult,
  SystemInfo,
  WriteResult,
} from '../../shared/workspace.ts';
import { authToken } from './config.ts';

function endpoint(path: string): string {
  const query = new URLSearchParams({ token: authToken() });
  return `/workspace/${path}?${query.toString()}`;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(endpoint(path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // The status code below is the only useful information.
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export const workspaceApi = {
  list: (root: string, path = ''): Promise<ListResult> => request('list', { root, path }),
  read: (root: string, path: string): Promise<ReadResult> => request('read', { root, path }),
  write: (root: string, path: string, content: string): Promise<WriteResult> =>
    request('write', { root, path, content }),
  find: (root: string, query: string): Promise<FindResult> => request('find', { root, query }),
  search: (root: string, query: string): Promise<SearchResult> => request('search', { root, query }),
  system: (): Promise<SystemInfo> => request('system'),
  elevate: (): Promise<ElevateResult> => request('elevate', {}),
};
