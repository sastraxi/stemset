import { DriveNavigator } from "@/components/drive/DriveNavigator";
import { useQuery } from "@tanstack/react-query";
import { apiProfilesProfileNameGetProfileOptions } from "@/api/generated/@tanstack/react-query.gen";

interface DriveViewProps {
  layout?: "sidebar" | "grid";
  profileName: string;
  googleDriveFolderId: string | null | undefined;
}

export function DriveView({
  layout = "sidebar",
  profileName,
  googleDriveFolderId: _googleDriveFolderId, // Ignore the prop, fetch fresh data
}: DriveViewProps) {
  // Fetch the latest profile data to get the current folder ID
  const { data: profile } = useQuery({
    ...apiProfilesProfileNameGetProfileOptions({
      path: { profile_name: profileName },
    }),
    staleTime: 0, // Always refetch to get latest folder ID
  });

  return (
    <DriveNavigator
      profileName={profileName}
      rootFolderId={profile?.google_drive_folder_id}
      mode={layout === "sidebar" ? "column" : "full"}
    />
  );
}
