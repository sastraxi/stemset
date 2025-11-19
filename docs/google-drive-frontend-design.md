# Google Drive Frontend Integration - Design Document

## Problem Statement

Currently, Stemset users must manually upload audio files to process them. For users with large music libraries stored in Google Drive, this creates friction:

1. **Redundant Storage**: Files already in Drive must be uploaded to Stemset
2. **Manual Workflow**: No way to browse Drive folders within Stemset
3. **No Source Tracking**: Once processed, connection to original Drive file is lost
4. **Limited Discovery**: Users can't explore their Drive music collection in-app

**Goal**: Enable users to browse their Google Drive folders directly in Stemset, import files with one click, and maintain a link to the original Drive location for future updates.

---

## Backend Changes Summary

We've implemented a fully normalized database schema and Google Drive API integration:

### Database Schema
- **AudioFile**: Normalized with `source_type` ("upload" | "google_drive"), `source_id` (drive_file_id or hash), `source_parent_id` (for navigation)
- **Profile**: Added `google_drive_folder_id` (optional root folder to browse)
- **User**: Added `google_drive_refresh_token` (OAuth credential storage)

### API Endpoints
- `GET /api/profiles/{profile_name}/drive/contents?folder_id={id}` - List Drive folder contents
- `POST /api/profiles/{profile_name}/drive/import` - Import Drive file and trigger processing

### OAuth Flow
- Added `https://www.googleapis.com/auth/drive.readonly` scope
- Refresh token stored on login for persistent Drive access

---

## Frontend Architecture Design

### User Experience Flow

```
1. User logs in → OAuth grants Drive access
2. User selects profile with google_drive_folder_id configured
3. Sidebar shows new "Drive" tab
4. User clicks "Drive" → sees folder/file browser
5. User navigates folders (breadcrumb trail)
6. User clicks unimported file → import modal appears
7. User confirms → file downloads, uploads to R2, processing starts
8. File shows as "imported" (green checkmark), clicking navigates to RecordingPlayer
```

---

## Component Architecture

### Core Design Principle: Reusable Navigator

We'll create a **universal file/folder navigator** that works in two modes:

1. **`mode="column"`** - Compact sidebar view (for Drive tab in Sidebar)
2. **`mode="full"`** - Full-page view (for future standalone Drive browser page)

This separation ensures the navigator logic is independent of its container.

---

## File Structure & Implementation Tree

```
frontend/src/
├── components/
│   ├── drive/                                 [NEW DIRECTORY]
│   │   ├── DriveNavigator.tsx                 [CREATE] - Universal file/folder navigator
│   │   │   └── DriveNavigator()               [CREATE] - Main component with mode prop
│   │   │       ├── DriveNavigatorHeader()     [CREATE] - Breadcrumbs + refresh
│   │   │       ├── DriveFileList()            [CREATE] - Scrollable file grid
│   │   │       └── DriveImportModal()         [CREATE] - Import confirmation dialog
│   │   │
│   │   ├── DriveFileItem.tsx                  [CREATE] - Individual file/folder card
│   │   │   └── DriveFileItem()                [CREATE] - Renders file with import status
│   │   │       ├── FolderIcon/FileIcon        [USE] - lucide-react icons
│   │   │       ├── ImportButton()             [CREATE] - Conditional import/checkmark
│   │   │       └── onClick handler            [CREATE] - Navigate folder or show modal
│   │   │
│   │   └── DriveImportModal.tsx               [CREATE] - Import confirmation modal
│   │       └── DriveImportModal()             [CREATE] - Dialog with file metadata
│   │           ├── File details (size, date)  [RENDER]
│   │           ├── Cancel button              [HANDLE]
│   │           └── Import button              [HANDLE] - Calls useImportDriveFile()
│   │
│   ├── views/
│   │   └── DriveView.tsx                      [CREATE] - Sidebar tab content wrapper
│   │       └── DriveView()                    [CREATE] - Wraps DriveNavigator in column mode
│   │
│   ├── app/
│   │   └── Sidebar.tsx                        [EDIT] - Add Drive tab
│   │       └── Sidebar()                      [EDIT] - Add 4th tab
│   │           ├── TabsList                   [EDIT] - Change grid-cols-3 → grid-cols-4
│   │           ├── TabsTrigger "drive"        [ADD] - New Drive tab trigger
│   │           └── TabsContent "drive"        [ADD] - Render <DriveView />
│   │
│   └── common/
│       └── EmptyState.tsx                     [CREATE] - Reusable empty state component
│           └── EmptyState()                   [CREATE] - Shows icon + message + optional action
│
├── hooks/
│   └── queries.ts                             [EDIT] - Add Drive-related hooks
│       ├── useDriveFolderContents()           [ADD] - Query hook for folder listing
│       │   └── useQuery with apiGetDriveFolderContents
│       ├── useImportDriveFile()               [ADD] - Mutation hook for import
│       │   └── useMutation with apiImportDriveFile
│       │   └── onSuccess: invalidate recordings query
│       └── [Keep existing hooks unchanged]
│
├── lib/
│   └── storage.ts                             [EDIT] - Add Drive navigation state
│       ├── getDriveFolderHistory()            [ADD] - Get breadcrumb history
│       ├── setDriveFolderHistory()            [ADD] - Save breadcrumb trail
│       └── clearDriveFolderHistory()          [ADD] - Reset on profile change
│
├── api/
│   └── generated/                             [REGENERATE] - Run npm run generate
│       └── [Auto-generated after backend OpenAPI update]
│
└── types.ts                                   [EDIT] - Add Drive-specific types
    ├── DriveFile                              [ADD] - Frontend Drive file type
    ├── DriveNavigatorMode                     [ADD] - "column" | "full"
    └── DriveFolderHistory                     [ADD] - Breadcrumb trail type
```

---

## Module Dependency DAG

```
Layer 0: External Dependencies
    ├── @tanstack/react-query
    ├── lucide-react
    └── shadcn/ui components

Layer 1: API Client & Storage
    ├── api/generated/* (auto-generated)
    └── lib/storage.ts

Layer 2: Custom Hooks
    └── hooks/queries.ts
        ├── useDriveFolderContents()
        └── useImportDriveFile()

Layer 3: Atomic Components
    ├── components/ui/* (shadcn)
    ├── components/common/EmptyState.tsx
    └── components/drive/DriveFileItem.tsx

Layer 4: Feature Components
    ├── components/drive/DriveImportModal.tsx
    └── components/drive/DriveNavigator.tsx
        ├── DriveNavigatorHeader (inline)
        └── DriveFileList (inline)

Layer 5: View Components
    └── components/views/DriveView.tsx

Layer 6: Layout Components
    └── components/app/Sidebar.tsx
```

**Critical Rule**: Components can only import from lower layers or same layer siblings. No circular dependencies.

---

## Detailed Implementation Plan

### 1. API Client Generation

**File**: `frontend/src/api/generated/*`

**Action**: Regenerate from OpenAPI schema
```bash
cd frontend
npm run generate
```

**Expected New Functions**:
- `apiProfilesProfileNameDriveContentsGetDriveFolderContents()`
- `apiProfilesProfileNameDriveImportImportDriveFile()`
- Types: `DriveFileInfo`, `DriveFolderContentsResponse`, `DriveImportRequest`, `DriveImportResponse`

---

### 2. Storage Layer - Drive Navigation State

**File**: `frontend/src/lib/storage.ts`

**Changes**:
```typescript
// ADD: Drive folder navigation history
export interface DriveFolderHistory {
  folderId: string;
  folderName: string;
}

const DRIVE_FOLDER_HISTORY_KEY = "stemset_drive_history";

export function getDriveFolderHistory(profileName: string): DriveFolderHistory[] {
  const key = `${DRIVE_FOLDER_HISTORY_KEY}_${profileName}`;
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : [];
}

export function setDriveFolderHistory(
  profileName: string,
  history: DriveFolderHistory[]
): void {
  const key = `${DRIVE_FOLDER_HISTORY_KEY}_${profileName}`;
  localStorage.setItem(key, JSON.stringify(history));
}

export function clearDriveFolderHistory(profileName: string): void {
  const key = `${DRIVE_FOLDER_HISTORY_KEY}_${profileName}`;
  localStorage.removeItem(key);
}
```

**Rationale**: Persist breadcrumb trail so users don't lose their place when switching tabs or refreshing.

---

### 3. Query Hooks - Drive Data Fetching

**File**: `frontend/src/hooks/queries.ts`

**Changes**:
```typescript
import {
  apiProfilesProfileNameDriveContentsGetDriveFolderContents,
  apiProfilesProfileNameDriveContentsGetDriveFolderContentsOptions,
  apiProfilesProfileNameDriveImportImportDriveFile,
} from "@/api/generated";

// ADD: Hook to fetch Drive folder contents
export function useDriveFolderContents(
  profileName: string | undefined,
  folderId: string | undefined
) {
  const options = apiProfilesProfileNameDriveContentsGetDriveFolderContentsOptions({
    path: { profile_name: profileName! },
    query: { folder_id: folderId },
  });

  return useQuery({
    ...options,
    enabled: !!profileName,
    staleTime: 60 * 1000, // 1 minute - Drive doesn't change often
    retry: 1, // Fail fast if no Drive access
  });
}

// ADD: Hook to import Drive file
export function useImportDriveFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: apiProfilesProfileNameDriveImportImportDriveFile,
    onSuccess: (data, variables) => {
      // Invalidate recordings list to show new import
      queryClient.invalidateQueries({
        queryKey: apiProfilesProfileNameFilesGetProfileFilesQueryKey({
          path: { profile_name: variables.path.profile_name },
        }),
      });

      // Invalidate Drive folder to update import status
      queryClient.invalidateQueries({
        queryKey: ["drive-folder-contents"],
      });
    },
  });
}
```

**Rationale**: Follow existing pattern from `useProfileFiles()`, `useCreateSong()`, etc. Automatic cache invalidation ensures UI stays fresh.

---

### 4. EmptyState Component (Reusable)

**File**: `frontend/src/components/common/EmptyState.tsx` [CREATE]

```typescript
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}
```

**Rationale**: Consistent empty states across Drive (no files), Recordings (no items), etc. Replaces scattered `<p className="empty-state">` patterns.

---

### 5. DriveFileItem Component

**File**: `frontend/src/components/drive/DriveFileItem.tsx` [CREATE]

```typescript
import { Check, File, Folder, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DriveFileItemProps {
  file: DriveFileInfo; // From generated API types
  onNavigateFolder?: (folderId: string, folderName: string) => void;
  onRequestImport?: (file: DriveFileInfo) => void;
  mode: "column" | "full";
}

export function DriveFileItem({
  file,
  onNavigateFolder,
  onRequestImport,
  mode,
}: DriveFileItemProps) {
  const isFolder = file.is_folder;
  const isImported = file.is_imported;

  const handleClick = () => {
    if (isFolder && onNavigateFolder) {
      onNavigateFolder(file.id, file.name);
    } else if (!isImported && onRequestImport) {
      onRequestImport(file);
    }
  };

  return (
    <div
      className={cn(
        "block bg-background border rounded-lg p-3 transition-colors",
        isFolder && "cursor-pointer hover:border-blue-500",
        !isFolder && !isImported && "cursor-pointer hover:border-blue-400",
        isImported && "opacity-60"
      )}
      onClick={isFolder || !isImported ? handleClick : undefined}
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          {isFolder ? (
            <Folder className="h-5 w-5 text-blue-400" />
          ) : (
            <File className="h-5 w-5 text-muted-foreground" />
          )}
        </div>

        {/* File name */}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate text-sm">{file.name}</div>
          {mode === "full" && file.size && (
            <div className="text-xs text-muted-foreground">
              {formatFileSize(file.size)}
            </div>
          )}
        </div>

        {/* Import status / button */}
        {!isFolder && (
          <div className="flex-shrink-0">
            {isImported ? (
              <div className="flex items-center gap-1 text-green-500 text-xs">
                <Check className="h-4 w-4" />
                <span>Imported</span>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestImport?.(file);
                }}
              >
                <Upload className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}
```

**Rationale**: Single responsibility component. Handles both files and folders. Clicking folder navigates, clicking file shows import modal.

---

### 6. DriveImportModal Component

**File**: `frontend/src/components/drive/DriveImportModal.tsx` [CREATE]

```typescript
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useImportDriveFile } from "@/hooks/queries";
import type { DriveFileInfo } from "@/api/generated";

interface DriveImportModalProps {
  file: DriveFileInfo | null;
  profileName: string;
  onClose: () => void;
  onSuccess?: (recordingId: string) => void;
}

export function DriveImportModal({
  file,
  profileName,
  onClose,
  onSuccess,
}: DriveImportModalProps) {
  const [isImporting, setIsImporting] = useState(false);
  const importMutation = useImportDriveFile();

  const handleImport = async () => {
    if (!file) return;

    setIsImporting(true);
    const loadingToast = toast.loading(`Importing ${file.name}...`);

    try {
      const response = await importMutation.mutateAsync({
        path: { profile_name: profileName },
        body: {
          file_id: file.id,
          file_name: file.name,
          file_size: file.size || 0,
          modified_time: file.modifiedTime,
          parent_id: null, // TODO: Track from navigation history
        },
      });

      toast.success("Import started! Processing...", { id: loadingToast });
      onSuccess?.(response.data.recording_id);
      onClose();
    } catch (error) {
      toast.error("Import failed. Please try again.", { id: loadingToast });
      console.error("Import error:", error);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={() => !isImporting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from Google Drive</DialogTitle>
          <DialogDescription>
            This will download the file from your Drive and start processing.
          </DialogDescription>
        </DialogHeader>

        {file && (
          <div className="space-y-2 py-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">File:</span>
              <span className="font-medium">{file.name}</span>
            </div>
            {file.size && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Size:</span>
                <span>{formatFileSize(file.size)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Modified:</span>
              <span>{new Date(file.modifiedTime).toLocaleDateString()}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isImporting}>
            {isImporting ? "Importing..." : "Import & Process"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}
```

**Rationale**: Follows existing modal pattern from `CreateClipModal.tsx`, `MetadataEditorModal.tsx`. Shows file details before import, handles loading state, shows toast notifications.

---

### 7. DriveNavigator Component (Core)

**File**: `frontend/src/components/drive/DriveNavigator.tsx` [CREATE]

```typescript
import { useState, useEffect } from "react";
import { ChevronRight, FolderOpen, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDriveFolderContents } from "@/hooks/queries";
import { getDriveFolderHistory, setDriveFolderHistory } from "@/lib/storage";
import { DriveFileItem } from "./DriveFileItem";
import { DriveImportModal } from "./DriveImportModal";
import { EmptyState } from "@/components/common/EmptyState";
import type { DriveFileInfo } from "@/api/generated";

interface DriveNavigatorProps {
  profileName: string;
  rootFolderId: string | undefined; // From profile.google_drive_folder_id
  mode: "column" | "full";
  onImportSuccess?: (recordingId: string) => void;
}

export function DriveNavigator({
  profileName,
  rootFolderId,
  mode,
  onImportSuccess,
}: DriveNavigatorProps) {
  // Navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(rootFolderId);
  const [breadcrumbs, setBreadcrumbs] = useState<DriveFolderHistory[]>([]);
  const [selectedFile, setSelectedFile] = useState<DriveFileInfo | null>(null);

  // Fetch current folder contents
  const { data, isLoading, error, refetch } = useDriveFolderContents(
    profileName,
    currentFolderId
  );

  // Load navigation history from storage on mount
  useEffect(() => {
    const history = getDriveFolderHistory(profileName);
    if (history.length > 0) {
      setBreadcrumbs(history);
      setCurrentFolderId(history[history.length - 1].folderId);
    }
  }, [profileName]);

  // Persist navigation history to storage
  useEffect(() => {
    if (breadcrumbs.length > 0) {
      setDriveFolderHistory(profileName, breadcrumbs);
    }
  }, [breadcrumbs, profileName]);

  // Navigate into folder
  const handleNavigateFolder = (folderId: string, folderName: string) => {
    setBreadcrumbs([...breadcrumbs, { folderId, folderName }]);
    setCurrentFolderId(folderId);
  };

  // Navigate back to folder in breadcrumb trail
  const handleNavigateToBreadcrumb = (index: number) => {
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFolderId(newBreadcrumbs[index].folderId);
  };

  // Navigate to root
  const handleNavigateRoot = () => {
    setBreadcrumbs([]);
    setCurrentFolderId(rootFolderId);
  };

  // Handle import request
  const handleRequestImport = (file: DriveFileInfo) => {
    setSelectedFile(file);
  };

  // Handle import success
  const handleImportSuccess = (recordingId: string) => {
    onImportSuccess?.(recordingId);
  };

  // Render loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="Unable to load Drive files"
        description="Please ensure you've granted Google Drive access and try again."
        action={{ label: "Retry", onClick: () => refetch() }}
      />
    );
  }

  // Render no folder configured state
  if (!rootFolderId) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No Drive folder configured"
        description="Contact your administrator to set up a Google Drive folder for this profile."
      />
    );
  }

  const files = data?.data?.files || [];

  return (
    <div className={cn("flex flex-col h-full", mode === "column" && "gap-2")}>
      {/* Header: Breadcrumbs + Refresh */}
      <div className="flex items-center gap-2 pb-2 border-b">
        {/* Breadcrumbs */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNavigateRoot}
            className="h-8 px-2"
          >
            <Home className="h-4 w-4" />
          </Button>

          {breadcrumbs.map((crumb, index) => (
            <div key={index} className="flex items-center gap-1 flex-shrink-0">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleNavigateToBreadcrumb(index)}
                className="h-8 px-2 text-sm"
              >
                {crumb.folderName}
              </Button>
            </div>
          ))}
        </div>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          className="h-8 px-2 flex-shrink-0"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* File List */}
      <div className={cn("flex-1 overflow-y-auto", mode === "column" && "space-y-2")}>
        {files.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No files or folders"
            description="This folder is empty or contains no audio files."
          />
        ) : (
          <div className={cn(mode === "column" ? "space-y-2" : "grid grid-cols-2 gap-3")}>
            {files.map((file) => (
              <DriveFileItem
                key={file.id}
                file={file}
                mode={mode}
                onNavigateFolder={handleNavigateFolder}
                onRequestImport={handleRequestImport}
              />
            ))}
          </div>
        )}
      </div>

      {/* Import Modal */}
      <DriveImportModal
        file={selectedFile}
        profileName={profileName}
        onClose={() => setSelectedFile(null)}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
```

**Rationale**: Self-contained navigator with breadcrumb navigation, persistent history, and modal integration. Works in both column (sidebar) and full (future page) modes.

---

### 8. DriveView Component (Sidebar Tab Content)

**File**: `frontend/src/components/views/DriveView.tsx` [CREATE]

```typescript
import { DriveNavigator } from "@/components/drive/DriveNavigator";
import { useNavigate } from "@tanstack/react-router";

interface DriveViewProps {
  profileName: string;
  googleDriveFolderId: string | undefined;
}

export function DriveView({ profileName, googleDriveFolderId }: DriveViewProps) {
  const navigate = useNavigate();

  const handleImportSuccess = (recordingId: string) => {
    // Navigate to the newly imported recording
    navigate({
      to: "/api/recordings/$recordingId",
      params: { recordingId },
      search: { initialState: "processing" },
    });
  };

  return (
    <DriveNavigator
      profileName={profileName}
      rootFolderId={googleDriveFolderId}
      mode="column"
      onImportSuccess={handleImportSuccess}
    />
  );
}
```

**Rationale**: Thin wrapper that passes profile context to DriveNavigator. Handles navigation to recordings after import.

---

### 9. Sidebar Component Updates

**File**: `frontend/src/components/app/Sidebar.tsx` [EDIT]

**Changes**:

1. **Import DriveView**:
```typescript
import { DriveView } from "@/components/views/DriveView";
```

2. **Update TabsList** (change `grid-cols-3` → `grid-cols-4`):
```typescript
<TabsList className="grid w-full grid-cols-4 mb-4">
  <TabsTrigger value="recordings">Recordings</TabsTrigger>
  <TabsTrigger value="clips">Clips</TabsTrigger>
  <TabsTrigger value="songs">Songs</TabsTrigger>
  <TabsTrigger value="drive">Drive</TabsTrigger>
</TabsList>
```

3. **Add Drive TabsContent** (after songs tab):
```typescript
<TabsContent value="drive" className="mt-0 flex-1 overflow-y-auto">
  {selectedProfile && (
    <DriveView
      profileName={selectedProfile.name}
      googleDriveFolderId={selectedProfile.google_drive_folder_id}
    />
  )}
</TabsContent>
```

4. **Conditional Tab Visibility** (optional enhancement):
```typescript
{selectedProfile?.google_drive_folder_id && (
  <TabsTrigger value="drive">Drive</TabsTrigger>
)}
```

**Rationale**: Minimal changes to existing Sidebar. Drive tab only shown if profile has `google_drive_folder_id` configured.

---

### 10. Types Extension

**File**: `frontend/src/types.ts` [EDIT]

**Add**:
```typescript
export interface DriveFolderHistory {
  folderId: string;
  folderName: string;
}

export type DriveNavigatorMode = "column" | "full";
```

**Rationale**: Shared types for navigation state and component modes.

---

## Testing Plan

### Unit Testing Checklist

1. **DriveFileItem**
   - [ ] Renders folder icon for folders
   - [ ] Renders file icon for files
   - [ ] Shows "Imported" checkmark for imported files
   - [ ] Shows import button for unimported files
   - [ ] Calls `onNavigateFolder` when clicking folder
   - [ ] Calls `onRequestImport` when clicking unimported file

2. **DriveImportModal**
   - [ ] Shows file details (name, size, date)
   - [ ] Disables buttons while importing
   - [ ] Shows loading toast during import
   - [ ] Shows success toast on completion
   - [ ] Shows error toast on failure
   - [ ] Calls `onSuccess` callback with recording ID

3. **DriveNavigator**
   - [ ] Loads folder contents on mount
   - [ ] Shows loading spinner while fetching
   - [ ] Shows error state with retry button
   - [ ] Shows empty state for no files
   - [ ] Updates breadcrumbs when navigating into folder
   - [ ] Navigates back when clicking breadcrumb
   - [ ] Persists navigation history to localStorage
   - [ ] Restores navigation history from localStorage

### Integration Testing Checklist

1. **Sidebar Integration**
   - [ ] Drive tab appears when profile has `google_drive_folder_id`
   - [ ] Drive tab hidden when profile has no Drive folder
   - [ ] Clicking Drive tab loads folder contents
   - [ ] Switching between tabs preserves navigation state

2. **Import Flow**
   - [ ] Clicking unimported file opens modal
   - [ ] Confirming import starts processing
   - [ ] File shows as "Imported" after success
   - [ ] Recordings list updates with new recording
   - [ ] Clicking imported file navigates to RecordingPlayer

### Manual Testing Scenarios

1. **First-time user with Drive access**
   - Log in → OAuth grants Drive access
   - Select profile with Drive folder
   - Click Drive tab → see root folder contents
   - Navigate into subfolder → breadcrumbs update
   - Click breadcrumb → navigate back
   - Refresh page → navigation state persists

2. **Import workflow**
   - Click unimported audio file → modal appears
   - View file details (name, size, date)
   - Click Import → toast shows "Importing..."
   - Modal closes → file shows checkmark
   - Navigate to Recordings tab → new recording appears with "processing" status

3. **Error handling**
   - Revoke Drive access → error state shown with retry button
   - Import large file (>150MB) → backend validation error shown
   - Network error during import → toast shows error message

---

## Performance Considerations

1. **Lazy Loading**: Drive folder contents only fetched when tab is active
2. **Stale Time**: 60 second cache reduces API calls during navigation
3. **Breadcrumb History**: localStorage prevents re-fetching parent folders
4. **Mode Prop**: Column mode uses smaller cards, full mode uses grid layout

---

## Future Enhancements

1. **Pagination**: Handle folders with >100 files (use `nextPageToken`)
2. **Search**: Filter files by name in current folder
3. **Bulk Import**: Select multiple files for batch processing
4. **Sync Detection**: Show "Updated in Drive" badge if `source_modified_time` changed
5. **Full-Page View**: Create `/p/$profileName/drive` route with `mode="full"`
6. **Folder Tree**: Show nested folder structure in sidebar for quick navigation

---

## Security & Privacy

1. **OAuth Scope**: Read-only access (`drive.readonly`) - cannot modify Drive files
2. **Refresh Token**: Stored in database, never exposed to frontend
3. **Access Token**: Generated on-demand by backend, expires after 1 hour
4. **File Content**: Downloaded server-side, never streamed through browser
5. **Import Tracking**: `source_id` links to Drive file for auditing

---

## Rollout Strategy

1. **Phase 1**: Backend-only (current) - Deploy migration, test API endpoints
2. **Phase 2**: Frontend skeleton - Add Drive tab (hidden by feature flag)
3. **Phase 3**: Beta testing - Enable for specific profiles with Drive configured
4. **Phase 4**: General availability - Show Drive tab for all profiles with folder ID

---

## Success Metrics

1. **Adoption**: % of users with Drive folder configured who use Drive tab
2. **Import Rate**: Avg imports per user per session from Drive vs. manual upload
3. **Error Rate**: % of Drive imports that fail vs. manual uploads
4. **Navigation Depth**: Avg folder depth users navigate (indicates folder structure complexity)
5. **Time to Import**: Duration from clicking import to processing start

---

## Appendix: ASCII Implementation Tree

```
Implementation Order (Bottom-Up Dependency Resolution)
════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────┐
│ Step 1: API Client & Types                         │
├─────────────────────────────────────────────────────┤
│ □ Run: npm run generate                            │
│   ├─ Generates DriveFileInfo type                  │
│   ├─ Generates apiGetDriveFolderContents()         │
│   └─ Generates apiImportDriveFile()                │
│ □ Edit: types.ts                                   │
│   ├─ ADD DriveFolderHistory interface              │
│   └─ ADD DriveNavigatorMode type                   │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Step 2: Storage Layer                              │
├─────────────────────────────────────────────────────┤
│ □ Edit: lib/storage.ts                             │
│   ├─ ADD getDriveFolderHistory()                   │
│   ├─ ADD setDriveFolderHistory()                   │
│   └─ ADD clearDriveFolderHistory()                 │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Step 3: Query Hooks                                │
├─────────────────────────────────────────────────────┤
│ □ Edit: hooks/queries.ts                           │
│   ├─ ADD useDriveFolderContents()                  │
│   │   └─ useQuery with Drive API                   │
│   └─ ADD useImportDriveFile()                      │
│       ├─ useMutation with import API               │
│       └─ onSuccess: invalidate caches              │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Step 4: Atomic Components                          │
├─────────────────────────────────────────────────────┤
│ □ Create: components/common/EmptyState.tsx         │
│   └─ EmptyState({ icon, title, description })      │
│ □ Create: components/drive/DriveFileItem.tsx       │
│   ├─ DriveFileItem({ file, mode, handlers })       │
│   ├─ Folder/File icon rendering                    │
│   ├─ Import status badge                           │
│   └─ Click handlers (navigate/import)              │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Step 5: Feature Components                         │
├─────────────────────────────────────────────────────┤
│ □ Create: components/drive/DriveImportModal.tsx    │
│   ├─ DriveImportModal({ file, onClose })           │
│   ├─ File details display                          │
│   ├─ Import mutation handler                       │
│   └─ Toast notifications                           │
│ □ Create: components/drive/DriveNavigator.tsx      │
│   ├─ DriveNavigator({ profile, mode })             │
│   ├─ Breadcrumb navigation                         │
│   ├─ Folder history persistence                    │
│   ├─ File list rendering                           │
│   └─ Modal state management                        │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Step 6: View Component                             │
├─────────────────────────────────────────────────────┤
│ □ Create: components/views/DriveView.tsx           │
│   ├─ DriveView({ profileName, folderId })          │
│   ├─ Wraps DriveNavigator in column mode           │
│   └─ Navigation handler for import success         │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Step 7: Layout Integration                         │
├─────────────────────────────────────────────────────┤
│ □ Edit: components/app/Sidebar.tsx                 │
│   ├─ CHANGE grid-cols-3 → grid-cols-4              │
│   ├─ ADD TabsTrigger "drive"                       │
│   ├─ ADD TabsContent "drive"                       │
│   │   └─ Renders <DriveView />                     │
│   └─ OPTIONAL: Conditional tab visibility          │
└─────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════
Total Files:
  - CREATE: 5 new files
  - EDIT: 3 existing files
  - REGENERATE: 1 API client (automated)
═══════════════════════════════════════════════════════
```

---

## Conclusion

This design maintains architectural consistency with the existing Stemset frontend while introducing a clean, reusable Drive navigation component. The layered approach ensures testability, maintainability, and future extensibility.

**Key Principles Preserved**:
- Type-safe API integration via generated client
- React Query for all async state
- shadcn/ui component patterns
- Toast notifications via sonner
- Persistent state via storage.ts
- Single responsibility components

**Next Steps**: Review this design doc, gather feedback, then proceed with implementation in the order specified in the ASCII tree.
