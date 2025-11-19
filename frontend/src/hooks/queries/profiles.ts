import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiProfilesGetProfilesOptions,
  apiProfilesProfileNameDriveFolderUpdateDriveFolderMutation,
} from "@/api/generated/@tanstack/react-query.gen";

export function useProfiles() {
  return useQuery({
    ...apiProfilesGetProfilesOptions(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useUpdateDriveFolder() {
  const queryClient = useQueryClient();
  const mutationOptions =
    apiProfilesProfileNameDriveFolderUpdateDriveFolderMutation();

  return useMutation({
    ...mutationOptions,
    onSuccess: (_data, variables) => {
      // Invalidate the specific profile query to update the folder ID
      queryClient.invalidateQueries({
        queryKey: ["api", "profiles", variables.path.profile_name],
      });

      // Also invalidate the profiles list
      queryClient.invalidateQueries({
        queryKey: ["api", "profiles"],
      });
    },
  });
}
