#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  buildSystemCaRestartPlan,
  hasRestartBlockingWork,
  isGuiCmdWrapperOwned,
  resolveSystemCaRestartRequest,
  SYSTEM_CA_RESTART_EXIT_CODE,
} from "./gui-server.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeIdleQueue(overrides = {}) {
  return {
    items: [],
    running: false,
    stopRequested: false,
    currentItemIds: new Set(),
    ...overrides,
  };
}

function assertSelfRelaunchRestartIsAccepted() {
  const decision = resolveSystemCaRestartRequest({
    systemCaEnabled: false,
    runningWork: false,
    wrapperOwned: false,
    restartPlanOptions: {
      execPath: "C:/LinkChecker/runtime/node.exe",
      serverScript: "C:/LinkChecker/gui-server.mjs",
      port: 8787,
      currentIdleShutdownMs: 300000,
      env: {
        NODE_OPTIONS: "--trace-warnings",
        REQUESTED_EXECUTABLE: "C:/malicious/tool.exe",
      },
    },
  });

  assert(decision.status === "accepted", "Default idle session should accept system CA restart.");
  assert(decision.accepted === true, "Accepted restart should be marked accepted.");
  assert(decision.restartMode === "self_relaunch", "Non-wrapper restart should keep self-relaunch mode.");
  assert(decision.restartExitCode === null, "Non-wrapper restart should not request wrapper exit.");
  assert(decision.restartPlan.command === "C:/LinkChecker/runtime/node.exe", "Restart should use the server-selected executable.");
  assert(decision.restartPlan.args[0] === "--use-system-ca", "Restart should use process-level system CA activation.");
  assert(decision.restartPlan.args[1] === "C:/LinkChecker/gui-server.mjs", "Restart should relaunch the GUI server script.");
  assert(decision.restartPlan.args.includes("--port"), "Restart should preserve the current GUI port.");
  assert(decision.restartPlan.args.includes("8787"), "Restart should target the current GUI port.");
  assert(decision.restartPlan.args.includes("--idle-shutdown-ms"), "Restart should preserve idle shutdown mode.");
  assert(decision.restartPlan.args.includes("300000"), "Restart should preserve idle shutdown timeout.");
  assert(decision.restartPlan.options.detached === true, "Restart process should be detached from the old GUI server.");
  assert(decision.restartPlan.options.stdio === "ignore", "Restart process should not inherit GUI request streams.");
  assert(
    !decision.restartPlan.args.some((arg) => String(arg).includes("malicious")),
    "Restart arguments must not be controlled by request-like environment data.",
  );
}

function assertWrapperOwnedRestartUsesDedicatedExit() {
  assert(isGuiCmdWrapperOwned({ LINK_CHECKER_GUI_WRAPPER: "cmd" }) === true, "CMD wrapper marker should be detected.");
  assert(isGuiCmdWrapperOwned({ LINK_CHECKER_GUI_WRAPPER: "other" }) === false, "Unknown wrapper marker should not be treated as CMD-owned.");

  const decision = resolveSystemCaRestartRequest({
    systemCaEnabled: false,
    runningWork: false,
    wrapperOwned: true,
    restartPlanOptions: {
      execPath: "C:/LinkChecker/runtime/node.exe",
      serverScript: "C:/LinkChecker/gui-server.mjs",
      port: 8787,
    },
  });

  assert(decision.status === "accepted", "Wrapper-owned idle session should accept system CA restart.");
  assert(decision.restartMode === "wrapper_exit", "Wrapper-owned restart should use wrapper exit mode.");
  assert(decision.restartExitCode === SYSTEM_CA_RESTART_EXIT_CODE, "Wrapper restart should expose the dedicated restart exit code.");
  assert(!decision.restartPlan, "Wrapper-owned restart must not spawn a detached replacement process.");
}

function assertAlreadyEnabledDoesNotRestart() {
  const decision = resolveSystemCaRestartRequest({
    systemCaEnabled: true,
    runningWork: false,
    wrapperOwned: true,
  });

  assert(decision.status === "already_enabled", "System CA session should report already enabled.");
  assert(decision.accepted === false, "Already-enabled session should not schedule a restart.");
  assert(!decision.restartPlan, "Already-enabled session must not build a restart plan.");
}

function assertActiveJobBlocksRestart() {
  const runningWork = hasRestartBlockingWork({
    currentQueue: makeIdleQueue(),
    currentJobs: new Map([["job-1", { state: "running" }]]),
  });
  assert(runningWork === true, "Running job should block system CA restart.");

  const decision = resolveSystemCaRestartRequest({
    systemCaEnabled: false,
    runningWork,
    wrapperOwned: true,
  });
  assert(decision.status === "busy", "Active job restart should be rejected.");
  assert(decision.accepted === false, "Active job restart must not be accepted.");
  assert(!decision.restartPlan, "Active job restart must not build a restart plan.");
  assert(!decision.restartExitCode, "Active job restart must not request wrapper exit.");
}

function assertQueueStateBlocksRestart() {
  const queuedWork = hasRestartBlockingWork({
    currentQueue: makeIdleQueue({
      items: [{ state: "queued" }],
    }),
    currentJobs: new Map(),
  });
  assert(queuedWork === true, "Queued scan should block system CA restart.");

  const runningQueue = hasRestartBlockingWork({
    currentQueue: makeIdleQueue({
      running: true,
    }),
    currentJobs: new Map(),
  });
  assert(runningQueue === true, "Running queue should block system CA restart.");
}

function assertNoArbitraryCommandInputs() {
  const plan = buildSystemCaRestartPlan({
    execPath: "C:/LinkChecker/runtime/node.exe",
    serverScript: "C:/LinkChecker/gui-server.mjs",
    port: 8788,
    currentIdleShutdownMs: null,
    executable: "C:/malicious/tool.exe",
    args: ["--dangerous"],
    command: "powershell.exe",
    env: {},
  });

  assert(plan.command === "C:/LinkChecker/runtime/node.exe", "Restart command should ignore arbitrary command-like inputs.");
  assert(plan.args[0] === "--use-system-ca", "Restart args should begin with Node system CA mode.");
  assert(plan.args.includes("--no-idle-shutdown"), "Restart should preserve disabled idle shutdown mode.");
  assert(!plan.args.includes("--dangerous"), "Restart args must not include caller-provided arbitrary arguments.");
  assert(!plan.args.includes("powershell.exe"), "Restart args must not include caller-provided commands.");
}

async function assertFrontendRestartControl() {
  const html = await readFile("public/index.html", "utf8");
  const app = await readFile("public/app.js", "utf8");
  const wrapper = await readFile("gui.cmd", "utf8");
  const launcher = await readFile("launcher/StartLinkChecker.cs", "utf8");

  assert(html.includes('id="system-ca-restart"'), "GUI should retain the exception-driven system CA restart action.");
  assert(app.includes("/api/restart-system-ca"), "Frontend should call the dedicated system CA restart endpoint.");
  assert(app.includes("waitForSystemCaSession"), "Frontend should wait for the restarted system CA session.");
  assert(app.includes("hasUnfinishedWork()"), "Frontend should prevent restart while local work is unfinished.");
  assert(wrapper.includes("LINK_CHECKER_GUI_WRAPPER=cmd"), "CMD wrapper should mark wrapper-owned GUI server sessions.");
  assert(wrapper.includes('if "%GUI_EXIT_CODE%"=="75"'), "CMD wrapper should handle the dedicated system CA restart exit code.");
  assert(wrapper.includes("goto runGui"), "CMD wrapper should relaunch in the same lifecycle loop.");

  const environmentOptionsStart = launcher.indexOf("private static void ApplyEnvironmentOptions");
  const environmentOptionsEnd = launcher.indexOf("private static string WaitForGuiUrl", environmentOptionsStart);
  const environmentOptions = launcher.slice(environmentOptionsStart, environmentOptionsEnd);
  assert(environmentOptionsStart >= 0 && environmentOptionsEnd > environmentOptionsStart, "Launcher should retain focused environment option handling.");
  assert(launcher.includes("ApplyEnvironmentOptions(process.StartInfo);"), "Launcher GUI startup should enable system CA without requiring an argument.");
  assert(environmentOptions.includes('EnvironmentVariables["NODE_OPTIONS"]'), "Launcher should preserve existing NODE_OPTIONS.");
  assert(environmentOptions.includes('IndexOf("--use-system-ca", StringComparison.OrdinalIgnoreCase) >= 0'), "Launcher should avoid duplicate system CA options.");
  assert(environmentOptions.includes('current + " --use-system-ca"'), "Launcher should append system CA to existing NODE_OPTIONS.");
  assert(!environmentOptions.includes('String.Equals(arg, "--system-ca"'), "Launcher environment setup should not gate the GUI default on --system-ca.");
}

async function main() {
  assertSelfRelaunchRestartIsAccepted();
  assertWrapperOwnedRestartUsesDedicatedExit();
  assertAlreadyEnabledDoesNotRestart();
  assertActiveJobBlocksRestart();
  assertQueueStateBlocksRestart();
  assertNoArbitraryCommandInputs();
  await assertFrontendRestartControl();
  console.log("ok m1c gui system ca restart");
}

main().catch((error) => {
  console.error(`test-m1c-gui-system-ca-restart: ${error.message}`);
  process.exitCode = 1;
});
