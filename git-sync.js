// Auto-sync: while NorthGate Staff runs on the Pi, it watches its own GitHub repo and pulls
// new commits by itself. When you push from your PC, the Pi picks it up within a few
// seconds, runs npm install if the dependencies changed, then exits so pm2 restarts
// it on the new code. No manual git pull + restart on the Pi.
//
// This only does anything on the Pi (where the bot is started under pm2). On your PC
// it is harmless: if the branch has extra local commits it just leaves them alone.
const { execFile } = require('child_process');
const path = require('path');

const repoPath = path.resolve(__dirname);

const DEFAULTS = {
  enabled: true,
  intervalSeconds: 30,
  remote: 'origin',
  branch: null,        // null = whatever branch is checked out right now
  autoInstall: true,   // run npm install when package.json / lockfile changes
  hardReset: false,    // if the branch diverged, discard local commits to match remote
  restartOnUpdate: true,
};

function log(...args) {
  console.log(`[git-sync ${new Date().toISOString()}]`, ...args);
}

function warn(...args) {
  console.warn(`[git-sync ${new Date().toISOString()}]`, ...args);
}

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd: repoPath, timeout: 120000, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = (stderr || '').trim();
        error.stdout = (stdout || '').trim();
        return reject(error);
      }
      resolve(stdout.trim());
    });
  });
}

const git = (...args) => run('git', args);

function describeError(err) {
  return err?.stderr || err?.message || String(err);
}

async function isGitRepo() {
  try {
    return (await git('rev-parse', '--is-inside-work-tree')) === 'true';
  } catch {
    return false;
  }
}

async function resolveBranch(configuredBranch) {
  if (configuredBranch) return configuredBranch;
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === 'HEAD') {
    throw new Error('repository is in detached HEAD state; set gitSync.branch to a branch name');
  }
  return branch;
}

// Cheap remote check: one ref lookup, no object transfer. Safe to poll often.
async function getRemoteSha(remote, branch) {
  const output = await git('ls-remote', '--heads', remote, branch);
  if (!output) throw new Error(`branch "${branch}" does not exist on remote "${remote}"`);
  return output.split(/\s+/)[0];
}

async function changedFiles(fromSha, toSha) {
  const output = await git('diff', '--name-only', `${fromSha}..${toSha}`);
  return output ? output.split('\n') : [];
}

async function fastForward(remote, branch) {
  await git('fetch', '--quiet', '--prune', remote, branch);
  return git('merge', '--ff-only', `${remote}/${branch}`);
}

async function hardResetTo(remote, branch) {
  await git('fetch', '--quiet', '--prune', remote, branch);
  return git('reset', '--hard', `${remote}/${branch}`);
}

async function installDependencies() {
  log('dependency manifest changed; running npm install...');
  try {
    const output = await run('npm', ['install', '--no-audit', '--no-fund'], { timeout: 600000 });
    log('npm install complete.');
    if (output) log(output.split('\n').slice(-5).join('\n'));
    return true;
  } catch (err) {
    warn('npm install failed; keeping existing node_modules:', describeError(err));
    return false;
  }
}

function createSyncer(settings, hooks) {
  let inFlight = false;
  let restarting = false;

  return async function attemptSync() {
    if (inFlight || restarting) return;
    inFlight = true;

    try {
      const branch = await resolveBranch(settings.branch);
      const localSha = await git('rev-parse', 'HEAD');
      const remoteSha = await getRemoteSha(settings.remote, branch);

      if (localSha === remoteSha) return;

      log(`remote differs on ${settings.remote}/${branch}: ${localSha.slice(0, 7)} -> ${remoteSha.slice(0, 7)}`);

      let updated = false;
      try {
        await fastForward(settings.remote, branch);
        updated = true;
      } catch (err) {
        const reason = describeError(err);
        if (settings.hardReset) {
          warn('fast-forward failed, falling back to hard reset:', reason);
          await hardResetTo(settings.remote, branch);
          updated = true;
        } else {
          warn('fast-forward failed, leaving working tree untouched:', reason);
          warn('resolve manually (commit, stash, or discard local changes), or set gitSync.hardReset = true.');
          return;
        }
      }

      if (!updated) return;

      const newSha = await git('rev-parse', 'HEAD');

      // HEAD did not move. We were already level with or ahead of the remote, e.g.
      // local commits not pushed yet. Nothing new to apply, so do not reinstall or
      // restart (otherwise an unpushed commit would restart on every poll).
      if (newSha === localSha) {
        log('local branch already contains the remote commits (nothing to apply).');
        return;
      }

      log(`working tree now at ${newSha.slice(0, 7)}.`);

      if (settings.autoInstall) {
        let files = [];
        try {
          files = await changedFiles(localSha, newSha);
        } catch (err) {
          warn('could not diff updated commits:', describeError(err));
        }
        const manifestChanged = files.some((f) => f === 'package.json' || f === 'package-lock.json');
        if (manifestChanged) await installDependencies();
      }

      if (!settings.restartOnUpdate) {
        log('restartOnUpdate is off; new code applies on the next manual restart.');
        return;
      }

      restarting = true;
      log('restarting process to apply updates.');

      if (typeof hooks.onBeforeRestart === 'function') {
        try {
          await hooks.onBeforeRestart();
        } catch (err) {
          warn('shutdown hook failed:', describeError(err));
        }
      }

      // pm2 (autorestart) brings the process back up on the new code.
      process.exit(0);
    } catch (err) {
      warn('sync failed:', describeError(err));
    } finally {
      inFlight = false;
    }
  };
}

module.exports = {
  startAutoSync: async function (options = {}, hooks = {}) {
    const settings = { ...DEFAULTS, ...options };

    if (!settings.enabled) {
      log('auto-sync disabled via config.');
      return;
    }
    if (!Number.isFinite(settings.intervalSeconds) || settings.intervalSeconds < 5) {
      throw new Error('gitSync.intervalSeconds must be a number >= 5');
    }
    if (!(await isGitRepo())) {
      warn('not a git repository; auto-sync will not run.');
      return;
    }

    let branchLabel;
    try {
      branchLabel = await resolveBranch(settings.branch);
    } catch (err) {
      warn('auto-sync could not start:', describeError(err));
      return;
    }

    log(`watching ${settings.remote}/${branchLabel} every ${settings.intervalSeconds}s (hardReset=${settings.hardReset}, autoInstall=${settings.autoInstall}).`);

    const attemptSync = createSyncer(settings, hooks);
    const timer = setInterval(() => { attemptSync(); }, settings.intervalSeconds * 1000);
    timer.unref?.();

    await attemptSync();
    return { syncNow: attemptSync, stop: () => clearInterval(timer) };
  },
};
