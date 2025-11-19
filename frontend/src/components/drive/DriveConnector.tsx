import { useState } from "react";
import { FolderOpen, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface DriveConnectorProps {
  onConnect: (folderId: string) => Promise<void>;
}

export function DriveConnector({ onConnect }: DriveConnectorProps) {
  const [folderInput, setFolderInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setFolderInput(text.trim());
    } catch (err) {
      toast.error("Please paste the folder ID or URL manually");
    }
  };

  const handleConnect = async () => {
    if (!folderInput.trim()) {
      toast.error("Please enter a Google Drive folder ID or URL");
      return;
    }

    setIsConnecting(true);
    try {
      await onConnect(folderInput.trim());
      toast.success("Your Google Drive folder is now connected");
      setFolderInput("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to connect to Google Drive folder"
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">Connect to Google Drive</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-md text-center">
        Paste the folder ID or URL from your Google Drive folder to connect it to this profile.
      </p>

      <div className="w-full max-w-md space-y-3">
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Paste folder ID or URL..."
            value={folderInput}
            onChange={(e) => setFolderInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isConnecting) {
                handleConnect();
              }
            }}
            disabled={isConnecting}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handlePaste}
            disabled={isConnecting}
            title="Paste from clipboard"
          >
            <LinkIcon className="h-4 w-4" />
          </Button>
        </div>

        <Button
          onClick={handleConnect}
          disabled={isConnecting || !folderInput.trim()}
          className="w-full"
        >
          {isConnecting ? "Connecting..." : "Connect"}
        </Button>

        <div className="text-xs text-muted-foreground mt-4 space-y-1">
          <p className="font-medium">Supported formats:</p>
          <p className="font-mono">• 1Abc...XYZ (folder ID)</p>
          <p className="font-mono">• https://drive.google.com/drive/folders/1Abc...XYZ</p>
        </div>
      </div>
    </div>
  );
}
