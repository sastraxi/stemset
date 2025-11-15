import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$profileName")({
  component: Outlet,
});
