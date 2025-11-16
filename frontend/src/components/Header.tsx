import { Link } from "@tanstack/react-router";
import type { ProfileResponse as Profile } from "@/api/generated";
import { ProfileSelector } from "./ProfileSelector";
import { UserNav } from "./UserNav";

interface HeaderProps {
  selectedProfile: string | null;
  profiles: Profile[] | undefined;
  onProfileChange: (profileName: string) => void;
  onLogoClick: () => void;
}

export function Header({
  selectedProfile,
  profiles,
  onProfileChange,
  onLogoClick,
}: HeaderProps) {
  return (
    <header className="px-3 py-2 flex justify-between items-center md:px-6 md:py-4">
      <div className="flex-1 flex items-center gap-4">
        {selectedProfile ? (
          <Link
            to="/p/$profileName"
            params={{ profileName: selectedProfile }}
            onClick={onLogoClick}
          >
            <img
              src="/logo.png"
              alt="Stemset"
              className="h-10 w-auto cursor-pointer"
            />
          </Link>
        ) : (
          <img src="/logo.png" alt="Stemset" className="h-10 w-auto" />
        )}
        <h1
          className="lowercase text-4xl font-bold tracking-tight m-0 hidden md:block"
          style={{ color: "#e8e8e8" }}
        >
          Stemset
        </h1>
      </div>
      <div className="flex-none ml-auto flex items-center gap-3">
        {profiles && (
          <ProfileSelector
            profiles={profiles}
            selectedProfile={selectedProfile}
            onSelectProfile={onProfileChange}
            fileCountByProfile={{}} // Removed for now
          />
        )}
        <UserNav />
      </div>
    </header>
  );
}
