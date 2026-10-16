/**
 * Operator command. Prints a scrypt verifier for SA360_META_REVIEWER_PASSWORD.
 * Reads REVIEWER_PASSWORD_INPUT from the environment and does not log it.
 * Do not pass the password as an argument. Bash, Git Bash, and PowerShell
 * prompts are in docs/runbooks/meta-app-reviewer-access.md. cmd.exe `set` is not safe.
 */
import * as passwordModule from "../src/lib/meta-reviewer-password.ts";

type Hasher = {
  hashMetaReviewerPassword: (password: string) => Promise<string>;
};

const hasher = passwordModule as Hasher & { default?: Hasher };
const hashMetaReviewerPassword =
  hasher.hashMetaReviewerPassword ?? hasher.default?.hashMetaReviewerPassword;

async function main(): Promise<void> {
  const password = process.env.REVIEWER_PASSWORD_INPUT ?? "";
  if (!hashMetaReviewerPassword) {
    throw new Error("meta_reviewer_hasher_unavailable");
  }
  if (password.length < 20) {
    throw new Error("Use at least 20 characters.");
  }

  process.stdout.write(await hashMetaReviewerPassword(password));
  process.stdout.write("\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "meta_reviewer_hash_failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
