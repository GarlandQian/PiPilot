# Design

## Safe Sequence

1. Freeze repository edits and fetch/prune remote refs.
2. Verify `origin/main`, branches, tags, status, and first-release inventory.
   Classify AI development files through the approved portable-source whitelist
   and validate every symlink target.
3. Use an orphan branch/index strategy to create a parentless commit from the
   current reviewed tree; do not reset the worktree.
4. Inspect the resulting commit tree and run final static secret/path/artifact
   scans, including developer journals and external Skill links.
5. Move local `main` to the root and verify the local state.
6. Show the user old remote and new root IDs and obtain final confirmation.
7. Push with `--force-with-lease=main:<verified-old-id>`.
8. Fetch and verify remote equality.
9. Create annotated `v0.0.1`, push the tag, and monitor the workflow.

## Recovery

Record the old commit IDs in the task journal before rewriting. If local root
construction fails, leave remote untouched and return to the prior local ref.
If the lease fails, stop and re-plan against the changed remote; never override
a collaborator's new remote commit. If the workflow fails after the tag, no
public Release should exist; fix the workflow and rerun only after confirming
the version remains unused. If publication already occurred, use a higher
version rather than replacing the published release.
