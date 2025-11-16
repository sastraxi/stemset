import { MoreVertical, Pencil, QrCode, Scissors, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface RecordingMenuProps {
  onShowQR: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCreateClip?: () => void;
  hasSelection?: boolean;
  disabled?: boolean;
}

interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
  iconSize?: string;
  title?: string;
  separator?: boolean;
}

export function RecordingMenu({
  onShowQR,
  onEdit,
  onDelete,
  onCreateClip,
  hasSelection = false,
  disabled = false,
}: RecordingMenuProps) {
  // Single source of truth for menu items
  const menuItems: MenuItem[] = [
    {
      id: "qr",
      label: "Share recording",
      icon: QrCode,
      onClick: onShowQR,
      disabled,
      iconSize: "h-5 w-5",
      title: "Share recording",
    },
    ...(onCreateClip
      ? [
          {
            id: "create-clip",
            label: "Create clip from selection",
            icon: Scissors,
            onClick: onCreateClip,
            disabled: disabled || !hasSelection,
            iconSize: "h-4 w-4",
            title: hasSelection
              ? "Create clip from selection"
              : "Select a range to create a clip",
          },
        ]
      : []),
    {
      id: "edit",
      label: "Edit metadata",
      icon: Pencil,
      onClick: onEdit,
      disabled,
      iconSize: "h-4 w-4",
      title: "Edit metadata",
    },
    {
      id: "delete",
      label: "Delete recording",
      icon: Trash2,
      onClick: onDelete,
      disabled,
      variant: "destructive" as const,
      iconSize: "h-4 w-4",
      title: "Delete recording",
      separator: true,
    },
  ];

  return (
    <>
      {/* Desktop: Horizontal buttons */}
      <div className="recording-menu-desktop">
        {menuItems.map((item) => (
          <Button
            key={item.id}
            variant={item.variant === "destructive" ? "destructive" : "outline"}
            size="sm"
            onClick={item.onClick}
            disabled={item.disabled}
            title={item.title}
            className={`recording-menu-button px-2 ${item.variant === "destructive" ? "recording-menu-button-delete" : ""}`}
          >
            <item.icon className={item.iconSize} />
          </Button>
        ))}
      </div>

      {/* Mobile: Dropdown menu */}
      <div className="recording-menu-mobile">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              disabled={disabled}
              title="Recording menu"
              className="recording-menu-trigger"
            >
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuItems.map((item, index) => (
              <div key={item.id}>
                {item.separator && index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onClick={item.onClick}
                  disabled={item.disabled}
                  className={
                    item.variant === "destructive"
                      ? "text-destructive focus:text-destructive"
                      : ""
                  }
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.label}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
