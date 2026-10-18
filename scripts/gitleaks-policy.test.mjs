import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const historicalCommit = "3f6eaad2585dd1f12c0759c3c0103ae344572316";
const publicationCommit = "f9e0806ff28e2def16dbac65f593c9c7c1e27a4b";
const historicalPath = "webapp/src/features/tutorial/TutorialExperience.tsx";
const image = JSON.parse(
  readFileSync(resolve(root, ".security/tools.json"), "utf8"),
).gitleaks.image;
// Synthetic values are assembled at runtime, never copied from credentials.
const fakeValue = ["aB3dE5fG7", "hJ9kL2mN4", "pQ6rS8tV0", "wX1yZ5cD7"].join("");
const comparison = (round, operator = "===", name = "task" + "Key") =>
  `${name} ${operator} 'round-${round}-thesis'`;
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);
Object.assign(gitEnv, {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
});

function git(cwd, args) {
  const result = spawnSync(
    "git",
    [
      "--no-optional-locks",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Synthetic Gitleaks Test",
      "-c",
      "user.email=synthetic@example.invalid",
      ...args,
    ],
    { cwd, env: gitEnv, encoding: "utf8", timeout: 30_000 },
  );
  if (result.error || result.status !== 0)
    throw new Error("Gitleaks fixture Git command failed");
  return result.stdout.trimEnd();
}

function temporaryCorpus(run) {
  const directory = mkdtempSync(resolve(tmpdir(), "anomaly-gitleaks-"));
  try {
    writeFileSync(
      resolve(directory, "defaults.toml"),
      "[extend]\nuseDefault = true\n",
    );
    writeFileSync(resolve(directory, "empty.ignore"), "");
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function scan(repository, directory, config, logOptions = "--all") {
  const reports = mkdtempSync(resolve(directory, "reports-"));
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--pull=never",
      "--network=none",
      "--volume",
      `${repository}:/src:ro`,
      "--volume",
      `${directory}:/fixtures:ro`,
      "--volume",
      `${reports}:/reports`,
      "--workdir",
      "/src",
      image,
      "git",
      "--no-banner",
      "--redact=100",
      "--log-level=error",
      "--config",
      `/fixtures/${config}`,
      "--gitleaks-ignore-path",
      "/fixtures/empty.ignore",
      "--report-format",
      "json",
      "--report-path",
      "/reports/findings.json",
      `--log-opts=${logOptions}`,
      "/src",
    ],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(
      `Pinned Gitleaks failed (exit ${result.status ?? "unknown"}); Docker and its pinned local image are required`,
    );
  }
  let findings;
  try {
    findings = JSON.parse(
      readFileSync(resolve(reports, "findings.json"), "utf8"),
    );
  } catch {
    throw new Error("Pinned Gitleaks did not return its required JSON report");
  }
  expect(Array.isArray(findings)).toBe(true);
  expect(result.status).toBe(findings.length ? 1 : 0);
  // Assertions retain location metadata only, never scanner Match/Secret fields.
  return findings
    .map(({ RuleID, File, Commit, StartLine, StartColumn }) => ({
      RuleID,
      File,
      Commit,
      StartLine,
      StartColumn,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

test("configuration retains defaults and one exact rule-specific AND classification", () => {
  const config = Bun.TOML.parse(
    readFileSync(resolve(root, ".gitleaks.toml"), "utf8"),
  );
  expect(Object.keys(config).sort()).toEqual(["extend", "rules", "title"]);
  expect(config.extend).toEqual({ useDefault: true });
  expect(config.rules).toHaveLength(1);
  expect(Object.keys(config.rules[0]).sort()).toEqual(["allowlists", "id"]);
  expect(config.rules[0].id).toBe("generic-api-key");
  expect(config.rules[0].allowlists).toHaveLength(1);
  const allowlist = config.rules[0].allowlists[0];
  expect(Object.keys(allowlist).sort()).toEqual([
    "commits",
    "condition",
    "description",
    "paths",
    "regexTarget",
    "regexes",
  ]);
  expect(allowlist.condition).toBe("AND");
  expect(allowlist.commits).toEqual([historicalCommit, publicationCommit]);
  expect(allowlist.paths).toEqual([
    String.raw`\Awebapp/src/features/tutorial/TutorialExperience\.tsx\z`,
  ]);
  expect(allowlist.regexTarget).toBe("match");
  expect(allowlist.regexes).toEqual([
    String.raw`\AtaskKey === '(?:round-1-thesis|round-2-thesis)'\z`,
  ]);
  const scripts = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  ).scripts;
  expect(scripts["postsecurity:gitleaks"]).toBe(
    "bun test scripts/gitleaks-policy.test.mjs",
  );
  expect(scripts["presecurity:gitleaks"]).toBeUndefined();
  expect(scripts["test:tooling"]).not.toContain("gitleaks-policy.test.mjs");
});

test("AND boundaries preserve all neighboring findings and inherited allowlists", () => {
  temporaryCorpus((directory) => {
    const repository = resolve(directory, "repository");
    mkdirSync(repository);
    git(repository, ["init", "--quiet"]);
    const write = (path, content) => {
      mkdirSync(dirname(resolve(repository, path)), { recursive: true });
      writeFileSync(resolve(repository, path), content);
    };
    const lines = [
      `${comparison(1)}; api_key = '${fakeValue}'`,
      comparison(2),
      comparison(1, "="),
      comparison(1, "=="),
      comparison(3),
      comparison(1, "===", "other" + "Key"),
      comparison(1).replaceAll("'", '"'),
    ];
    write(historicalPath, `${lines.join("\n")}\n`);
    write(`${historicalPath}.bak`, `${comparison(1)}\n${comparison(2)}\n`);
    write("other-rule.txt", ["ghp_", fakeValue.slice(0, 36)].join("") + "\n");
    // These are ignored by the pinned global and generic rule defaults respectively.
    write("go.sum", `api_key = '${fakeValue}'\n`);
    write("default-rule-allowlist.txt", `public_key = '${fakeValue}'\n`);
    git(repository, ["add", "--", "."]);
    git(repository, ["commit", "--quiet", "-m", "synthetic seed"]);
    const allowedCommit = git(repository, ["rev-parse", "HEAD"]);
    write(
      historicalPath,
      `${lines.join("\n")}\n${comparison(1)}\n${comparison(2)}\n`,
    );
    git(repository, ["add", "--", historicalPath]);
    git(repository, ["commit", "--quiet", "-m", "synthetic later commit"]);
    const otherCommit = git(repository, ["rev-parse", "HEAD"]);
    const policy = readFileSync(resolve(root, ".gitleaks.toml"), "utf8");
    // Only the commit identity changes; actual scanner evaluates the production rule/path/match.
    expect(policy.split(historicalCommit)).toHaveLength(2);
    writeFileSync(
      resolve(directory, "policy.toml"),
      policy.replace(historicalCommit, allowedCommit),
    );
    const defaults = scan(repository, directory, "defaults.toml");
    const approved = defaults.filter(
      (finding) =>
        finding.RuleID === "generic-api-key" &&
        finding.Commit === allowedCommit &&
        finding.File === historicalPath &&
        ((finding.StartLine === 1 && finding.StartColumn === 1) ||
          finding.StartLine === 2),
    );
    expect(approved).toHaveLength(2);
    for (const line of [3, 4, 5, 6, 7]) {
      expect(
        defaults.some(
          (finding) =>
            finding.Commit === allowedCommit &&
            finding.File === historicalPath &&
            finding.StartLine === line,
        ),
      ).toBe(true);
    }
    expect(
      defaults.some(
        (finding) =>
          finding.Commit === allowedCommit &&
          finding.File === historicalPath &&
          finding.StartLine === 1 &&
          finding.StartColumn > 1,
      ),
    ).toBe(true);
    expect(
      defaults.filter((finding) => finding.File === `${historicalPath}.bak`),
    ).toHaveLength(2);
    expect(
      defaults.filter((finding) => finding.Commit === otherCommit),
    ).toHaveLength(2);
    expect(defaults.some((finding) => finding.RuleID === "github-pat")).toBe(
      true,
    );
    expect(
      defaults.some((finding) =>
        ["go.sum", "default-rule-allowlist.txt"].includes(finding.File),
      ),
    ).toBe(false);
    const expected = defaults.filter((finding) => !approved.includes(finding));
    expect(scan(repository, directory, "policy.toml")).toEqual(expected);
    // Each explicit commit member must enforce the same exact match/path boundaries.
    expect(policy.split(publicationCommit)).toHaveLength(2);
    writeFileSync(
      resolve(directory, "policy.toml"),
      policy.replace(publicationCommit, allowedCommit),
    );
    expect(scan(repository, directory, "policy.toml")).toEqual(expected);
  });
}, 120_000);
