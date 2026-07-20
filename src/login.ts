import {
  addAccount,
  removeAccount,
  listAccounts,
  type QwenAccount,
} from "./core/accounts.ts";

import { maskEmail } from "./core/logger.ts";
import {
  PURPLE,
  PURPLE_BRIGHT,
  PURPLE_LIGHT,
  PURPLE_DIM,
  PURPLE_MUTED,
  PURPLE_VIVID,
  BOLD,
  clearTerminal,
  paint,
} from "./core/ansi.ts";
import { createQwenAccountAuto } from "./services/account-register.ts";
import * as readline from "readline";
import * as dotenv from "dotenv";

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const MAX_CREATE_PER_TURN = 50;

function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer.trim());
    });
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function p(text: string, ...codes: string[]) {
  return paint(text, ...codes);
}

function line(ch = "─", n = 46) {
  return p(ch.repeat(n), PURPLE_DIM);
}

function header(title: string) {
  console.log();
  console.log(p("  ▸ " + title, BOLD, PURPLE_BRIGHT));
  console.log(p("  " + line(), PURPLE_DIM));
}

function mute(s: string) {
  return p(s, PURPLE_MUTED);
}

function ok(s: string) {
  return p(s, PURPLE_LIGHT);
}

function err(s: string) {
  return p(s, PURPLE_VIVID);
}

function askPurple(prompt: string): Promise<string> {
  return askQuestion(p(prompt, PURPLE));
}

/** Drop noisy service spam; keep only account-manager UI lines. */
function silenceNoisyServiceLogs() {
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const re =
    /^\[(Register|RegisterHTTP|WafAssist|PuzzleSolver|EmailVerify|AutoCreate)/;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && re.test(args[0])) return;
    origLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && re.test(args[0])) return;
    origWarn(...args);
  };
  return () => {
    console.log = origLog;
    console.warn = origWarn;
  };
}

function printMenuBanner(accountCount: number) {
  clearTerminal();
  console.log();
  console.log(p("  ╔════════════════════════════════════════════╗", PURPLE_DIM));
  console.log(
    p("  ║", PURPLE_DIM) +
      p("   QwenBridge  ·  Account Manager", BOLD, PURPLE_BRIGHT) +
      p("      ║", PURPLE_DIM),
  );
  console.log(p("  ╚════════════════════════════════════════════╝", PURPLE_DIM));
  console.log(mute(`  accounts · ${accountCount}  ·  playwright auth`));
  console.log();
}

async function showMenu() {
  while (true) {
    const accounts = listAccounts();
    printMenuBanner(accounts.length);

    if (accounts.length > 0) {
      console.log(p("  contas", PURPLE_MUTED));
      for (let i = 0; i < accounts.length; i++) {
        console.log(
          p(`    ${String(i + 1).padStart(2, " ")}  `, PURPLE_DIM) +
            p(maskEmail(accounts[i].email), PURPLE_LIGHT) +
            mute(`  ${accounts[i].id.slice(0, 8)}`),
        );
      }
      console.log();
    } else {
      console.log(mute("  nenhuma conta ainda\n"));
    }

    console.log(p("  opções", PURPLE_MUTED));
    console.log(
      p("    [A]", PURPLE_BRIGHT) + p("  adicionar conta existente", PURPLE),
    );
    console.log(
      p("    [C]", PURPLE_BRIGHT) +
        p("  criar contas", PURPLE) +
        mute("  · 1–50 / turno"),
    );
    if (accounts.length > 0) {
      console.log(
        p("    [R]", PURPLE_BRIGHT) + p("  remover conta", PURPLE),
      );
    }
    console.log(p("    [Q]", PURPLE_BRIGHT) + p("  sair", PURPLE));
    console.log();

    const choice = (await askPurple("  › ")).toUpperCase();

    if (choice === "Q") {
      rl.close();
      process.exit(0);
    }
    if (choice === "A") {
      await addAccountFlow();
      continue;
    }
    if (choice === "C") {
      await createAccountFlow();
      continue;
    }
    if (choice === "R" && accounts.length > 0) {
      await removeAccountFlow();
      continue;
    }
  }
}

async function addAccountFlow() {
  clearTerminal();
  header("Adicionar conta");
  console.log(mute("  Use se a conta Qwen já existe.\n"));

  const email = await askPurple("  email  › ");
  if (!email) {
    console.log(err("  email obrigatório"));
    await askPurple("  enter… ");
    return;
  }
  const password = await askPurple("  senha  › ");
  if (!password) {
    console.log(err("  senha obrigatória"));
    await askPurple("  enter… ");
    return;
  }

  let account: QwenAccount | null = null;
  try {
    account = addAccount(email, password);
    console.log(
      ok(`\n  + ${maskEmail(account.email)}`) + mute(`  ${account.id}`),
    );
  } catch (e: any) {
    if (account) removeAccount(account.id);
    console.log(err(`\n  ${e.message}`));
  }
  await askPurple("\n  enter… ");
}

/**
 * Create 1–50 accounts with purple UI + quiet service logs.
 */
async function createAccountFlow() {
  clearTerminal();
  header("Criar contas");
  console.log(mute("  mail.tm · captcha · ativar e-mail · provar login"));
  console.log(
    mute(
      `  máx ${MAX_CREATE_PER_TURN}/turno  ·  ~1 min/conta  ·  auto-create se o pool morrer`,
    ),
  );
  console.log();

  const raw = await askPurple(
    `  quantas? (1–${MAX_CREATE_PER_TURN}) [1]  › `,
  );
  let count = raw === "" ? 1 : parseInt(raw, 10);
  if (!Number.isFinite(count) || count < 1) {
    console.log(err("  número inválido"));
    await askPurple("  enter… ");
    return;
  }
  if (count > MAX_CREATE_PER_TURN) {
    console.log(mute(`  cap ${MAX_CREATE_PER_TURN}`));
    count = MAX_CREATE_PER_TURN;
  }

  console.log(
    p(`\n  ${count} conta(s)`, PURPLE_LIGHT) +
      mute(`  · estimativa ~${count} min`),
  );
  const confirm = await askPurple("  confirmar? (y/N)  › ");
  if (confirm.toLowerCase() !== "y") {
    console.log(mute("  cancelado"));
    await askPurple("  enter… ");
    return;
  }

  process.env.REGISTER_QUIET = "1";
  process.env.SOLVER_HUMAN_SLIDER_TRAVEL =
    process.env.SOLVER_HUMAN_SLIDER_TRAVEL ?? "0";
  const restoreLogs = silenceNoisyServiceLogs();

  const batchT0 = Date.now();
  let okN = 0;
  let failN = 0;
  const created: {
    email: string;
    password: string;
    username: string;
    s: number;
  }[] = [];

  console.log();
  console.log(line());

  try {
    for (let i = 1; i <= count; i++) {
      const tag = p(`[${i}/${count}]`, PURPLE_DIM);
      process.stdout.write(
        p(`  ${tag} `, PURPLE) + mute("criando…"),
      );

      const oneT0 = Date.now();
      let account: QwenAccount | null = null;

      try {
        const result = await createQwenAccountAuto();
        const creds = result.credentials;
        const sec = Number(((Date.now() - oneT0) / 1000).toFixed(1));

        // clear "criando…" line
        process.stdout.write("\r" + " ".repeat(60) + "\r");

        if (!result.success || !creds) {
          failN++;
          console.log(
            p(`  [${i}/${count}]`, PURPLE_DIM) +
              err("  fail") +
              mute(`  ${sec}s  ${result.error || "?"}`),
          );
          if (i < count) await sleep(20_000);
          continue;
        }

        try {
          account = addAccount(creds.email, creds.password);
        } catch (e: any) {
          if (
            String(e?.message || "")
              .toLowerCase()
              .includes("already exists")
          ) {
            okN++;
            created.push({
              email: creds.email,
              password: creds.password,
              username: creds.username,
              s: sec,
            });
            console.log(
              p(`  [${i}/${count}]`, PURPLE_DIM) +
                ok("  ok") +
                mute(`  já no db  ${sec}s`),
            );
            console.log(mute(`         ${creds.email}`));
            continue;
          }
          throw e;
        }

        okN++;
        created.push({
          email: creds.email,
          password: creds.password,
          username: creds.username,
          s: sec,
        });

        const mail = result.emailVerified ? "mail✓" : "mail…";
        console.log(
          p(`  [${i}/${count}]`, PURPLE_DIM) +
            ok("  ok") +
            p(`  ${sec}s`, PURPLE_LIGHT) +
            mute(`  ${mail}  ${result.method || ""}`),
        );
        console.log(
          p("         ", PURPLE_DIM) +
            p(creds.email, PURPLE_LIGHT) +
            mute(`  ${creds.password}`),
        );
        // Aliyun-safe spacing (seq only; never parallel captcha)
        if (i < count) await sleep(10_000);
      } catch (e: any) {
        failN++;
        if (account) removeAccount(account.id);
        process.stdout.write("\r" + " ".repeat(60) + "\r");
        console.log(
          p(`  [${i}/${count}]`, PURPLE_DIM) +
            err("  erro") +
            mute(`  ${e?.message || e}`),
        );
        if (i < count) await sleep(20_000);
      }
    }
  } finally {
    restoreLogs();
    delete process.env.REGISTER_QUIET;
  }

  const totalS = ((Date.now() - batchT0) / 1000).toFixed(1);
  console.log(line());
  header("Resumo");
  console.log(
    mute("  pedidas ") +
      p(String(count), PURPLE_LIGHT) +
      mute("   ok ") +
      ok(String(okN)) +
      mute("   fail ") +
      err(String(failN)) +
      mute("   tempo ") +
      p(`${totalS}s`, PURPLE_LIGHT),
  );

  if (created.length > 0) {
    console.log();
    console.log(mute("  salvas"));
    for (const c of created) {
      console.log(
        p("    · ", PURPLE_DIM) +
          p(c.username, PURPLE) +
          mute(`  ${c.email}  ${c.password}  ${c.s}s`),
      );
    }
  }
  console.log();
  await askPurple("  enter… ");
}

async function removeAccountFlow() {
  const accounts = listAccounts();
  if (accounts.length === 0) return;

  clearTerminal();
  header("Remover conta");
  for (let i = 0; i < accounts.length; i++) {
    console.log(
      p(`    ${i + 1}  `, PURPLE_DIM) +
        p(maskEmail(accounts[i].email), PURPLE_LIGHT),
    );
  }

  const input = await askPurple("\n  nº (0 cancela)  › ");
  const idx = parseInt(input) - 1;
  if (isNaN(idx) || idx < 0 || idx >= accounts.length) {
    console.log(mute(input !== "0" ? "  inválido" : "  cancelado"));
    await askPurple("  enter… ");
    return;
  }

  const account = accounts[idx];
  const confirm = await askPurple(
    `  remover ${maskEmail(account.email)}? (y/N)  › `,
  );
  if (confirm.toLowerCase() === "y") {
    if (removeAccount(account.id)) {
      console.log(ok(`  removida`));
    } else {
      console.log(err("  falhou"));
    }
  } else {
    console.log(mute("  cancelado"));
  }
  await askPurple("  enter… ");
}

showMenu().catch((err) => {
  console.error(err);
  process.exit(1);
});
