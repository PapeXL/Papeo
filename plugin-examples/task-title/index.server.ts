import type { PluginServerContext } from "@getpaseo/plugin/server";
import { deriveTaskWorkspaceTitle } from "./server/derive-title";

export default function contribute(server: PluginServerContext) {
  server.before("workspace.create", ({ request }) => {
    if (request.title) {
      return request;
    }
    const title = deriveTaskWorkspaceTitle(request.firstAgentContext?.prompt);
    if (!title) {
      return request;
    }
    return { ...request, title };
  });

  return () => {};
}
