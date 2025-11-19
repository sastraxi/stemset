import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiProfilesProfileNameDriveContentsGetDriveFolderContentsOptions,
  apiProfilesProfileNameDriveImportImportDriveFileMutation,
  apiProfilesProfileNameFilesGetProfileFilesQueryKey,
} from "@/api/generated/@tanstack/react-query.gen";

export function useDriveFolderContents(
  profileName: string | undefined,
  folderId: string | undefined,
) {
  const options =
    apiProfilesProfileNameDriveContentsGetDriveFolderContentsOptions({
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

export function useImportDriveFile() {
  const queryClient = useQueryClient();
  const mutationOptions = apiProfilesProfileNameDriveImportImportDriveFileMutation();

  return useMutation({
    ...mutationOptions,
    onSuccess: (_data, variables) => {
      // Invalidate recordings list to show new import
      queryClient.invalidateQueries({
        queryKey: apiProfilesProfileNameFilesGetProfileFilesQueryKey({
          path: { profile_name: variables.path.profile_name },
        }),
      });

      // Invalidate Drive folder to update import status
      queryClient.invalidateQueries({
        queryKey: ["api", "profiles", variables.path.profile_name, "drive"],
      });
    },
  });
}
