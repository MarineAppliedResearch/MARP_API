Agents.md
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.
2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

5. Comment Length
Many short comments over a few long ones.

Average about 2 lines per comment. If a comment runs longer, it's usually explaining too much "what" (the code already shows that) instead of just the non-obvious "why." Although
having some "what" is encoraged.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

6. Remote Dev Jellyfin Server Access (#36)

A patched, buildable Jellyfin dev instance runs on the user's real production Jellyfin hardware (not the local sandbox), reachable via a two-hop SSH bastion. See `agents_history.md`'s 2026-08-13 entry for the full story behind why.

Connection: `ssh jellyfin-dev-server` (config already set up in `~/.ssh/config` -> `~/.ssh/config_jellyfin_dev`, using `ProxyJump` through a `jellyfin-border` host entry). Both hops use dedicated keypairs (`~/.ssh/jellyfin_dev_remote` for the border server, `~/.ssh/jellyfin_dev_remote_hop2` for the Jellyfin box itself) under a restricted, no-sudo `claude-jellyfin-dev` account on each machine -- never reuse these keys for anything else, and never agent-forward through the border host.

If the host key for the Jellyfin box (`192.168.1.202`) ever shows as changed again, don't just delete the `known_hosts` entry -- verify the fingerprint out-of-band first (e.g. `ssh jellyfin-border "ssh-keyscan -t ed25519 192.168.1.202 | ssh-keygen -lf -"`, compared against what the user confirms directly) before trusting it. This is a real production-adjacent machine; treat host-key warnings there as a genuine security check, not a formality.

On that box: this account's home directory holds `~/jellyfin-src/jellyfin` (git repo, branch `marp-dev`, one commit on top of the upstream `v10.11.11` tag containing the `-noaccurate_seek` fix in `EncodingHelper.cs` -- see that commit message for the bug writeup) and `~/jellyfin-src/jellyfin-web` (unmodified `v10.11.11` clone). `~/.dotnet` has .NET 9.0.317; `~/.nvm` has Node 20.20.2. The dev instance runs on **port 8097** (never 8096 -- that's the real, live, production `jellyfin.service`; do not touch it, its config, or its systemd unit), with its own datadir at `~/jellyfin-src/data` and web client linked from `~/jellyfin-src/jellyfin-web/dist`. Its own `network.xml` had to be hand-authored before first launch since there's no `--port` CLI flag -- the runtime config class is `MediaBrowser.Common.Net.NetworkConfiguration` (`InternalHttpPort`/`PublicHttpPort`, not the differently-named fields in the migration-only `OldNetworkConfiguration` class -- easy to mix up). Admin login: `admin` / `MarpDevJellyfinRemote2026!`. Its library holds two videos copied (not symlinked) from the real production media archive at `/mnt/rov-video-new/...` into `~/jellyfin-src/media/` -- keep dev-instance media copied into its own folder, not pointed at the live archive tree.

To start/restart the dev instance: launching over SSH with `nohup ... & disown` reliably leaves the SSH command itself hanging (a known artifact, not a real failure) -- issue the start command, then verify success from a *separate* fresh SSH connection (`curl http://localhost:8097/System/Info/Public`) rather than waiting on the launching command to return. This box builds and transcodes dramatically faster than the local sandbox (`dotnet build` in ~1-2min, `npm install`/webpack in under a minute each, real ffmpeg encodes at ~15x realtime) -- prefer it over the sandbox for anything performance-sensitive in this investigation.