import type { ReactNode } from "react";
import { Shell } from "../../../components/shell";

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <Shell workspaceId={workspaceId}>{children}</Shell>;
}
