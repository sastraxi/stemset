import { ChevronDown, Music } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Profile } from '../types';

interface ProfileSelectorProps {
  profiles: Profile[]
  selectedProfile: string | null
  onSelectProfile: (profileName: string) => void
  fileCountByProfile: Record<string, number>
}

export function ProfileSelector({ profiles, selectedProfile, onSelectProfile, fileCountByProfile }: ProfileSelectorProps) {
  const currentProfile = profiles.find(p => p.name === selectedProfile);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-gray-800">
          <Music className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium text-white hidden sm:inline-block">
            {currentProfile?.name || 'Select Profile'}
          </span>
          <ChevronDown className="h-4 w-4 text-gray-300" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-fit w-auto bg-[#2a2a2a] border-[#3a3a3a]"
      >
        {profiles.map((profile) => (
          <DropdownMenuItem
            key={profile.name}
            onClick={() => onSelectProfile(profile.name)}
            className={`flex items-center justify-between gap-8 cursor-pointer
              ${selectedProfile === profile.name
                ? 'bg-blue-400/15 text-blue-400 focus:bg-blue-400/20 focus:text-blue-400'
                : 'text-gray-200 focus:bg-white/5 focus:text-gray-200'
              }`}
          >
            <span className="font-medium whitespace-nowrap">{profile.name}</span>
            <span className="text-gray-500 text-xs tabular-nums">{fileCountByProfile[profile.name] || 0}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
