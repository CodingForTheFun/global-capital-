#!/usr/bin/env node
/**
 * Print the release anchor the review gate will demand for a recovery merge.
 *
 * .github/workflows/release-candidate-check.yml only lets a merge deploy when
 * its first parent is a *verified* deployment. That means both required push
 * workflows succeeded on that commit AND a later successful autoprop-live
 * Railway status exists. When the parent isn't verified, a trusted pre-merge
 * comment must name the nearest verified first-parent ancestor. That is not
 * necessarily the revision production reports: #625 named eed10580b249 (the
 * live revision) while the gate wanted e4a1d461a7f0, and the deploy was held.
 *
 * This mirrors the gate's findVerifiedDeployedAncestor; keep them in step.
 *
 * Usage: GITHUB_TOKEN=... node scripts/release-anchor.mjs [ref=production-stable]
 */

export const REQUIRED_PARENT_WORKFLOWS = ['Auto Scout release checks', 'Oblige Props production smoke'];
export const RAILWAY_CONTEXT = 'AutoProp Scout Pro - autoprop-live';
export const RAILWAY_SERVICE_PATH = /\/service\/f6d34023-04e3-4799-a3c4-defab50a7a1e\?id=/;

const time = (row) => Date.parse(row?.updated_at || row?.created_at || '') || 0;

/**
 * @param {object} api  { pushRuns(sha) -> workflow runs, statuses(sha) -> commit statuses, parent(sha) -> sha|null }
 */
export async function verifiedDeployment(api, sha) {
  const runs = await api.pushRuns(sha);
  const latest = REQUIRED_PARENT_WORKFLOWS.map((name) =>
    runs.filter((run) => run.name === name && run.head_sha === sha).sort((a, b) => time(b) - time(a))[0] || null,
  );
  if (latest.some((run) => !run || run.status !== 'completed' || run.conclusion !== 'success')) return null;
  const verifiedAt = Math.max(...latest.map(time));
  const deployment = (await api.statuses(sha)).find((row) =>
    row.context === RAILWAY_CONTEXT
    && row.state === 'success'
    && RAILWAY_SERVICE_PATH.test(row.target_url || '')
    && (Date.parse(row.created_at || '') || 0) > verifiedAt,
  );
  return deployment ? { sha, verifiedAt } : null;
}

export async function findAnchor(api, startSha, maxDepth = 30) {
  let cursor = startSha;
  for (let depth = 0; depth < maxDepth && cursor; depth += 1) {
    const proof = await verifiedDeployment(api, cursor);
    if (proof) return { ...proof, depth };
    cursor = await api.parent(cursor);
  }
  return null;
}

export const recoveryComment = (anchorSha) =>
  `SAFE TO MERGE — RELEASE RECOVERY VERIFIED, deployed anchor ${anchorSha.slice(0, 12)}`;

function githubApi({ owner, repo, token }) {
  const call = async (path) => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!response.ok) throw new Error(`GitHub ${path} returned HTTP ${response.status}`);
    return response.json();
  };
  return {
    pushRuns: async (sha) =>
      (await call(`/actions/runs?branch=production-stable&event=push&head_sha=${sha}&per_page=100`)).workflow_runs || [],
    statuses: async (sha) => (await call(`/commits/${sha}/status`)).statuses || [],
    parent: async (sha) => (await call(`/commits/${sha}`)).parents?.[0]?.sha || null,
    resolve: async (ref) => (await call(`/commits/${encodeURIComponent(ref)}`)).sha,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || 'CodingForTheFun/global-capital-').split('/');
  const api = githubApi({ owner, repo, token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN });
  const head = await api.resolve(process.argv[2] || 'production-stable');
  const parentVerified = await verifiedDeployment(api, head);
  if (parentVerified) {
    console.log(`${head.slice(0, 12)} is a verified deployment: the next merge needs only a normal SAFE TO MERGE review.`);
  } else {
    const anchor = await findAnchor(api, head);
    if (!anchor) {
      console.error(`No verified deployment within 30 first-parent steps of ${head.slice(0, 12)}.`);
      process.exitCode = 1;
    } else {
      console.log(`${head.slice(0, 12)} is not a verified deployment. Anchor: ${anchor.sha.slice(0, 12)} (${anchor.depth} step(s) back).`);
      console.log('Recovery comment for the next PR, posted before merging:');
      console.log(recoveryComment(anchor.sha));
    }
  }
}
