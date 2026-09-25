# Task title

Names a new workspace after the task ID in its first prompt, so workspaces started from the same
task are easy to spot in the sidebar.

When a workspace is created without an explicit title, `server.before("workspace.create", ...)`
reads the first non-empty line of `firstAgentContext.prompt`. A line starting with `#<task-id> -
<description>` becomes the workspace title `#<task-id> — <description>`. Any other prompt shape
leaves the request untouched and the default prompt-derived title still applies.

```
#1234 - fix the login bug on mobile
```

becomes the workspace title `#1234 — fix the login bug on mobile`.

Install it on a daemon with plugins enabled:

```bash
paseo plugin install /absolute/path/to/plugin-examples/task-title
```

Copy `server/derive-title.ts` into your own plugin and adjust `TASK_ID_LINE` if your task IDs use a
different prefix or separator.

See the [lifecycle reference](../../public-docs/plugins/reference.md#lifecycle-hooks) for the API.
