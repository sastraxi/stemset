import { ChevronDown, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, type User } from "../contexts/AuthContext";

export function UserNav() {
  const { authStatus, logout } = useAuth();

  if (!authStatus?.user) {
    return null;
  }

  const { user } = authStatus;

  // Get user's initials from name or email
  const getInitials = (user: User) => {
    if (user.name) {
      const nameParts = user.name.split(" ");
      if (nameParts.length >= 2) {
        return (nameParts[0][0] + nameParts[1][0]).toUpperCase();
      }
      return nameParts[0][0].toUpperCase();
    }

    const parts = user.email.split("@")[0].split(".");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return user.email[0].toUpperCase();
  };

  // Generate a fallback avatar URL if no Google picture
  const getFallbackAvatarUrl = (user: User) => {
    const initials = getInitials(user);
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=4a9eff&color=fff&size=128`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`
						flex items-center
						gap-2
						rounded-lg
						px-3 py-2
						hover:bg-white/10
						transition-colors
						focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-gray-800
					`}
        >
          <Avatar className="h-9 w-9 ring-2 ring-white/20">
            <AvatarImage
              src={user.picture || getFallbackAvatarUrl(user)}
              alt={user.name}
            />
            <AvatarFallback className="bg-blue-500 text-white font-medium">
              {getInitials(user)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium text-white hidden sm:inline-block max-w-32 truncate">
            {user.name || user.email.split("@")[0]}
          </span>
          <ChevronDown className="h-4 w-4 text-gray-300" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-2 py-3">
          <Avatar className="h-10 w-10">
            <AvatarImage
              src={user.picture || getFallbackAvatarUrl(user)}
              alt={user.name}
            />
            <AvatarFallback className="bg-primary text-primary-foreground font-medium">
              {getInitials(user)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-medium text-sm">
              {user.name || user.email.split("@")[0]}
            </span>
            <span className="text-xs text-muted-foreground">{user.email}</span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-500/10 focus:text-red-300 focus:bg-red-500/10"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
