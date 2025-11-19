import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiClipsClipIdUpdateClipEndpointMutation,
  apiClipsClipIdDeleteClipEndpointMutation,
} from "@/api/generated/@tanstack/react-query.gen";

export function useUpdateClip() {
  const queryClient = useQueryClient();
  const mutationOptions = apiClipsClipIdUpdateClipEndpointMutation();

  return useMutation({
    ...mutationOptions,
    onSuccess: () => {
      // Invalidate clips and profiles queries to refresh the metadata
      queryClient.invalidateQueries({
        queryKey: ["api", "clips"],
      });
      queryClient.invalidateQueries({
        queryKey: ["api", "profiles"],
      });
    },
  });
}

export function useDeleteClip() {
  const queryClient = useQueryClient();
  const mutationOptions = apiClipsClipIdDeleteClipEndpointMutation();

  return useMutation({
    ...mutationOptions,
    onSuccess: () => {
      // Invalidate clips and profiles queries to refresh the list
      queryClient.invalidateQueries({
        queryKey: ["api", "clips"],
      });
      queryClient.invalidateQueries({
        queryKey: ["api", "profiles"],
      });
    },
  });
}
