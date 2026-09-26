export type NodeKind = 'dir' | 'doc';

export interface NodeRow {
  id: string;
  parentId: string | null;
  name: string;
  kind: NodeKind;
  /** 兄弟节点间排序用浮点数，插入取中点 */
  order: number;
  updatedAt: number;
}

export interface NoteRow {
  docId: string;
  html: string;
  updatedAt: number;
}

export interface CodeRow {
  docId: string;
  code: string;
  updatedAt: number;
}

export interface ImageRow {
  id: string;
  docId: string;
  blob: Blob;
  updatedAt: number;
}

export interface AppSettings {
  commentColor: string;
  editorBg: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  commentColor: '#808080',
  editorBg: '#ffffff',
};

export const MAX_NAME_LEN = 60;
