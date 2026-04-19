export type Note = {
  id: string;
  title: string;
  content: string;
  folderId?: string;
  updatedAt?: string;
  permission?: 'owner' | 'edit' | 'read';
  isPinned?: boolean;
  isShared?: boolean;
  isSharedByMe?: boolean;
  ownerUsername?: string;
};

export type Folder = {
  id: string;
  name: string;
  parentId?: string;
  permission?: 'owner' | 'edit' | 'read';
  isShared?: boolean;
  isSharedByMe?: boolean;
  isProtected?: boolean;
  ownerUsername?: string;
};
